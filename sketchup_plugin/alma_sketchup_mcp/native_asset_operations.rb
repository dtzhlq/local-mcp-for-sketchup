# frozen_string_literal: true

module AlmaSketchupMCP
  extend self

  # Called only inside build_model's existing atomic transaction. Loading and
  # placing/rebinding are one mutation, with no exploded or temporary root.
  def apply_native_component_asset(model, operation)
    replacing = operation['op'] == 'replace_component_asset'
    raise 'native_asset confirmed review is required' unless operation['confirmed'] == true
    source = native_appearance_asset_path(operation['source_path'], %w[.skp], 'native_asset.source_path')
    source = File.realpath(source)
    expected_hash = operation['source_sha256'].to_s
    raise 'native_asset source SHA-256 is required' unless expected_hash.match?(/\A[a-f0-9]{64}\z/)
    raise 'native_asset cannot load the active source document' if same_file_path?(model_path(model), source)
    raise 'native_asset source exceeds 256 MiB' unless File.size(source).between?(1, 256 * 1024 * 1024)
    %w[source license].each do |key|
      value = operation[key]
      raise "native_asset #{key} is required" unless value.is_a?(String) && !value.strip.empty? && value.strip.downcase != 'unknown' && !value.match?(/[\0\r\n]/)
    end
    origin = operation['origin']
    angle = operation['rotateZ']
    raise 'native_asset origin must be three finite mm coordinates' unless origin.is_a?(Array) && origin.length == 3 && origin.all? { |value| value.is_a?(Numeric) && value.finite? }
    raise 'native_asset rotateZ must be finite degrees' unless angle.is_a?(Numeric) && angle.finite?
    radians = angle.to_f * Math::PI / 180.0
    c, s = Math.cos(radians), Math.sin(radians)
    placement = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, *origin.map { |value| value.to_f / MM_PER_INCH }, 1]
    roots = model.entities.to_a
    if replacing
      has_path = operation['entity_path'].is_a?(String) && !operation['entity_path'].empty?
      has_id = operation['target_id'].is_a?(String) && !operation['target_id'].empty?
      raise 'native_asset requires exactly one canonical root reference' unless has_path != has_id
      raise 'native_asset nested replacement is unsupported' if has_path && !operation['entity_path'].match?(/\Apid:[1-9][0-9]*\z/)
      raise 'native_asset cannot make a copy or edit a shared definition' if operation['instance_policy'] == 'make_unique' || operation['edit_scope'] == 'component_definition'
    end
    target = replacing ? find_referenced_entity(model, operation, 'replace_component_asset') : nil
    if replacing
      raise 'native_asset replacement requires one unlocked, unglued root ComponentInstance' unless target.is_a?(Sketchup::ComponentInstance) && !target.is_a?(Sketchup::Group) && roots.include?(target) && target.valid? && !target.locked? && target.glued_to.nil?
      raise 'native_asset target identity is ambiguous' unless roots.count { |entity| entity_persistent_id(entity).to_s == entity_persistent_id(target).to_s } == 1
      if operation['target_id']
        raise 'native_asset target reference is ambiguous' unless roots.count { |entity| entity_id(entity).to_s == operation['target_id'] } == 1
      end
      actual = revision_local_transformation(target)
      raise 'native_asset replacement placement differs from the declared existing origin/rotation; no reposition or scale is inferred' unless actual.is_a?(Array) && actual.length == 16 && actual.zip(placement).all? { |a, b| a.is_a?(Numeric) && a.finite? && (a - b).abs <= 1e-9 }
    else
      %w[id name].each do |key|
        value = operation[key]
        raise "native_asset #{key} is required" unless value.is_a?(String) && !value.strip.empty? && !value.match?(/[\0\r\n]/)
      end
      raise 'native_asset new root identity already exists' if roots.any? { |entity| [entity_id(entity).to_s, entity.respond_to?(:name) ? entity.name.to_s : nil].include?(operation['id']) || (entity.respond_to?(:name) && entity.name.to_s == operation['name']) }
    end
    before = native_asset_preservation_record(model, roots, target)
    original_definitions = model.definitions.to_a
    raise 'native_asset source SHA mismatch before load' unless Digest::SHA256.file(source).hexdigest == expected_hash
    definition = begin
      model.definitions.load(source, allow_newer: true)
    rescue ArgumentError
      model.definitions.load(source)
    end
    raise 'native_asset definitions.load failed' unless definition
    raise 'native_asset source SHA changed during load' unless Digest::SHA256.file(source).hexdigest == expected_hash
    # SketchUp may reuse an already loaded definition. Only an unchanged
    # previously stamped asset is reusable; no existing definition is renamed
    # or stamped to make it fit the requested source.
    if original_definitions.include?(definition)
      stamped = definition.get_attribute('AlmaAssetSource', 'file_sha256') == expected_hash &&
        definition.get_attribute('AlmaAssetSource', 'source_path') == source &&
        definition.get_attribute('AlmaAssetSource', 'source') == operation['source'] &&
        definition.get_attribute('AlmaAssetSource', 'license') == operation['license'] &&
        definition.get_attribute('AlmaAssetSource', 'geometry_digest') == native_asset_definition_digest(definition)
      raise 'native_asset load reused an unverified or manually changed existing definition' unless stamped
    else
      definition.set_attribute('AlmaAssetSource', 'source_path', source)
      definition.set_attribute('AlmaAssetSource', 'file_sha256', expected_hash)
      definition.set_attribute('AlmaAssetSource', 'source', operation['source'])
      definition.set_attribute('AlmaAssetSource', 'license', operation['license'])
      definition.set_attribute('AlmaAssetSource', 'geometry_digest', native_asset_definition_digest(definition))
    end
    raise 'native_asset loading modified an existing object or resource' unless native_asset_preservation_record(model, roots, target, before) == before
    raise 'native_asset loading created an unexpected root' unless model.entities.to_a.map(&:object_id).sort == roots.map(&:object_id).sort
    if replacing
      target.definition = definition
      result = target
    else
      result = model.entities.add_instance(definition, Geom::Transformation.new(placement))
      raise 'native_asset root placement failed' unless result
      result.name = operation['name']
      result.set_attribute('AlmaSketchupMCP', 'id', operation['id'])
    end
    raise 'native_asset operation changed protected existing state' unless native_asset_preservation_record(model, roots, target, before) == before
    expected_roots = replacing ? roots : roots + [result]
    raise 'native_asset operation created an unexpected root' unless model.entities.to_a.map(&:object_id).sort == expected_roots.map(&:object_id).sort
    raise 'native_asset source SHA changed during placement' unless Digest::SHA256.file(source).hexdigest == expected_hash
    raise 'native_asset root definition binding failed' unless result.definition.equal?(definition)
    expected_matrix = replacing ? before['target_matrix'] : placement
    actual_matrix = revision_local_transformation(result)
    raise 'native_asset root transform failed readback' unless actual_matrix == expected_matrix
    result
  end

  def native_asset_revision_state
    { 'unique_entity_limit' => MODEL_REVISION_UNIQUE_ENTITY_LIMIT, 'unique_entities' => 0, 'reachable_definitions' => 0,
      'definition_reports' => {}, 'definition_keys_by_object' => {}, 'definition_objects_by_key' => {},
      'classification_schemas' => [], 'native_classification_by_definition' => {}, 'complete' => true, 'blockers' => [] }
  end

  def native_asset_definition_digest(definition)
    state = native_asset_revision_state
    result = revision_entities_report(definition.entities, state, [])
    raise 'native_asset definition fingerprint incomplete' unless state['complete'] == true
    result['digest']
  end

  # Fingerprint the original roots and their complete child definitions using
  # the existing revision payload. Only the selected instance's definition
  # binding/derived geometry may change. All original definitions are also
  # checked independently, including the replaced instance's old definition.
  def native_asset_preservation_record(model, roots, target, baseline = nil)
    state = native_asset_revision_state
    rows = roots.map do |entity|
      raise 'native_asset original root disappeared' unless entity.valid? && model.entities.to_a.include?(entity)
      payload = revision_entity_payload(entity, revision_child_definition_report(entity, state, []))
      if entity.equal?(target)
        %w[child_definition_key child_definition_digest geometry].each { |key| payload.delete(key) }
      end
      [entity.object_id, payload]
    end
    definitions = baseline ? baseline['definition_objects'] : model.definitions.to_a
    definition_rows = definitions.map do |definition|
      raise 'native_asset original definition disappeared' unless model.definitions.to_a.include?(definition)
      [definition.object_id, definition.name.to_s, entity_attributes(definition), native_asset_definition_digest(definition)]
    end
    snap = snapshot(model, include_detail_evidence: false)
    resources = %w[materials tags scenes section_planes image_references component_definition_summaries].to_h do |key|
      values = snap[key] || []
      if baseline
        expected = baseline['resources'][key]
        values = values.select { |value| expected.any? { |old| native_asset_resource_key(old) == native_asset_resource_key(value) } }
      end
      [key, values]
    end
    raise 'native_asset preservation fingerprint incomplete' unless state['complete'] == true
    { 'roots' => rows, 'definition_objects' => definitions, 'definitions' => definition_rows, 'resources' => resources,
      'model_attributes' => entity_attributes(model),
      'native_appearance' => native_asset_protected_appearance(snap['native_appearance'], baseline && baseline['native_appearance']),
      'target_matrix' => target ? revision_local_transformation(target) : nil }
  end

  def native_asset_protected_appearance(appearance, baseline = nil)
    return appearance unless appearance.is_a?(Hash)

    protected = appearance.dup
    # The native signature covers the complete material library, so an imported
    # material legitimately changes it. Compare its actual protected inputs.
    protected.delete('signature')
    if protected.key?('materials')
      materials = protected['materials']
      raise 'native_asset appearance material evidence is malformed' unless materials.is_a?(Array)
      names = materials.map { |entry| entry.is_a?(Hash) ? entry['name'] : nil }
      raise 'native_asset appearance material identity is ambiguous' unless names.all? { |name| name.is_a?(String) && !name.empty? } && names.uniq.length == names.length
      if baseline
        expected = baseline.fetch('materials', [])
        protected['materials'] = materials.select { |entry| expected.any? { |old| old['name'] == entry['name'] } }
      end
    end
    protected
  end

  def native_asset_resource_key(value)
    value.is_a?(Hash) ? [value['persistent_id'], value['name'], value['id']] : value
  end
end
