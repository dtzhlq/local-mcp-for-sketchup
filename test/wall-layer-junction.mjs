import assert from 'node:assert/strict';
import {buildDetailedRecipe} from '../src/detailed-modeling/recipes.mjs';
const recipe=buildDetailedRecipe('wall_junction',{id:'junction'});
const corners=recipe.parts.filter(p=>p.id.endsWith('-corner-return'));
const inside=([x,y],polygon)=>{let found=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])found=!found;}return found;};
const xs=[-308,-290,-200,-50,-15,0],ys=[-440,0,15,50,200,290,308];
for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++){
 const point=[(xs[i-1]+xs[i])/2,(ys[j-1]+ys[j])/2];
 assert.equal(corners.filter(p=>inside(point,p.shape.parameters.outer)).length,1,`Corner cell ${point} must contain one layer, with neither overlap nor gap`);
}
for(const [index,interval]of [[0,[0,15]],[1,[15,50]],[2,[50,200]],[3,[200,290]],[4,[290,308]]]){
 const polygon=corners[index].shape.parameters.outer;
 assert.ok(inside([-0.01,(interval[0]+interval[1])/2],polygon),'Every corner layer must meet its matching straight panel');
}
console.log('Layered corner: all arrangement cells uniquely filled; five straight-wall connections preserved.');
