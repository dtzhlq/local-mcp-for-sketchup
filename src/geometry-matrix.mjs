// Column-major affine matrices, matching SketchUp's Transformation#to_a.
export const identityMatrix = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
export function vector3(value, label = 'vector') {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`${label} requires three finite numbers`);
  return [...value];
}
export const dot = (a,b) => a.reduce((s,x,i)=>s+x*b[i],0);
export const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const subtract = (a,b) => a.map((x,i)=>x-b[i]);
export const add = (a,b) => a.map((x,i)=>x+b[i]);
export const scaleVector = (a,s) => a.map(x=>x*s);
export function unitVector(v) { const n=Math.hypot(...vector3(v)); if(n<1e-12) throw new Error('Zero length direction'); return scaleVector(v,1/n); }
export function affineMatrix(m) {
  if (!Array.isArray(m)||m.length!==16||!m.every(Number.isFinite)||[3,7,11].some(i=>Math.abs(m[i])>1e-12)||Math.abs(m[15]-1)>1e-12) throw new Error('Expected a finite affine 4x4 column-major matrix');
  return [...m];
}
export function multiplyMatrices(a,b) {
  affineMatrix(a); affineMatrix(b);
  return Array.from({length:16},(_,i)=>[0,1,2,3].reduce((s,k)=>s+a[k*4+i%4]*b[Math.floor(i/4)*4+k],0));
}
export function inverseMatrix(matrix) {
  const m=affineMatrix(matrix), rows=Array.from({length:4},(_,r)=>[...Array.from({length:4},(_,c)=>m[c*4+r]),...Array.from({length:4},(_,c)=>+(c===r))]);
  for(let c=0;c<4;c++) {
    let p=c; for(let r=c+1;r<4;r++) if(Math.abs(rows[r][c])>Math.abs(rows[p][c])) p=r;
    if(Math.abs(rows[p][c])<1e-14) throw new Error('Singular transformation matrix');
    [rows[c],rows[p]]=[rows[p],rows[c]];
    const divisor=rows[c][c]; rows[c]=rows[c].map(x=>x/divisor);
    for(let r=0;r<4;r++) if(r!==c) { const factor=rows[r][c]; rows[r]=rows[r].map((x,j)=>x-factor*rows[c][j]); }
  }
  return Array.from({length:16},(_,i)=>rows[i%4][4+Math.floor(i/4)]);
}
export function transformPoint(matrix, point) { const m=affineMatrix(matrix),p=vector3(point); return [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]); }
export function transformVector(matrix, vector) { const m=affineMatrix(matrix),v=vector3(vector); return [0,1,2].map(r=>m[r]*v[0]+m[4+r]*v[1]+m[8+r]*v[2]); }
export function transformNormal(matrix,normal) { const m=inverseMatrix(matrix),n=vector3(normal); return unitVector([0,1,2].map(r=>m[r*4]*n[0]+m[r*4+1]*n[1]+m[r*4+2]*n[2])); }
export function translationMatrix(v) { const m=identityMatrix(); m.splice(12,3,...vector3(v)); return m; }
export function axesMatrix(origin,x,y,z) { return affineMatrix([...vector3(x),0,...vector3(y),0,...vector3(z),0,...vector3(origin),1]); }
export function rotationMatrix(origin,axis,radians) {
  if(!Number.isFinite(radians)) throw new Error('Rotation angle must be finite');
  const [x,y,z]=unitVector(axis),c=Math.cos(radians),s=Math.sin(radians),t=1-c;
  const m=[t*x*x+c,t*x*y+s*z,t*x*z-s*y,0,t*x*y-s*z,t*y*y+c,t*y*z+s*x,0,t*x*z+s*y,t*y*z-s*x,t*z*z+c,0,0,0,0,1];
  return multiplyMatrices(translationMatrix(origin),multiplyMatrices(m,translationMatrix(scaleVector(origin,-1))));
}
export function scalingMatrix(scale,origin=[0,0,0]) {
  const s=vector3(Array.isArray(scale)?scale:[scale,scale,scale]); if(s.some(x=>Math.abs(x)<1e-14)) throw new Error('Singular scale');
  const m=identityMatrix(); [0,5,10].forEach((i,k)=>m[i]=s[k]);
  return multiplyMatrices(translationMatrix(origin),multiplyMatrices(m,translationMatrix(scaleVector(origin,-1))));
}
export function matrixFromTransform(t={}) {
  let m=t.matrix?affineMatrix(t.matrix):identityMatrix();
  if(t.scale!==undefined) m=multiplyMatrices(scalingMatrix(t.scale),m);
  for(const [key,axis] of [['rotateX',[1,0,0]],['rotateY',[0,1,0]],['rotateZ',[0,0,1]]]) if(t[key]!==undefined) m=multiplyMatrices(rotationMatrix([0,0,0],axis,t[key]*Math.PI/180),m);
  if(t.axis!==undefined) m=multiplyMatrices(rotationMatrix(t.origin??[0,0,0],t.axis,(t.angle??0)*Math.PI/180),m);
  if(t.translate!==undefined) m=multiplyMatrices(translationMatrix(t.translate),m);
  inverseMatrix(m); // Reject singular affine inputs even when no inverse operation was requested.
  return m;
}
