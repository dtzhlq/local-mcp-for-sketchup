// Requirement construction is deliberately separate from measured evidence.
// Every actual leaf occurrence is checked; one surviving shared instance cannot
// stand in for another missing, hidden, or separately edited occurrence.
export const DETAIL_COVERAGE_VERSION = 2;

export function requirementsForOccurrences(parts, occurrences, explicit = []) {
  const index = new Map(parts.map(part => [part.id, part]));
  const authored = new Map(explicit.map(rule => [rule.id, rule]));
  return occurrences.map(occurrence => {
    const part = index.get(occurrence.part_id);
    if (!part?.shape) throw new Error(`Detailed occurrence has no concrete geometry: ${occurrence.part_id}`);
    const { primitive, parameters: p = {} } = part.shape;
    const supplied = authored.get(part.id) || {};
    const checks = structuredClone(supplied.geometry_checks || []);
    if (primitive === 'profile_extrude') {
      const existing = checks.find(check => check.type === 'profile');
      const maxTurn = maximumProfileTurnDegrees(p.outer);
      const profile = { type: 'profile', loop: 'outer', min_vertices: p.outer.length,
        ...(maxTurn <= 60 ? { max_turn_degrees: Math.min(60, maxTurn + 2) } : {}) };
      if (existing) Object.assign(existing, profile, { min_vertices: Math.max(existing.min_vertices || 0, profile.min_vertices) });
      else checks.push(profile);
      if (p.holes?.length && !checks.some(check => check.type === 'opening')) checks.push({ type: 'opening', min_count: p.holes.length });
    }
    if (primitive === 'cylinder' && !checks.some(check => check.type === 'profile')) checks.push({ type: 'profile', loop: 'outer', min_vertices: p.segments || 24 });
    if (primitive === 'panel_with_openings' && p.openings?.length && !checks.some(check => check.type === 'opening')) {
      // A notch touching a panel boundary is an outer-loop opening. It must
      // be proved by a frozen context region, never by fabricated inner loops.
      const enclosed = p.openings.filter(opening => opening.x > 0 && opening.y > 0 && opening.x + opening.width < p.size[0] && opening.y + opening.height < p.size[1]).length;
      if (enclosed) checks.push({ type: 'opening', min_count: enclosed });
    }
    const bounds = primitiveBounds(primitive, p);
    return {
      ...supplied, id: part.id, role: part.role, material: part.material,
      instance_path: structuredClone(occurrence.instance_path), definition_path: structuredClone(occurrence.definition_path),
      require_visible: true, min_faces: Math.max(supplied.min_faces || 0, primitive === 'pipe_between_points' ? (p.segments || 32) + 2 : 6),
      ...(bounds ? { bounds_mm: { ...bounds, tolerance_mm: 0.5 } } : {}), geometry_checks: checks
    };
  });
}

function primitiveBounds(primitive, p) {
  if (primitive === 'box') return { size: structuredClone(p.size) };
  let points;
  if (primitive === 'cylinder') {
    const count = p.segments || 24;
    points = Array.from({ length: count }, (_, i) => {
      const angle = i * 2 * Math.PI / count;
      return [p.radius * Math.cos(angle), p.radius * Math.sin(angle)];
    }).flatMap(([x, y]) => [[x, y, 0], [x, y, p.height]]);
  }
  if (primitive === 'mesh') points = p.vertices;
  if (primitive === 'profile_extrude') {
    const plane = p.plane || 'xy';
    points = p.outer.flatMap(([u, v]) => [0, p.depth].map(t => plane === 'xy' ? [u, v, t] : plane === 'xz' ? [u, t, v] : [t, u, v]));
  }
  if (primitive === 'panel_with_openings') {
    const [w, h] = p.size, t = p.thickness;
    return { size: p.plane === 'xy' ? [w, h, t] : p.plane === 'yz' ? [t, w, h] : [w, t, h] };
  }
  if (!points?.length) return null;
  return { size: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis])) - Math.min(...points.map(point => point[axis]))) };
}

export function maximumProfileTurnDegrees(points) {
  return Math.max(...points.map((point, index) => {
    const before = points[(index + points.length - 1) % points.length], after = points[(index + 1) % points.length];
    const a = [point[0] - before[0], point[1] - before[1]], b = [after[0] - point[0], after[1] - point[1]];
    const cosine = (a[0] * b[0] + a[1] * b[1]) / Math.hypot(...a) / Math.hypot(...b);
    return Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  }));
}
