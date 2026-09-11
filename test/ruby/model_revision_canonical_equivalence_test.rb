# frozen_string_literal: true
require 'json'
require 'time'
require 'digest'
require 'minitest/autorun'
require_relative '../../sketchup_plugin/alma_sketchup_mcp/model_revision'

class ModelRevisionCanonicalEquivalenceTest < Minitest::Test
  def legacy(value)
    case value
    when Hash
      pairs = value.map { |key, child| [key.to_s, legacy(child)] }
      pairs.sort_by! { |key, child| [key, JSON.generate(child)] }
      pairs.each_cons(2).any? { |a,b| a[0] == b[0] } ? { '$pairs' => pairs } : pairs.to_h
    when Array; value.map { |child| legacy(child) }
    when Numeric; value.respond_to?(:finite?) && !value.finite? ? value.to_s : value
    when Time; value.utc.iso8601(6)
    when NilClass, String, TrueClass, FalseClass; value
    else; value.to_s
    end
  end
  def test_dictionary_bytes_remain_identical_including_duplicate_normalized_keys
    rng = Random.new(849)
    100.times do
      value = { 'z' => Array.new(24) { [rng.rand, rng.rand(-1000..1000), 0.0] }, 'a' => { 'x' => nil, 'b' => true }, 'time' => Time.at(1234.567), 'nonfinite' => Float::INFINITY }
      value[1] = 'integer-key'; value['1'] = 'string-key' if rng.rand < 0.5
      assert_equal JSON.generate(legacy(value)), AlmaSketchupMCP.revision_json(value)
    end
  end
  def test_only_exact_floating_signed_zero_changes_canonical_bytes
    positive = { 'matrix' => [0.8660254037844387, 0.49999999999999994, 0.0, 1.0], 'nested' => { 'value' => [0.0] } }
    negative = { 'matrix' => [0.8660254037844387, 0.49999999999999994, -0.0, 1.0], 'nested' => { 'value' => [-0.0] } }
    refute_equal JSON.generate(legacy(positive)), JSON.generate(legacy(negative)), 'the former canonicalizer hashed different signed-zero bytes'
    assert_equal JSON.generate(legacy(positive)), AlmaSketchupMCP.revision_json(positive)
    assert_equal AlmaSketchupMCP.revision_json(positive), AlmaSketchupMCP.revision_json(negative)
    assert_equal Digest::SHA256.hexdigest(AlmaSketchupMCP.revision_json(positive)), Digest::SHA256.hexdigest(AlmaSketchupMCP.revision_json(negative))
    assert_equal(-Float::INFINITY, 1.0 / negative['matrix'][2], 'canonicalization must not mutate the native input')
    refute_equal AlmaSketchupMCP.revision_json(0), AlmaSketchupMCP.revision_json(0.0), 'existing integer versus float bytes are retained'
    [-Float::INFINITY, Float::INFINITY, Float::NAN, -1.0, 0.8660254037844387, Float::MIN, 0.0.next_float, -0.0.next_float].each do |value|
      assert_equal JSON.generate(legacy(value)), AlmaSketchupMCP.revision_json(value), 'nonzero/nonfinite serialization must remain byte-identical'
    end
    adjacent = Marshal.load(Marshal.dump(positive)); adjacent['matrix'][0] = positive['matrix'][0].next_float
    refute_equal AlmaSketchupMCP.revision_json(positive), AlmaSketchupMCP.revision_json(adjacent), 'one nonzero ULP remains a real revision change'
    near_zero = Marshal.load(Marshal.dump(positive)); near_zero['matrix'][2] = 0.0.next_float
    refute_equal AlmaSketchupMCP.revision_json(positive), AlmaSketchupMCP.revision_json(near_zero), 'a subnormal nonzero is never rounded to zero'
    changed_field = Marshal.load(Marshal.dump(positive)); changed_field['extra'] = 0.0
    refute_equal AlmaSketchupMCP.revision_json(positive), AlmaSketchupMCP.revision_json(changed_field), 'fields must not be dropped'
  end
  def test_loop_bytes_remain_identical_with_rotations_reversal_and_ties
    rng = Random.new(215)
    100.times do |index|
      points = Array.new(3 + index % 45) { [rng.rand(-20..20), rng.rand(-20..20), rng.rand] }
      points[-1] = points[0] if index.even?
      candidates = [points, points.reverse].flat_map { |sequence| sequence.length.times.map { |offset| sequence.rotate(offset) } }
      expected = candidates.min_by { |candidate| JSON.generate(legacy(candidate)) }
      assert_equal JSON.generate(expected), JSON.generate(AlmaSketchupMCP.revision_canonical_ring(points))
    end
  end
end
