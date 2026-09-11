# frozen_string_literal: true
require 'minitest/autorun'
require 'tmpdir'
$LOAD_PATH.unshift(File.join(__dir__, 'support'))
require_relative '../../sketchup_plugin/alma_sketchup_mcp'

module Geom
  Point3d = Struct.new(:x, :y, :z) unless const_defined?(:Point3d)
  class Transformation
    def initialize(matrix); @matrix = matrix.dup; end
    def to_a; @matrix.dup; end
  end
end
AssetDictionary = Struct.new(:name, :values) do
  def each_pair(&block); values.each_pair(&block); end
end
module AssetAttributes
  def attributes; @attributes ||= {}; end
  def set_attribute(dictionary, key, value); (attributes[dictionary] ||= {})[key] = value; end
  def get_attribute(dictionary, key, default = nil); attributes.fetch(dictionary, {}).fetch(key, default); end
  def attribute_dictionaries; attributes.map { |name, values| AssetDictionary.new(name, values) }; end
end
class AssetEdge < Sketchup::Edge
  attr_reader :vertices, :persistent_id
  def initialize(pid); @persistent_id = pid; @vertices = [Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(1, 0, 0)].map { |point| Struct.new(:position).new(point) }; end
  def length; @vertices.last.position.x; end
  def faces; []; end
  def soft?; false; end
  def smooth?; false; end
  def valid?; true; end
end
class AssetDefinition
  include AssetAttributes
  attr_accessor :name
  attr_reader :entities, :instances, :persistent_id
  def initialize(name, pid); @name, @persistent_id, @entities, @instances = name, pid, [AssetEdge.new(pid + 1)], []; end
end
class AssetInstance < Sketchup::ComponentInstance
  include AssetAttributes
  attr_accessor :name, :definition, :transformation, :locked, :glue, :parent
  attr_reader :persistent_id
  def initialize(definition, transform, pid, parent)
    @definition, @transformation, @persistent_id, @parent = definition, transform, pid, parent
    @locked, @glue, @name = false, nil, "instance-#{pid}"
  end
  def valid?; true; end
  def locked?; @locked; end
  def glued_to; @glue; end
  def erase!; raise 'Native asset replacement must not erase'; end
  def explode; raise 'Native asset import must not explode'; end
end
class AssetEntities < Array
  attr_accessor :model, :after_add
  def add_instance(definition, transform)
    instance = AssetInstance.new(definition, transform, 9000 + length, model)
    self << instance
    after_add&.call(instance)
    instance
  end
end
class AssetDefinitions < Array
  attr_accessor :on_load, :loaded
  def load(_path, **_kwargs)
    on_load&.call
    return loaded if loaded
    self.loaded = AssetDefinition.new('imported-root', 4000)
    self << loaded
    loaded
  end
end
class AssetModel
  include AssetAttributes
  attr_reader :entities, :definitions, :events
  def initialize
    @entities, @definitions, @events = AssetEntities.new, AssetDefinitions.new, []
    @entities.model = self
  end
  def path; ''; end
  def start_operation(name, _disable_ui)
    @events << ['start', name]
    @saved_roots, @saved_definitions = entities.dup, definitions.dup
    @saved_root_state = entities.map { |entity| [entity, entity.definition, entity.transformation.to_a, Marshal.load(Marshal.dump(entity.attributes))] }
    @saved_geometry = definitions.map { |definition| [definition, definition.entities.first.vertices.last.position.x] }
    true
  end
  def commit_operation; @events << ['commit']; true; end
  def abort_operation
    @events << ['abort']
    entities.replace(@saved_roots); definitions.replace(@saved_definitions)
    @saved_root_state.each { |entity, definition, matrix, attrs| entity.definition = definition; entity.transformation = Geom::Transformation.new(matrix); entity.instance_variable_set(:@attributes, attrs) }
    @saved_geometry.each { |definition, length| definition.entities.first.vertices.last.position.x = length }
    true
  end
end

