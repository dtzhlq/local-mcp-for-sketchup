# frozen_string_literal: true
require 'json'
require 'time'
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
      value = { 'z' => Array.new(24) { [rng.rand, rng.rand(-1000..1000), -0.0] }, 'a' => { 'x' => nil, 'b' => true }, 'time' => Time.at(1234.567), 'nonfinite' => Float::INFINITY }
      value[1] = 'integer-key'; value['1'] = 'string-key' if rng.rand < 0.5
      assert_equal JSON.generate(legacy(value)), AlmaSketchupMCP.revision_json(value)
    end
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
