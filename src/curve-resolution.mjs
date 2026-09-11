// A requested sagitta is a geometric constraint. Exceeding the segment budget
// fails explicitly instead of silently returning a visibly coarser curve.
export function resolveCurveSegments(operation, radius, { sweepDegrees = 360, defaultSegments = 16, minSegments = 3, legacyMax = 96 } = {}) {
  const specified = operation.n ?? operation.segments;
  const tolerance = operation.chord_tolerance_mm;
  if (tolerance === undefined) {
    const value = specified ?? defaultSegments;
    if (!Number.isInteger(value) || value < minSegments || value > legacyMax) throw new Error(`segments must be an integer from ${minSegments} to ${legacyMax}`);
    return value;
  }
  if (!Number.isFinite(radius) || radius <= 0 || !Number.isFinite(tolerance) || tolerance <= 0 || !Number.isFinite(sweepDegrees) || Math.abs(sweepDegrees) <= 1e-12) throw new Error('Curve radius, sweep and chord_tolerance_mm must be finite and positive in magnitude.');
  const budget = operation.max_segments ?? 512;
  if (!Number.isInteger(budget) || budget < minSegments || budget > 4096) throw new Error(`max_segments must be an integer from ${minSegments} to 4096`);
  if (specified !== undefined && (!Number.isInteger(specified) || specified < minSegments || specified > budget)) throw new Error('Explicit segments exceed the curve budget or are invalid.');
  const maxAngle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / radius)));
  if (!(maxAngle > 0)) throw new Error('chord_tolerance_mm is below numerical resolution.');
  const required = Math.max(minSegments, Math.ceil(Math.abs(sweepDegrees) * Math.PI / 180 / maxAngle));
  const resolved = Math.max(specified ?? minSegments, required);
  if (resolved > budget) throw new Error(`Curve tolerance requires ${resolved} segments but max_segments is ${budget}.`);
  return resolved;
}
