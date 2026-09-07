import { normalizeVector, nonEmptyString } from './operation-utils.mjs';
export function sectionPlane(model, operation) {
  const name = nonEmptyString(operation.name, 'section_plane.name');
  model.section_planes ||= [];
  if (model.section_planes.some(p => p.name === name)) throw new Error('Section plane already exists.');
  const origin = normalizeVector(operation.origin, null, 'section_plane.origin');
  const normal = normalizeVector(operation.normal, null, 'section_plane.normal');
  if (normal.reduce((sum, value) => sum + value * value, 0) < 1e-12) throw new Error('section_plane.normal must not be zero');
  model.section_planes.push({ id: operation.id || name, name, origin, normal, active: false, evidence: 'mock' });
  if (operation.activate !== false) sectionPlaneActivate(model, { section_ref: name });
}
export function sectionPlaneActivate(model, operation) {
  if (!Object.hasOwn(operation, 'section_ref')) throw new Error('section_ref is required (null disables section).');
  const matches = (model.section_planes || []).filter(p => p.name === operation.section_ref || p.id === operation.section_ref);
  if (operation.section_ref !== null && matches.length !== 1) throw new Error('section_ref must resolve uniquely.');
  for (const plane of model.section_planes || []) plane.active = plane === matches[0];
}
