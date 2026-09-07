import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addComponentDefinition, addComponentInstance } from '../src/component-operations.mjs';
import { emptyModel } from '../src/model-state.mjs';
import { boxVertices } from '../src/object-identity.mjs';
import { compilePartGraphToSketchUpDsl } from '../src/product-modeling/part-graph-compiler.mjs';
import { prepareTaskOwnedCreationDsl } from '../src/agent-dsl-policy.mjs';

const points=boxVertices([7,13,19],[11,23,37]);
const cases=[
  {name:'mirror-x',definition:'leaf',origin:[100,200,300],transform:{mirror:'x',rotateZ:90,translate:[1,2,3]}},
  {name:'mirror-y',definition:'leaf',origin:[-50,75,25],transform:{mirror:['y'],rotationZ:35,translation:[12,17,22]}},
  {name:'mirror-z',definition:'leaf',origin:[10,-20,30],transform:{mirror:'z',rotateZ:-50}},
  {name:'mirror-xy',definition:'leaf',origin:[200,100,10],transform:{mirror:['x','y'],rotateZ:180}}
];
const expected=(point,operation)=>{
  const t=operation.transform,axes=Array.isArray(t.mirror)?t.mirror:[t.mirror],angle=(t.rotateZ??t.rotationZ??0)*Math.PI/180;
  const [x,y,z]=point.map((value,axis)=>axes.includes(['x','y','z'][axis])?-value:value),extra=t.translate??t.translation??[0,0,0];
  return [x*Math.cos(angle)-y*Math.sin(angle),x*Math.sin(angle)+y*Math.cos(angle),z].map((value,axis)=>value+operation.origin[axis]+extra[axis]);
};
function nearPoints(actual,wanted){assert.equal(actual.length,wanted.length);for(const point of actual)assert.ok(wanted.some(other=>Math.hypot(...point.map((value,axis)=>value-other[axis]))<1e-7),`Missing transformed point ${point}`);}
const model=emptyModel();
addComponentDefinition(model,{name:'leaf',operations:[{op:'box',name:'asymmetric-leaf',origin:[7,13,19],size:[11,23,37]}]});
for(const operation of cases){addComponentInstance(model,operation);nearPoints(model.instances.at(-1)._vertices,points.map(point=>expected(point,operation)));}
const nested={name:'nested-ref',definition:'leaf',origin:[10,20,30],transform:{mirror:'y',rotateZ:90,translate:[2,3,4]}};
addComponentDefinition(model,{name:'parent',operations:[{op:'component_instance',...nested}]});
const root={name:'root-ref',definition:'parent',origin:[100,200,300],transform:{mirror:'x',rotateZ:-90,translate:[1,2,3]}};
addComponentInstance(model,root);
nearPoints(model.component_definitions.parent.instances[0]._vertices,points.map(point=>expected(point,nested)));
nearPoints(model.instances.at(-1)._vertices,points.map(point=>expected(expected(point,nested),root)));
for(const mirror of [null,{axis:'x'},'q',['x','x'],['x','y','z','x']]){
  const count=model.instances.length;assert.throws(()=>addComponentInstance(model,{name:'invalid',definition:'leaf',transform:{mirror}}),/distinct/);assert.equal(model.instances.length,count);
}
const graph={version:2,id:'mirror-graph',profile_id:'mirror',units:'mm',parts:[
  {id:'leaf',name:'leaf',shape:{primitive:'box',parameters:{origin:[7,13,19],size:[11,23,37]}}},
  {id:'inner',name:'inner',assembly:{children:[{part_id:'leaf'}]}},
  {id:'outer',name:'outer',assembly:{children:[{part_id:'inner',instance_id:'inner-ref',origin:[10,20,30],transform:{mirror:'y',rotateZ:90}}]}}
],roots:[{part_id:'outer',instance_id:'outer-ref',origin:[100,200,300],transform:{mirror:'x',rotateZ:-90}}]};
const dsl=compilePartGraphToSketchUpDsl(graph,{profile_id:'mirror'},{includeReset:false});
const scoped=prepareTaskOwnedCreationDsl(JSON.stringify(dsl),{taskId:'task_11111111-1111-1111-1111-111111111111'});
assert.ok(!scoped.document.operations.some(operation=>operation.op==='transform_object'));
assert.equal(dsl.operations.at(-1).transform.mirror,'x');
assert.equal(dsl.operations.find(operation=>operation.name==='PG2_outer').operations[0].transform.mirror,'y');

