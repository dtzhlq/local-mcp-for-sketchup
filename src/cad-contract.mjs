const num={type:'number',minimum:-1e6,maximum:1e6};
const point={type:'array',items:num,minItems:3,maxItems:3};
const pos={type:'number',minimum:0.01,maximum:1e5};
const id={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_]{0,63}$'};
const node=(kind,props,required)=>({type:'object',additionalProperties:false,properties:{id,kind:{const:kind},...props},required:['id','kind',...required]});
const knots={type:'array',minItems:2,maxItems:32,items:num};
const mult={type:'array',minItems:2,maxItems:32,items:{type:'integer',minimum:1,maximum:9}};
export const CAD_RECIPE_SCHEMA={type:'object',additionalProperties:false,required:['version','nodes','output'],properties:{version:{const:1},output:id,nodes:{type:'array',minItems:1,maxItems:24,items:{oneOf:[
 node('sew',{inputs:{type:'array',minItems:2,maxItems:24,uniqueItems:true,items:id},solid:{type:'boolean'}},['inputs','solid']),
 node('box',{min:point,max:point},['min','max']),
 node('cylinder',{radius:pos,height:pos,origin:point,axis:point},['radius','height']),
 node('nurbs_surface',{poles:{type:'array',minItems:2,maxItems:32,items:{type:'array',minItems:2,maxItems:32,items:point}},weights:{type:'array',minItems:2,maxItems:32,items:{type:'array',minItems:2,maxItems:32,items:{type:'number',minimum:1e-6,maximum:1e6}}},u_degree:{type:'integer',minimum:1,maximum:8},v_degree:{type:'integer',minimum:1,maximum:8},u_knots:knots,v_knots:knots,u_multiplicities:mult,v_multiplicities:mult},['poles','u_degree','v_degree','u_knots','v_knots','u_multiplicities','v_multiplicities']),
 ...['fuse','cut','intersect'].map(kind=>node(kind,{input:id,other:id},['input','other'])),
 node('fillet',{input:id,radius:pos,edges:{type:'array',minItems:1,maxItems:256,uniqueItems:true,items:{type:'integer',minimum:0}}},['input','radius'])
]}}}};
export const CAD_MESH_OPTIONS={recipe:CAD_RECIPE_SCHEMA,tolerance:{type:'number',minimum:0.01,maximum:5,default:0.2},angular_tolerance:{type:'number',minimum:0.05,maximum:0.5,default:0.35},max_vertices:{type:'integer',minimum:3,maximum:50000,default:30000},max_faces:{type:'integer',minimum:3,maximum:50000,default:30000}};
