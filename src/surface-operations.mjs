import { objectIdentityFields } from './object-identity.mjs';
import { resolveCurveSegments } from './curve-resolution.mjs';
import { addMesh } from './primitive-operations.mjs';
import { finiteNumber, integerInRange, nonNegativeNumber, normalizeKeyword, normalizePlanPoint, normalizeVector, positiveNumber } from './operation-utils.mjs';

export function addLoftBetweenProfiles(model, operation) {
  const { name, profiles, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('loft_between_profiles operation requires a string name');
  if (!Array.isArray(profiles) || profiles.length < 2) throw new Error(`${name}.profiles must contain at least 2 profile sections`);
  const sections = profiles.map((section, sectionIndex) => normalizeLoftProfileSection(section, `${name}.profiles[${sectionIndex}]`));
  const pointCount = sections[0].points.length;
  if (pointCount < 3) throw new Error(`${name}.profiles[0].points must contain at least 3 points`);
  for (const [index, section] of sections.entries()) {
    if (section.points.length !== pointCount) throw new Error(`${name}.profiles[${index}].points must contain ${pointCount} points to match the first profile`);
  }
  const vertices = sections.flatMap((section) => section.points);
  const faces = [];
  for (let ring = 0; ring < sections.length - 1; ring += 1) {
    const base = ring * pointCount;
    const top = (ring + 1) * pointCount;
    for (let i = 0; i < pointCount; i += 1) {
      const next = (i + 1) % pointCount;
      faces.push([base + i, base + next, top + next]);
      faces.push([base + i, top + next, top + i]);
    }
  }
  for (let i = 1; i < pointCount - 1; i += 1) faces.push([0, i + 1, i]);
  const topStart = (sections.length - 1) * pointCount;
  for (let i = 1; i < pointCount - 1; i += 1) faces.push([topStart, topStart + i, topStart + i + 1]);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'loft_between_profiles';
  group.segments_z = sections.length - 1;
}

function normalizeLoftProfileSection(section, fieldName) {
  if (Array.isArray(section)) {
    return { points: section.map((point, index) => normalizeVector(point, [0, 0, 0], `${fieldName}[${index}]`)) };
  }
  if (!section || typeof section !== 'object') throw new Error(`${fieldName} must be an array of points or an object with points`);
  const origin = normalizeVector(section.origin ?? [0, 0, 0], [0, 0, 0], `${fieldName}.origin`);
  if (!Array.isArray(section.points) || section.points.length < 3) throw new Error(`${fieldName}.points must contain at least 3 points`);
  const plane = normalizeKeyword(section.plane ?? 'xy', ['xy', 'xz', 'yz'], `${fieldName}.plane`);
  return {
    points: section.points.map((point, index) => {
      if (!Array.isArray(point) || point.length !== 2) throw new Error(`${fieldName}.points[${index}] must be [u, v]`);
      const u = Number(point[0]);
      const v = Number(point[1]);
      if (!Number.isFinite(u) || !Number.isFinite(v)) throw new Error(`${fieldName}.points[${index}] must contain finite numbers`);
      if (plane === 'xy') return [origin[0] + u, origin[1] + v, origin[2]];
      if (plane === 'xz') return [origin[0] + u, origin[1], origin[2] + v];
      return [origin[0], origin[1] + u, origin[2] + v];
    })
  };
}

export function addShellFromFrontSideProfiles(model, operation) {
  const { name, origin = [0, 0, 0], front_profile: frontProfileRaw, side_profile: sideProfileRaw, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('shell_from_front_side_profiles operation requires a string name');
  const [originX, originY, originZ] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const frontProfile = normalize2dProfile(frontProfileRaw ?? operation.frontProfile, `${name}.front_profile`, 'x', 'z');
  const sideProfile = normalize2dProfile(sideProfileRaw ?? operation.sideProfile, `${name}.side_profile`, 'z', 'half_depth')
    .sort((a, b) => a[0] - b[0]);
  if (frontProfile.length < 3) throw new Error(`${name}.front_profile must contain at least 3 [x, z] points`);
  if (sideProfile.length < 2) throw new Error(`${name}.side_profile must contain at least 2 [z, half_depth] points`);
  for (let index = 1; index < sideProfile.length; index += 1) {
    if (sideProfile[index][0] <= sideProfile[index - 1][0]) throw new Error(`${name}.side_profile z values must be strictly increasing`);
  }
  for (const [index, point] of sideProfile.entries()) {
    if (point[1] < 0) throw new Error(`${name}.side_profile[${index}][1] must be non-negative`);
  }
  const count = frontProfile.length;
  const frontVertices = frontProfile.map(([x, z]) => [originX + x, originY - shellDepthAt(sideProfile, z, name), originZ + z]);
  const backVertices = frontProfile.map(([x, z]) => [originX + x, originY + shellDepthAt(sideProfile, z, name), originZ + z]);
  const vertices = [...frontVertices, ...backVertices];
  const faces = [];
  for (let i = 1; i < count - 1; i += 1) faces.push([0, i, i + 1]);
  for (let i = 1; i < count - 1; i += 1) faces.push([count, count + i + 1, count + i]);
  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    faces.push([i, next, count + next]);
    faces.push([i, count + next, count + i]);
  }
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'shell_from_front_side_profiles';
  group.segments = count;
}

function normalize2dProfile(profile, fieldName, firstLabel, secondLabel) {
  if (!Array.isArray(profile)) throw new Error(`${fieldName} must be an array of [${firstLabel}, ${secondLabel}] pairs`);
  return profile.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) throw new Error(`${fieldName}[${index}] must be [${firstLabel}, ${secondLabel}]`);
    const first = Number(point[0]);
    const second = Number(point[1]);
    if (!Number.isFinite(first) || !Number.isFinite(second)) throw new Error(`${fieldName}[${index}] must contain finite numbers`);
    return [first, second];
  });
}

