# Offline representation of the native fingerprint input; no SketchUp mutation.
require 'json'
require 'digest'
module Sketchup
  Vertex = Struct.new(:position)
  Edge = Struct.new(:vertices, :soft?, :smooth?)
  Face = Struct.new(:loops, :normal, :material, :back_material)
end
Loop = Struct.new(:outer?, :vertices)
Material = Struct.new(:name)
require_relative '../sketchup_plugin/alma_sketchup_mcp/model_geometry'
class Fingerprint
  include AlmaSketchupMCP
  def calculate(context)
    points = context.fetch('vertices').to_h { |v| [v['handle'], Sketchup::Vertex.new(v['position'].map { |x| x / 25.4 })] }
    entities = context['edges'].map { |e| Sketchup::Edge.new(e['vertices'].map { |h| points.fetch(h) }, e['soft'], e['smooth']) }
    entities += context['faces'].map do |f|
      Sketchup::Face.new(f['loops'].map { |l| Loop.new(l['outer'], l['vertices'].map { |h| points.fetch(h) }) }, f['normal'], f['material'] && Material.new(f['material']), f['back_material'] && Material.new(f['back_material']))
    end
    cad_geometry_digest(entities)
  end
end
before = JSON.parse(File.read(ARGV.fetch(0))).fetch('snapshot').fetch('contexts')
after = JSON.parse(File.read(ARGV.fetch(1))).fetch('snapshot').fetch('contexts')
f = Fingerprint.new
result = before.each_with_object([]) do |context, result|
  next unless context.dig('cad', 'current')
  current = after.find { |c| c['entity_path'] == context['entity_path'] }
  raise 'Source recipe changed' unless current && current.dig('cad', 'source_hash') == context.dig('cad', 'source_hash')
  expected = f.calculate(context)
  raise 'Geometry changed; cannot rebind' unless expected == f.calculate(current)
  changed = Marshal.load(Marshal.dump(current)); changed['vertices'][0]['position'][0] += 0.1
  raise 'Fingerprint misses actual geometry edits' if expected == f.calculate(changed)
  result << { entity_path: context['entity_path'], source_hash: context['cad']['source_hash'], geometry_digest: expected }
end
puts JSON.pretty_generate({ok: true, saved_roundoff_ignored: true, real_edit_detected: true, verified_rebindings: result})