// Run the actual native component placement methods with numerical affine API
// doubles. Millimeter-to-inch conversion is part of this comparison.
const ruby=`require 'json'; require 'matrix'; require ${JSON.stringify(fileURLToPath(new URL('../sketchup_plugin/alma_sketchup_mcp/component_operations.rb',import.meta.url)))}
class Numeric; def degrees; self*Math::PI/180.0; end; end
ORIGIN=[0,0,0]; Z_AXIS=[0,0,1]
module Geom
  class Transformation
    attr_reader :matrix
    def initialize(matrix=Matrix.identity(4)); @matrix=matrix; end
    def *(other); Transformation.new(@matrix*other.matrix); end
    def self.translation(v); Transformation.new(Matrix[[1,0,0,v[0]],[0,1,0,v[1]],[0,0,1,v[2]],[0,0,0,1]]); end
    def self.rotation(_origin,_axis,angle); c=Math.cos(angle);s=Math.sin(angle);Transformation.new(Matrix[[c,-s,0,0],[s,c,0,0],[0,0,1,0],[0,0,0,1]]); end
    def self.scaling(_origin,x,y,z); Transformation.new(Matrix.diagonal(x,y,z,1)); end
    def apply(point); (@matrix*Vector[*point,1]).to_a.first(3); end
  end
end
class Entity
  attr_accessor :name;attr_reader :transformation
  def initialize(transform); @transformation=transform; end
  def transform!(transform); @transformation=transform*@transformation; end
end
class Entities
  attr_reader :instances
  def initialize;@instances=[];end
  def add_instance(_definition,transform);entity=Entity.new(transform);@instances<<entity;entity;end
end
module AlmaSketchupMCP
  def vector(value,_label);value;end
  def mm_to_model_units(value);value/25.4;end
end
d=JSON.parse(STDIN.read);model=Struct.new(:entities,:definitions).new(Entities.new,{'leaf'=>Object.new,'parent'=>Object.new})
points=d['points'].map{|p|p.map{|v|v/25.4}}
results=d['cases'].map{|op|entity=AlmaSketchupMCP.add_component_instance(model,op);points.map{|p|entity.transformation.apply(p).map{|v|v*25.4}}}
AlmaSketchupMCP.instance_variable_set(:@document_state_model,model)
children=Entities.new
AlmaSketchupMCP.apply_component_definition_operation(children,d['nested'].merge('op'=>'component_instance'),'parent')
parent=AlmaSketchupMCP.add_component_instance(model,d['root'])
combined=parent.transformation*children.instances[0].transformation
rejected=d['invalid'].map{|mirror|begin;AlmaSketchupMCP.add_component_instance(model,{'name'=>'bad','definition'=>'leaf','transform'=>{'mirror'=>mirror}});false;rescue;true;end}
puts JSON.generate({'cases'=>results,'nested'=>points.map{|p|combined.apply(p).map{|v|v*25.4}},'rejected'=>rejected})`;
const native=spawnSync('ruby',['-e',ruby],{input:JSON.stringify({points,cases,nested,root,invalid:[null,{axis:'x'},'q',['x','x'],['x','y','z','x']]}),encoding:'utf8'});
assert.equal(native.status,0,native.stderr);const result=JSON.parse(native.stdout);
cases.forEach((operation,index)=>nearPoints(result.cases[index],points.map(point=>expected(point,operation))));
nearPoints(result.nested,points.map(point=>expected(expected(point,nested),root)));
assert.ok(result.rejected.every(Boolean));
console.log('component-instance-mirror: root/nested affine points agree in JS and native Ruby methods, mirror precedes rotation and translation, invalid axes reject, scoped creation stays constructive (offline only)');
