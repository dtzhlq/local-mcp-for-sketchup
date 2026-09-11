# frozen_string_literal: true
require 'minitest/autorun'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'

HostMetadataLayer = Struct.new(:name, :visible)
class HostMetadataLayers < Array
  def [](key); key.is_a?(String) ? find { |layer| layer.name == key } : super; end
  def add(name); layer = HostMetadataLayer.new(name, true); self << layer; layer; end
end
class HostMetadataRoot < Sketchup::Group
  attr_accessor :name, :layer, :attributes
  def initialize(id, name = 'Root')
    @name, @attributes = name, { 'AlmaSketchupMCP' => { 'id' => id } }
  end
  def get_attribute(dictionary, key, fallback = nil); @attributes.fetch(dictionary, {}).fetch(key, fallback); end
  def set_attribute(dictionary, key, value); (@attributes[dictionary] ||= {})[key] = value; end
  def valid?; true; end
  def locked?; false; end
end
class HostMetadataModel
  attr_reader :entities, :materials, :definitions, :layers, :events
  attr_accessor :active_entities
  def initialize
    @entities, @materials, @definitions, @layers, @events = [], {}, {}, HostMetadataLayers.new, []
    @active_entities = @entities
  end
  def start_operation(_name, _disable_ui)
    @events << 'start'
    @old_entities, @old_layers = @entities.dup, @layers.dup
    @old_data = @entities.map { |entity| [entity, Marshal.load(Marshal.dump(entity.attributes)), entity.layer] }
    true
  end
  def commit_operation; @events << 'commit'; true; end
  def abort_operation
    @events << 'abort'
    @entities.replace(@old_entities); @layers.replace(@old_layers)
    @old_data.each { |entity, attributes, layer| entity.attributes = attributes; entity.layer = layer }
    true
  end
end