function shellDepthAt(sideProfile, z, name) {
  if (z <= sideProfile[0][0]) return sideProfile[0][1];
  const last = sideProfile[sideProfile.length - 1];
  if (z >= last[0]) return last[1];
  for (let index = 0; index < sideProfile.length - 1; index += 1) {
    const [z0, depth0] = sideProfile[index];
    const [z1, depth1] = sideProfile[index + 1];
    if (z >= z0 && z <= z1) {
      if (Math.abs(z1 - z0) <= 1e-9) throw new Error(`${name}.side_profile z values must be strictly increasing after sorting`);
      const t = (z - z0) / (z1 - z0);
      return depth0 + (depth1 - depth0) * t;
    }
  }
  return last[1];
}

export function addFaceOnCylinder(model, operation) {
  const { name, center, cylinder_center: cylinderCenterRaw, cylinder_radius: cylinderRadiusRaw, width, height, depth, angle, material, smooth = 'coplanar', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('face_on_cylinder operation requires a string name');
  const cylinderCenter = normalizeVector(cylinderCenterRaw ?? operation.cylinderCenter ?? [0, 0, 0], [0, 0, 0], `${name}.cylinder_center`);
  const surfaceCenter = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const radius = positiveNumber(cylinderRadiusRaw ?? operation.cylinderRadius, undefined, `${name}.cylinder_radius`);
  const patchWidth = positiveNumber(width, undefined, `${name}.width`);
  const patchHeight = positiveNumber(height, undefined, `${name}.height`);
  const patchDepth = positiveNumber(depth, 1, `${name}.depth`);
  const theta = angle !== undefined ? Number(angle) : Math.atan2(surfaceCenter[1] - cylinderCenter[1], surfaceCenter[0] - cylinderCenter[0]);
  if (!Number.isFinite(theta)) throw new Error(`${name}.angle must be a finite number`);
  const radial = [Math.cos(theta), Math.sin(theta), 0];
  const tangent = [-Math.sin(theta), Math.cos(theta), 0];
  const halfWidth = patchWidth / 2;
  const halfHeight = patchHeight / 2;
  const centerOnSurface = [cylinderCenter[0] + radial[0] * radius, cylinderCenter[1] + radial[1] * radius, surfaceCenter[2]];
  const makePoint = (tangentOffset, zOffset, radialOffset) => [
    centerOnSurface[0] + tangent[0] * tangentOffset + radial[0] * radialOffset,
    centerOnSurface[1] + tangent[1] * tangentOffset + radial[1] * radialOffset,
    centerOnSurface[2] + zOffset
  ];
  const vertices = [
    makePoint(-halfWidth, -halfHeight, 0),
    makePoint(halfWidth, -halfHeight, 0),
    makePoint(halfWidth, halfHeight, 0),
    makePoint(-halfWidth, halfHeight, 0),
    makePoint(-halfWidth, -halfHeight, patchDepth),
    makePoint(halfWidth, -halfHeight, patchDepth),
    makePoint(halfWidth, halfHeight, patchDepth),
    makePoint(-halfWidth, halfHeight, patchDepth)
  ];
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'face_on_cylinder';
}

export function addLoftedSolid(model, operation) {
  const { name, origin = [0, 0, 0], profile, segments = 10, n, material, smooth = 'all', transform, qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('lofted_solid operation requires a string name');
  const [x, y, z] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const ringCount = integerInRange(n ?? segments, 3, 96, `${name}.segments`);
  if (!Array.isArray(profile) || profile.length < 2) throw new Error(`${name}.profile must contain at least 2 [height, radius] pairs`);
  const normalizedProfile = profile.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2) throw new Error(`${name}.profile[${index}] must be [height, radius]`);
    return [nonNegativeNumber(point[0], undefined, `${name}.profile[${index}][0]`), positiveNumber(point[1], undefined, `${name}.profile[${index}][1]`)];
  });
  const vertices = [];
  for (const [height, radius] of normalizedProfile) {
    for (let i = 0; i < ringCount; i += 1) {
      const angle = (Math.PI * 2 * i) / ringCount;
      vertices.push([x + radius * Math.cos(angle), y + radius * Math.sin(angle), z + height]);
    }
  }
  const faces = [];
  for (let ring = 0; ring < normalizedProfile.length - 1; ring += 1) {
    const base = ring * ringCount;
    const top = (ring + 1) * ringCount;
    for (let i = 0; i < ringCount; i += 1) {
      const next = (i + 1) % ringCount;
      faces.push([base + i, base + next, top + next]);
      faces.push([base + i, top + next, top + i]);
    }
  }
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([0, i + 1, i]);
  const topStart = (normalizedProfile.length - 1) * ringCount;
  for (let i = 1; i < ringCount - 1; i += 1) faces.push([topStart, topStart + i, topStart + i + 1]);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'lofted_solid';
  model.groups[model.groups.length - 1].segments = ringCount;
}

