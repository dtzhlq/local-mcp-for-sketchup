import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Execute the real Ruby add_mesh with numerical API doubles. The doubles model
// coordinate arithmetic and a small-edge rejection, not SketchUp topology.
const ruby = String.raw`
require 'json'
require ${JSON.stringify(fileURLToPath(new URL('../sketchup_plugin/alma_sketchup_mcp/primitive_operations.rb', import.meta.url)))}
module Geom
  class NativeLength < Numeric
    include Comparable
    def initialize(value); @value=value; end
    def to_f; @value; end
    def <=(other); @value <= other.to_f + 0.001; end
    def <=>(other); @value <=> other.to_f; end
    def *(other); @value * other; end
  end
  class Transformation
    attr_reader :scale
    def initialize(scale); @scale=scale; end
    def self.scaling(scale); new(scale); end
  end
  class Point3d
    attr_reader :values
    def initialize(*values); @values=values.flatten.map(&:to_f); end
    def to_a; @values.dup; end
    def distance(other); NativeLength.new(Math.sqrt(@values.zip(other.values).sum{|a,b|(a-b)**2})); end
    def transform(operation); self.class.new(@values.map{|v|v*operation.scale}); end
    def distance_to_plane(plane); @values.zip(plane[0,3]).sum{|a,b|a*b}+plane[3]; end
  end
  def self.fit_plane_to_points(points)
    a,b,c=points.first(3).map(&:to_a); u=b.zip(a).map{|x,y|x-y}; v=c.zip(a).map{|x,y|x-y}
    normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]; length=Math.sqrt(normal.sum{|x|x*x}); return nil if length < 1e-14
    normal.map!{|x|x/length}; normal+[-normal.zip(a).sum{|x,y|x*y}]
  end
end
module Sketchup
  class Face
    attr_accessor :points,:material,:back_material
    def initialize(points,force_ground_down=false)
      @points=points
      @normal=Geom.fit_plane_to_points(points).first(3)
      @normal=@normal.map{|v|-v} if force_ground_down && points.all?{|p|p.to_a[2]==0} && @normal[2]>0
    end
    def normal; @normal; end
    def reverse!; @normal=@normal.map{|v|-v}; self; end
  end
end
class NumericEntities
  attr_reader :faces,:build_calls,:add_face_calls,:received_minimum_edges
  def initialize; @faces=[]; @build_calls=0; @add_face_calls=0; @received_minimum_edges=[]; end
  def build; @build_calls+=1; @building=true; yield self; ensure @building=false; end
  def add_face(points)
    @add_face_calls+=1
    minimum=points.each_with_index.map{|p,i|p.distance(points[(i+1)%points.length])}.min; @received_minimum_edges<<minimum
    return nil if minimum < 0.001
    face=Sketchup::Face.new(points,!@building); @faces<<face; face
  end
  def transform_entities(transform,entities); entities.each{|f|f.points=f.points.map{|p|p.transform(transform)}}; end
  def to_a; @faces.dup; end
  def grep(klass); @faces.grep(klass); end
end
class NumericGroup
  attr_accessor :name
  attr_reader :entities,:attributes
  def initialize; @entities=NumericEntities.new; @attributes={}; end
  def set_attribute(dictionary,key,value); @attributes[[dictionary,key]]=value; end
end
class NumericParent
  def add_group; NumericGroup.new; end
end
module AlmaSketchupMCP
  def vector(value,name); raise name unless value.is_a?(Array)&&value.length==3; value.map(&:to_f); end
  def integer_index(value,name,length); raise name unless value.is_a?(Integer)&&value>=0&&value<length; value; end
  def mm_to_model_units(value); value.to_f/25.4; end
  def model_units_to_mm(value); value.to_f*25.4; end
  def annotate_group(*args); end
  def soften_edges(*args); end
  def apply_transform(*args); end
end
input=JSON.parse(STDIN.read)
results=input.map do |operation|
  begin
    group=AlmaSketchupMCP.add_mesh(NumericParent.new,operation)
    {'ok'=>true,'name'=>group.name,'normals'=>group.entities.faces.map{|f|f.normal.to_a},'faces_mm'=>group.entities.faces.map{|f|f.points.map{|p|p.to_a.map{|v|v*25.4}}},'bulk_calls'=>group.entities.build_calls,'add_face_calls'=>group.entities.add_face_calls,'minimum_constructed_edge_mm'=>group.entities.received_minimum_edges.min*25.4,'construction'=>group.attributes[['AlmaSketchupMCP','construction']]}
  rescue => error
    {'ok'=>false,'message'=>error.message}
  end
end
puts JSON.generate(results)
`;
const faces = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];
const cube = side => ({ vertices: [[0,0,0],[side,0,0],[side,side,0],[0,side,0],[0,0,side],[side,0,side],[side,side,side],[0,side,side]], faces });
const operations = [];
for (const side of [0.005, 0.1, 1, 20]) for (const construction of ['standard','bulk']) operations.push({ name: `cube-${side}-${construction}`, ...cube(side), construction });
const grid = { vertices: [], faces: [] };
for(let y=0;y<=20;y++)for(let x=0;x<=20;x++)grid.vertices.push([x*10,y*10,0]);
for(let y=0;y<20;y++)for(let x=0;x<20;x++){const a=y*21+x;grid.faces.push([a,a+1,a+22],[a,a+22,a+21]);}
for(const construction of ['standard','bulk'])operations.push({name:`grid-${construction}`,...grid,construction});
operations.push({name:'zero-edge',vertices:[[0,0,0],[0,0,0],[1,1,0]],faces:[[0,1,2]]});
operations.push({name:'nonplanar',vertices:[[0,0,0],[10,0,0],[10,10,0],[0,10,1]],faces:[[0,1,2,3]],construction:'bulk'});
const response=spawnSync('ruby',['-e',ruby],{input:JSON.stringify(operations),encoding:'utf8',maxBuffer:16*1024*1024});
assert.equal(response.status,0,response.stderr);
const results=JSON.parse(response.stdout);
for(let index=0;index<10;index++){
  const result=results[index],operation=operations[index];assert.equal(result.ok,true,result.message);
  assert.equal(result.add_face_calls,operation.faces.length);
  assert.equal(result.bulk_calls,operation.construction==='bulk'?1:0);
  assert.equal(result.construction.input_faces,operation.faces.length);
  assert.ok(result.construction.elapsed_ms>=0);
  const expected=operation.faces.map(face=>face.map(i=>operation.vertices[i]));
  result.faces_mm.forEach((face,i)=>face.forEach((point,j)=>point.forEach((value,k)=>assert.ok(Math.abs(value-expected[i][j][k])<1e-9,'Small-feature construction must restore the exact original dimensions'))));
  if(index<4){assert.ok(result.construction.small_feature_scale>1);assert.ok(result.minimum_constructed_edge_mm>=2-1e-8);}
  // Exactly 1 mm can round slightly below the threshold during inch conversion.
  if(index===4||index===5)assert.ok([1,100].includes(result.construction.small_feature_scale));
  if(index>=6)assert.equal(result.construction.small_feature_scale,1);
}
assert.deepEqual(results[8].faces_mm,results[9].faces_mm,'Bulk must preserve every intended face and coordinate');
assert.deepEqual(results[8].normals,results[9].normals,'Standard and bulk must preserve the same input winding despite native ground-plane orientation');
assert.ok(results[8].normals.every(n=>n[2]>0));
assert.equal(results[8].bulk_calls,0);assert.equal(results[9].bulk_calls,1);
assert.equal(results[10].ok,false);assert.match(results[10].message,/zero-length edge/);
assert.equal(results[11].ok,false);assert.match(results[11].message,/not planar/);
console.log(JSON.stringify({ok:true,execution_scope:'offline_ruby_numeric_api_double',native_geometry_verified:false,smallest_restored_edge_mm:0.005,batch_faces:800,standard_bulk_coordinate_parity:true,bulk_transactions:results[9].bulk_calls,timings_ms:results.slice(0,10).map(r=>({name:r.name,elapsed_ms:r.construction.elapsed_ms})),timing_is_sketchup_performance:false}));