class HostCreationMetadataTest < Minitest::Test
  NAMESPACE = 'alma_0123456789abcdef0123_'
  ROOT = "#{NAMESPACE}root"
  TAG = "#{NAMESPACE}tag_0123456789abcdef"
  def setup
    @model = HostMetadataModel.new
    @original = HostMetadataRoot.new('original', 'Untouched')
    @original.set_attribute('BenchmarkManualEdit', 'keep', 'existing manual metadata')
    @model.entities << @original
    @model.layers.add('Existing')
  end
  def document
    { 'version' => 1, 'units' => 'mm', 'creation_scope' => { 'version' => 'creation-scope.v1', 'namespace' => NAMESPACE, 'definitions' => [], 'materials' => [],
        'host_metadata' => { 'version' => 'new-root-metadata.v1', 'root_ids' => [ROOT], 'tags' => [TAG] } },
      'operations' => [{ 'op' => 'box', 'id' => ROOT, 'name' => ROOT, 'origin' => [0, 0, 0], 'size' => [100, 100, 100] },
        { 'op' => 'attribute', 'target_id' => ROOT, 'dictionary' => 'BenchmarkFixture', 'attributes' => { 'owner' => 'fixture', 'width' => 100, 'ready' => true, 'empty' => nil, 'material' => 'inert text, not a material name' } },
        { 'op' => 'tag', 'name' => TAG, 'visible' => true }, { 'op' => 'assign_tag', 'target_id' => ROOT, 'tag' => TAG }] }
  end
  def validate(doc = document); AlmaSketchupMCP.validate_creation_scope!(@model, doc); end
  def execute(doc = document, fail_after_metadata: false)
    AlmaSketchupMCP.with_atomic_model_transaction(@model, 'Offline new-root metadata') do
      validate(doc)
      doc['operations'].each do |operation|
        case operation['op']
        when 'box' then @model.entities << HostMetadataRoot.new(operation['id'], operation['name'])
        when 'attribute' then AlmaSketchupMCP.set_object_attribute(@model, operation)
        when 'tag' then AlmaSketchupMCP.add_tag(@model, operation)
        when 'assign_tag' then AlmaSketchupMCP.assign_tag(@model, operation)
        end
      end
      raise 'synthetic post-metadata failure' if fail_after_metadata
      { 'new_roots' => @model.entities.length - 1 }
    end
  end
  def test_actual_attribute_and_tag_dispatch_reaches_only_new_root
    execute
    assert_equal 'commit', @model.events.last
    assert_equal 2, @model.entities.length
    new_root = @model.entities.last
    assert_equal 'fixture', new_root.get_attribute('BenchmarkFixture', 'owner')
    assert_equal 100, new_root.get_attribute('BenchmarkFixture', 'width')
    assert_equal 'inert text, not a material name', new_root.get_attribute('BenchmarkFixture', 'material')
    assert_same @model.layers[TAG], new_root.layer
    assert_equal true, @model.layers[TAG].visible
    assert_equal 'existing manual metadata', @original.get_attribute('BenchmarkManualEdit', 'keep')
    assert_nil @original.get_attribute('BenchmarkFixture', 'owner')
    assert_nil @original.layer
  end
  def test_old_default_creation_scope_still_rejects_all_metadata
    %w[attribute tag assign_tag].each do |op|
      doc = document; doc['creation_scope'].delete('host_metadata')
      doc['operations'] = [doc['operations'].first, doc['operations'].find { |entry| entry['op'] == op }]
      assert_raises(RuntimeError) { validate(doc) }
    end
  end
  def test_existing_targets_aliases_and_forward_targets_are_rejected_before_dispatch
    variants = []
    doc = document; doc['operations'][1]['target_id'] = 'original'; variants << doc
    doc = document; doc['operations'][1]['entity_path'] = 'pid:123'; variants << doc
    doc = document; doc['operations'][1]['target'] = ROOT; variants << doc
    doc = document; doc['operations'][0], doc['operations'][1] = doc['operations'][1], doc['operations'][0]; variants << doc
    variants.each do |invalid|
      assert_raises(AlmaSketchupMCP::QueueOperationError) { execute(invalid) }
      assert_equal [@original], @model.entities
      assert_equal ['Existing'], @model.layers.map(&:name)
      assert_equal 'abort', @model.events.last
    end
  end
  def test_existing_adopted_id_and_active_context_collision_reject
    @original.attributes['AlmaSketchupMCP'] = { 'adopted_id' => ROOT }
    assert_match(/already exists/, assert_raises(RuntimeError) { validate }.message)
    @original.attributes['AlmaSketchupMCP'] = { 'id' => 'original' }
    nested = HostMetadataRoot.new(ROOT, 'Nested old root')
    @model.active_entities = [nested]
    assert_match(/already exists/, assert_raises(RuntimeError) { validate }.message)
    assert_nil nested.get_attribute('BenchmarkFixture', 'owner')
  end
  def test_existing_unused_tag_and_forward_or_missing_tag_are_rejected
    @model.layers.add(TAG)
    assert_match(/already exists/, assert_raises(RuntimeError) { validate }.message)
    @model.layers.pop
    variants = []
    doc = document; doc['operations'][2], doc['operations'][3] = doc['operations'][3], doc['operations'][2]; variants << doc
    doc = document; doc['operations'].delete_at(2); variants << doc
    doc = document; doc['operations'] << doc['operations'][2].dup; variants << doc
    doc = document; doc['operations'][2]['visible'] = false; variants << doc
    doc = document; doc['operations'][3]['tag'] = 'Existing'; variants << doc
    doc = document; doc['operations'][2]['color'] = '#FFFFFF'; variants << doc
    variants.each { |invalid| assert_raises(RuntimeError) { validate(invalid) } }
  end
  def test_metadata_scope_rejects_invalid_or_duplicate_roots_tags_and_uncreated_roots
    variants = [nil, [], [ROOT, ROOT], ["#{NAMESPACE}not-created"]]
    variants.each do |roots|
      doc = document; doc['creation_scope']['host_metadata']['root_ids'] = roots
      assert_raises(RuntimeError) { validate(doc) }
    end
    ["#{NAMESPACE}other", "#{NAMESPACE}tag_0123456789abcdeF", 'existing'].each do |tag|
      doc = document; doc['creation_scope']['host_metadata']['tags'] = [tag]
      assert_raises(RuntimeError) { validate(doc) }
    end
    doc = document; doc['creation_scope']['host_metadata']['allow_existing'] = true
    assert_raises(RuntimeError) { validate(doc) }
  end
  def test_dynamic_or_reserved_dictionaries_and_invalid_literal_fields_reject
    ['dynamic_attributes', 'AlmaSketchupMCP', 'BenchmarkFixture#{code}', { 'expression' => 'BenchmarkFixture' }].each do |dictionary|
      doc = document; doc['operations'][1]['dictionary'] = dictionary
      assert_raises(RuntimeError) { validate(doc) }
    end
    [{}, { 'nested' => {} }, { 'array' => [] }, { 'number' => Float::NAN }, { 'number' => Float::INFINITY }, { 'number' => 10**400 },
     { 'constructor' => 1 }, { '__proto__' => 1 }, { 'prototype' => 1 }, { 'bad-key' => 1 }, { 'A' * 65 => 1 },
     { 'text' => 'x' * 2049 }, { 'text' => '😀' * 1025 }, (1..33).to_h { |i| ["field#{i}", i] }].each do |attributes|
      doc = document; doc['operations'][1]['attributes'] = attributes
      assert_raises(RuntimeError) { validate(doc) }
    end
    doc = document; doc['operations'][1]['attributes'] = { 'text' => '😀' * 1024, 'negative' => -3.5, 'flag' => false }
    assert validate(doc)
  end
  def test_nested_metadata_never_becomes_allowed
    doc = document
    definition = { 'op' => 'component_definition', 'name' => "#{NAMESPACE}definition", 'operations' => [doc['operations'][1]] }
    doc['creation_scope']['definitions'] = [definition['name']]
    doc['operations'].unshift(definition)
    assert_match(/top-level/, assert_raises(RuntimeError) { validate(doc) }.message)
  end
  def test_failure_after_metadata_rolls_back_new_root_and_tag_and_preserves_old_object
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute(fail_after_metadata: true) }
    assert_equal [@original], @model.entities
    assert_equal ['Existing'], @model.layers.map(&:name)
    assert_nil @original.get_attribute('BenchmarkFixture', 'owner')
    assert_equal 'existing manual metadata', @original.get_attribute('BenchmarkManualEdit', 'keep')
    assert_equal 'abort', @model.events.last
  end
end