export function addAnalogStick(model, operation) {
  const { name, origin = [0, 0, 0], profile, segments = 18, n, material, smooth = 'all', transform, qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('analog_stick operation requires a string name');
  const height = positiveNumber(operation.height, 125, `${name}.height`);
  const shaftHeight = positiveNumber(operation.shaft_height ?? operation.shaftHeight, height * 0.45, `${name}.shaft_height`);
  if (shaftHeight >= height) throw new Error(`${name}.shaft_height must be lower than height`);
  const baseRadius = positiveNumber(operation.base_radius ?? operation.baseRadius, 135, `${name}.base_radius`);
  const shaftRadius = positiveNumber(operation.shaft_radius ?? operation.shaftRadius, 92, `${name}.shaft_radius`);
  const capRadius = positiveNumber(operation.cap_radius ?? operation.capRadius, 180, `${name}.cap_radius`);
  const topRadius = positiveNumber(operation.top_radius ?? operation.topRadius, Math.max(shaftRadius, capRadius * 0.72), `${name}.top_radius`);
  const stickProfile = profile || [[0, baseRadius], [shaftHeight, shaftRadius], [height * 0.72, capRadius], [height, topRadius]];
  addLoftedSolid(model, { ...objectIdentityFields(operation), name, origin, profile: stickProfile, segments, n, material, smooth, transform, qa });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'analog_stick';
}

export function addScrewHole(model, operation) {
  const { name, center = operation.origin, segments = 16, n, material = 'Hole_Dark', smooth = 'all', transform, qa } = operation;
  if (!name || typeof name !== 'string') throw new Error('screw_hole operation requires a string name');
  const [x, y, z] = normalizeVector(center, [0, 0, 0], `${name}.center`);
  const radius = positiveNumber(operation.radius, undefined, `${name}.radius`);
  const depth = positiveNumber(operation.depth, 6, `${name}.depth`);
  const headRadius = operation.head_radius !== undefined || operation.headRadius !== undefined
    ? positiveNumber(operation.head_radius ?? operation.headRadius, undefined, `${name}.head_radius`)
    : radius;
  const headDepth = operation.head_depth !== undefined || operation.headDepth !== undefined
    ? positiveNumber(operation.head_depth ?? operation.headDepth, undefined, `${name}.head_depth`)
    : Math.min(depth, Math.max(1, depth * 0.45));
  const clampedHeadDepth = Math.min(headDepth, depth);
  const profile = headRadius > radius
    ? [[0, headRadius], [clampedHeadDepth, radius], [depth, radius]]
    : [[0, radius], [depth, radius]];
  addLoftedSolid(model, { ...objectIdentityFields(operation), name, origin: [x, y, z - depth], profile, segments, n, material, smooth, transform, qa });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'screw_hole';
}

export function addPipeBetweenPoints(model, operation) {
  const { name, radius, segments = 8, n, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('pipe_between_points operation requires a string name');
  const rawPath = operation.points ?? operation.path ?? (operation.start && operation.end ? [operation.start, operation.end] : undefined);
  if (!Array.isArray(rawPath) || rawPath.length < 2) throw new Error(`${name}.points must contain at least 2 [x, y, z] points`);
  const path = rawPath.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.points[${index}]`));
  const pipeRadius = positiveNumber(radius, undefined, `${name}.radius`);
  const ringCount = resolveCurveSegments(operation, pipeRadius, { defaultSegments: 8 });
  const {vertices,faces} = tubeMeshFromPath(path,pipeRadius,ringCount,name);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform });
  const group = model.groups[model.groups.length - 1];
  group.kind = 'pipe_between_points';
  group.segments = ringCount;
}

function perpendicularFrame(tangent) {
  const reference = Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  const u = normalize3(cross3(reference, tangent));
  const v = normalize3(cross3(tangent, u));
  return [u, v];
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize3(vector) {
  const length = Math.hypot(...vector);
  if (length <= 1e-9) throw new Error('Cannot normalize zero-length vector');
  return vector.map((value) => value / length);
}

const dot3 = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const subtract3 = (a,b) => a.map((v,i)=>v-b[i]);
function rotateAround(vector,axis,angle) {
  const c=Math.cos(angle),s=Math.sin(angle),cross=cross3(axis,vector),dot=dot3(axis,vector);
  return vector.map((v,i)=>v*c+cross[i]*s+axis[i]*dot*(1-c));
}

export function parallelTransportFrames(path,name='path') {
  if(!Array.isArray(path)||path.length<2)throw new Error(`${name} needs at least two path points`);
  const edges=path.slice(1).map((point,i)=>{
    const delta=subtract3(point,path[i]);
    if(Math.hypot(...delta)<=1e-9)throw new Error(`${name} must not contain repeated adjacent points`);
    return normalize3(delta);
  });
  const closed=path.length>3 && Math.hypot(...subtract3(path[0],path.at(-1)))<=1e-9;
  const average=(a,b)=>{
    const sum=a.map((v,i)=>v+b[i]);
    if(Math.hypot(...sum)<=1e-8)throw new Error(`${name} contains an unsupported reversing cusp`);
    return normalize3(sum);
  };
  const tangents=path.map((_,i)=>i===0?(closed?average(edges.at(-1),edges[0]):edges[0]):i===path.length-1?(closed?average(edges.at(-1),edges[0]):edges.at(-1)):average(edges[i-1],edges[i]));
  const [firstU,firstV]=perpendicularFrame(tangents[0]);
  const frames=[{tangent:tangents[0],u:firstU,v:firstV}];
  for(let i=1;i<tangents.length;i++){
    const previous=frames.at(-1),t=tangents[i],axis=cross3(previous.tangent,t),s=Math.hypot(...axis),c=Math.max(-1,Math.min(1,dot3(previous.tangent,t)));
    if(s<=1e-9 && c<0)throw new Error(`${name} contains a reversing tangent`);
    let u=s<=1e-9?previous.u:rotateAround(previous.u,axis.map(v=>v/s),Math.atan2(s,c));
    // Remove numerical drift without selecting a new global reference axis.
    u=normalize3(u.map((v,j)=>v-t[j]*dot3(u,t)));
    frames.push({tangent:t,u,v:normalize3(cross3(t,u))});
  }
  if(closed){
    const last=frames.at(-1),angle=Math.atan2(dot3(tangents[0],cross3(last.u,firstU)),dot3(last.u,firstU));
    const distances=[0];for(let i=1;i<path.length;i++)distances.push(distances.at(-1)+Math.hypot(...subtract3(path[i],path[i-1])));
    for(let i=1;i<frames.length;i++){const f=frames[i];f.u=rotateAround(f.u,f.tangent,angle*distances[i]/distances.at(-1));f.v=normalize3(cross3(f.tangent,f.u));}
  }
  return {frames,closed};
}

export function tubeMeshFromPath(path,radius,segments,name='tube') {
  const {frames,closed}=parallelTransportFrames(path,name),ringTotal=closed?path.length-1:path.length,vertices=[],faces=[];
  for(let ring=0;ring<ringTotal;ring++){
    const {u,v}=frames[ring];
    for(let i=0;i<segments;i++){const angle=2*Math.PI*i/segments;vertices.push(path[ring].map((x,j)=>x+radius*(u[j]*Math.cos(angle)+v[j]*Math.sin(angle))));}
  }
  const spanTotal=closed?ringTotal:ringTotal-1;
  for(let ring=0;ring<spanTotal;ring++){
    const a=ring*segments,b=((ring+1)%ringTotal)*segments;
    for(let i=0;i<segments;i++){const j=(i+1)%segments;faces.push([a+i,a+j,b+j],[a+i,b+j,b+i]);}
  }
  if(!closed){for(let i=1;i<segments-1;i++)faces.push([0,i+1,i]);const top=(ringTotal-1)*segments;for(let i=1;i<segments-1;i++)faces.push([top,top+i,top+i+1]);}
  return {vertices,faces,frames,closed};
}

export function addSweptPath(model, operation) {
  const { name, path, radius, segments = 8, n, material, smooth = 'all', transform } = operation;
  if (!name || typeof name !== 'string') throw new Error('swept_path operation requires a string name');
  if (!Array.isArray(path) || path.length < 2) throw new Error(`${name}.path must contain at least 2 [x, y, z] points`);
  const normalizedPath = path.map((point, index) => normalizeVector(point, [0, 0, 0], `${name}.path[${index}]`));
  const tubeRadius = positiveNumber(radius, undefined, `${name}.radius`);
  const ringCount = resolveCurveSegments(operation, tubeRadius, { defaultSegments: 8 });
  const {vertices,faces} = tubeMeshFromPath(normalizedPath,tubeRadius,ringCount,name);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform });
  model.groups[model.groups.length - 1].kind = 'swept_path';
  model.groups[model.groups.length - 1].segments = ringCount;
}

export function addDomedSurface(model, operation) {
  const {
    name,
    origin = [0, 0, 0],
    width,
    depth,
    thickness,
    crown_height,
    crownHeight,
    segments_x = 8,
    segments_y = 8,
    nx,
    ny,
    material,
    smooth = 'all',
    transform,
    qa
  } = operation;
  if (!name || typeof name !== 'string') throw new Error('domed_surface operation requires a string name');
  const [x0, y0, z0] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const surfaceWidth = positiveNumber(width, undefined, `${name}.width`);
  const surfaceDepth = positiveNumber(depth, undefined, `${name}.depth`);
  const surfaceThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const crown = nonNegativeNumber(crown_height ?? crownHeight, 0, `${name}.crown_height`);
  const xSegments = integerInRange(nx ?? segments_x, 1, 96, `${name}.segments_x`);
  const ySegments = integerInRange(ny ?? segments_y, 1, 96, `${name}.segments_y`);
  const vertices = [];
  const cols = xSegments + 1;
  const bottomIndex = (ix, iy) => (iy * cols + ix) * 2;
  const topIndex = (ix, iy) => bottomIndex(ix, iy) + 1;
  for (let iy = 0; iy <= ySegments; iy += 1) {
    for (let ix = 0; ix <= xSegments; ix += 1) {
      const u = ix / xSegments;
      const v = iy / ySegments;
      const x = x0 + u * surfaceWidth;
      const y = y0 + v * surfaceDepth;
      const du = (u - 0.5) * 2;
      const dv = (v - 0.5) * 2;
      const dome = crown * Math.max(0, 1 - du * du) * Math.max(0, 1 - dv * dv);
      vertices.push([x, y, z0]);
      vertices.push([x, y, z0 + surfaceThickness + dome]);
    }
  }
  const faces = [];
  for (let iy = 0; iy < ySegments; iy += 1) {
    for (let ix = 0; ix < xSegments; ix += 1) {
      faces.push([topIndex(ix, iy), topIndex(ix + 1, iy), topIndex(ix + 1, iy + 1)]);
      faces.push([topIndex(ix, iy), topIndex(ix + 1, iy + 1), topIndex(ix, iy + 1)]);
      faces.push([bottomIndex(ix, iy), bottomIndex(ix + 1, iy + 1), bottomIndex(ix + 1, iy)]);
      faces.push([bottomIndex(ix, iy), bottomIndex(ix, iy + 1), bottomIndex(ix + 1, iy + 1)]);
    }
  }
  addGridSkirtFaces(faces, bottomIndex, topIndex, xSegments, ySegments);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'domed_surface';
  model.groups[model.groups.length - 1].segments_x = xSegments;
  model.groups[model.groups.length - 1].segments_y = ySegments;
}

export function addBowedPanel(model, operation) {
  const {
    name,
    origin = [0, 0, 0],
    width,
    height,
    thickness,
    bow_depth,
    bowDepth,
    segments_x = 8,
    segments_z = 8,
    nx,
    nz,
    material,
    smooth = 'all',
    transform,
    qa
  } = operation;
  if (!name || typeof name !== 'string') throw new Error('bowed_panel operation requires a string name');
  const [x0, y0, z0] = normalizeVector(origin, [0, 0, 0], `${name}.origin`);
  const panelWidth = positiveNumber(width, undefined, `${name}.width`);
  const panelHeight = positiveNumber(height, undefined, `${name}.height`);
  const panelThickness = positiveNumber(thickness, undefined, `${name}.thickness`);
  const bow = finiteNumber(bow_depth ?? bowDepth, 0, `${name}.bow_depth`);
  if (panelThickness + Math.min(0, bow) <= 0) throw new Error(`${name}.thickness + bow_depth must stay positive`);
  const xSegments = integerInRange(nx ?? segments_x, 1, 96, `${name}.segments_x`);
  const zSegments = integerInRange(nz ?? segments_z, 1, 96, `${name}.segments_z`);
  const vertices = [];
  const cols = xSegments + 1;
  const frontIndex = (ix, iz) => (iz * cols + ix) * 2;
  const backIndex = (ix, iz) => frontIndex(ix, iz) + 1;
  for (let iz = 0; iz <= zSegments; iz += 1) {
    for (let ix = 0; ix <= xSegments; ix += 1) {
      const u = ix / xSegments;
      const v = iz / zSegments;
      const x = x0 + u * panelWidth;
      const z = z0 + v * panelHeight;
      const du = (u - 0.5) * 2;
      const dv = (v - 0.5) * 2;
      const bowedOffset = bow * Math.max(0, 1 - du * du) * Math.max(0, 1 - dv * dv);
      vertices.push([x, y0, z]);
      vertices.push([x, y0 + panelThickness + bowedOffset, z]);
    }
  }
  const faces = [];
  for (let iz = 0; iz < zSegments; iz += 1) {
    for (let ix = 0; ix < xSegments; ix += 1) {
      faces.push([frontIndex(ix, iz), frontIndex(ix + 1, iz + 1), frontIndex(ix + 1, iz)]);
      faces.push([frontIndex(ix, iz), frontIndex(ix, iz + 1), frontIndex(ix + 1, iz + 1)]);
      faces.push([backIndex(ix, iz), backIndex(ix + 1, iz), backIndex(ix + 1, iz + 1)]);
      faces.push([backIndex(ix, iz), backIndex(ix + 1, iz + 1), backIndex(ix, iz + 1)]);
    }
  }
  addGridSkirtFaces(faces, frontIndex, backIndex, xSegments, zSegments);
  addMesh(model, { ...objectIdentityFields(operation), name, vertices, faces, material, smooth, transform, qa });
  model.groups[model.groups.length - 1].kind = 'bowed_panel';
  model.groups[model.groups.length - 1].segments_x = xSegments;
  model.groups[model.groups.length - 1].segments_z = zSegments;
}

function addGridSkirtFaces(faces, lowerIndex, upperIndex, xSegments, ySegments) {
  for (let ix = 0; ix < xSegments; ix += 1) {
    faces.push([lowerIndex(ix, 0), lowerIndex(ix + 1, 0), upperIndex(ix + 1, 0)]);
    faces.push([lowerIndex(ix, 0), upperIndex(ix + 1, 0), upperIndex(ix, 0)]);
    faces.push([lowerIndex(ix, ySegments), upperIndex(ix, ySegments), upperIndex(ix + 1, ySegments)]);
    faces.push([lowerIndex(ix, ySegments), upperIndex(ix + 1, ySegments), lowerIndex(ix + 1, ySegments)]);
  }
  for (let iy = 0; iy < ySegments; iy += 1) {
    faces.push([lowerIndex(0, iy), upperIndex(0, iy), upperIndex(0, iy + 1)]);
    faces.push([lowerIndex(0, iy), upperIndex(0, iy + 1), lowerIndex(0, iy + 1)]);
    faces.push([lowerIndex(xSegments, iy), lowerIndex(xSegments, iy + 1), upperIndex(xSegments, iy + 1)]);
    faces.push([lowerIndex(xSegments, iy), upperIndex(xSegments, iy + 1), upperIndex(xSegments, iy)]);
  }
}