class NativeAssetOperationsTest < Minitest::Test
  IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1].freeze
  def setup
    @directory = Dir.mktmpdir('native-asset-ruby-')
    @source = File.join(@directory, 'test.skp')
    File.write(@source, 'not a SKP; offline fake loader only')
    @source_hash = Digest::SHA256.file(@source).hexdigest
    @model = AssetModel.new
    @old = AssetDefinition.new('old-shared', 1000)
    @model.definitions << @old
    @a = AssetInstance.new(@old, Geom::Transformation.new(IDENTITY), 101, @model)
    @b = AssetInstance.new(@old, Geom::Transformation.new(IDENTITY), 102, @model)
    @a.set_attribute('AlmaSketchupMCP', 'id', 'A')
    @b.set_attribute('AlmaSketchupMCP', 'id', 'B')
    @b.set_attribute('Manual', 'retain', 'original manual note')
    @model.entities.concat([@a, @b])
    @metadata = { 'materials' => [{ 'name' => 'existing', 'color' => '#abcdef' }], 'native_appearance' => { 'signature' => 'fixed' }, 'classification_schemas' => [] }
  end
  def teardown; FileUtils.remove_entry(@directory); end
  def operation(replace = false)
    { 'op' => replace ? 'replace_component_asset' : 'place_component_asset', 'confirmed' => true,
      'source_path' => @source, 'source_sha256' => @source_hash, 'source' => 'offline authored', 'license' => 'test-only', 'origin' => [0, 0, 0], 'rotateZ' => 0 }.merge(replace ? { 'target_id' => 'B' } : { 'id' => 'asset-new', 'name' => 'asset-new' })
  end
  def execute(op = operation)
    snapshot_reader = ->(_model, **_options) { Marshal.load(Marshal.dump(@metadata)) }
    AlmaSketchupMCP.stub(:snapshot, snapshot_reader) do
      AlmaSketchupMCP.with_atomic_model_transaction(@model, 'Offline atomic asset operation') do
        result = AlmaSketchupMCP.apply_native_component_asset(@model, op)
        { 'persistent_id' => result.persistent_id, 'definition' => result.definition.name }
      end
    end
  end
  def test_place_loads_one_intact_root_with_rigid_placement_and_provenance
    op = operation; op['origin'] = [1000, 600, 0]; op['rotateZ'] = 30
    result = execute(op)
    assert_equal 3, @model.entities.length
    assert_same @old, @a.definition
    assert_equal 'asset-new', @model.entities.last.get_attribute('AlmaSketchupMCP', 'id')
    assert_in_delta 1000.0 / 25.4, @model.entities.last.transformation.to_a[12], 1e-12
    assert_in_delta 0.5, @model.entities.last.transformation.to_a[1], 1e-12
    assert_equal @source_hash, @model.entities.last.definition.get_attribute('AlmaAssetSource', 'file_sha256')
    assert_equal 'imported-root', result['definition']
    assert_equal 'commit', @model.events.last.first
    assert_equal @source_hash, Digest::SHA256.file(@source).hexdigest
  end
  def test_replacement_preserves_instance_identity_transform_and_manual_attributes
    execute(operation(true))
    assert_equal 2, @model.entities.length
    assert_same @old, @a.definition
    refute_same @old, @b.definition
    assert_equal 102, @b.persistent_id
    assert_equal IDENTITY, @b.transformation.to_a
    assert_equal 'original manual note', @b.get_attribute('Manual', 'retain')
    assert_equal 'commit', @model.events.last.first
  end
  def test_source_hash_failures_abort_without_root_or_definition_changes
    op = operation; op['source_sha256'] = '0' * 64
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute(op) }
    assert_equal 2, @model.entities.length
    assert_equal [@old], @model.definitions
    @model.definitions.on_load = -> { File.write(@source, 'changed during loader') }
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_equal [@old], @model.definitions
    assert_equal 2, @model.entities.length
    assert_equal 'abort', @model.events.last.first
  end
  def test_protected_geometry_change_during_load_aborts_and_restores
    @model.definitions.on_load = -> { @old.entities.first.vertices.last.position.x = 3 }
    error = assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_match(/modified an existing/, error.cause.message)
    assert_equal 1, @old.entities.first.vertices.last.position.x
    assert_equal [@old], @model.definitions
    assert_equal 'abort', @model.events.last.first
  end
  def test_material_change_during_load_is_detected_before_placement
    @model.definitions.on_load = -> { @metadata['materials'][0]['color'] = '#000000' }
    error = assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_match(/modified an existing/, error.cause.message)
    assert_equal 2, @model.entities.length
    assert_equal 'abort', @model.events.last.first
  end
  def test_imported_material_is_allowed_while_existing_native_appearance_is_preserved
    old = { 'name' => 'existing', 'color' => '#abcdef', 'roughness' => 0.6 }
    @metadata['native_appearance'] = { 'materials' => [old], 'rendering_options' => { 'DisplayEdges' => true }, 'signature' => 'before' }
    @model.definitions.on_load = lambda do
      added = { 'name' => 'asset-oak', 'color' => '#b99762', 'roughness' => 0.3 }
      @metadata['materials'] << added
      @metadata['native_appearance']['materials'] << added
      @metadata['native_appearance']['signature'] = 'after-new-material'
    end
    execute
    assert_equal 'commit', @model.events.last.first
    assert_equal 3, @model.entities.length
    assert_equal old, @metadata['native_appearance']['materials'].first
  end
  def test_native_pbr_edits_rendering_changes_and_duplicate_material_names_still_reject
    [->(appearance) { appearance['materials'][0]['roughness'] = 0.8 },
     ->(appearance) { appearance['rendering_options']['DisplayEdges'] = false },
     ->(appearance) { appearance['materials'] << appearance['materials'][0].dup }].each do |change|
      @metadata['native_appearance'] = { 'materials' => [{ 'name' => 'existing', 'roughness' => 0.6 }], 'rendering_options' => { 'DisplayEdges' => true } }
      @model.definitions.loaded = nil
      @model.definitions.on_load = -> { change.call(@metadata['native_appearance']) }
      assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
      assert_equal 2, @model.entities.length
      assert_equal 'abort', @model.events.last.first
    end
  end
  def test_reused_existing_definition_requires_matching_intact_source_stamp
    @model.definitions.loaded = @old
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_empty @old.attributes
    @model.definitions.loaded = nil
    execute
    second = operation; second['id'] = second['name'] = 'asset-second'
    execute(second)
    assert_same @model.entities[-1].definition, @model.entities[-2].definition
    @model.entities.last.definition.entities.first.vertices.last.position.x = 8
    third = operation; third['id'] = third['name'] = 'asset-third'
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute(third) }
    assert_equal 4, @model.entities.length
  end
  def test_wrong_scope_placement_locked_and_name_collisions_reject
    invalid = [operation.merge('confirmed' => false), operation.merge('id' => 'A'), operation(true).merge('origin' => [10, 0, 0]),
      operation(true).merge('entity_path' => 'pid:102.7', 'target_id' => nil), operation(true).merge('instance_policy' => 'make_unique')]
    invalid.each { |op| assert_raises(AlmaSketchupMCP::QueueOperationError) { execute(op) } }
    @b.locked = true
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute(operation(true)) }
    assert_same @old, @b.definition
    assert_equal 2, @model.entities.length
  end
  def test_placement_postcondition_failure_aborts_entire_load
    @model.entities.after_add = ->(instance) { values = instance.transformation.to_a; values[12] = 99; instance.transformation = Geom::Transformation.new(values) }
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_equal [@old], @model.definitions
    assert_equal 2, @model.entities.length
    assert_equal 'abort', @model.events.last.first
  end
  def test_unexpected_extra_root_during_load_or_placement_aborts
    add_extra = -> { @model.entities << AssetInstance.new(@old, Geom::Transformation.new(IDENTITY), 8888, @model) }
    @model.definitions.on_load = add_extra
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_equal 2, @model.entities.length
    @model.definitions.on_load = nil
    @model.definitions.loaded = nil
    @model.entities.after_add = ->(_instance) { add_extra.call }
    assert_raises(AlmaSketchupMCP::QueueOperationError) { execute }
    assert_equal 2, @model.entities.length
    assert_equal [@old], @model.definitions
  end
end
