export const PERSPECTIVE_CALIBRATION_HYPOTHESES_KIND = 'perspective_calibration_hypotheses_v1';

export function buildPerspectiveCalibrationHypotheses({
  structureLineEvidence,
  sourceStructureLineEvidence = 'structure-line-evidence.json'
} = {}) {
  if (structureLineEvidence?.kind !== 'structure_line_evidence_v2') {
    throw new Error('structure_line_evidence_v2 is required');
  }
  const imageSize = structureLineEvidence.source_image;
  const segmentById = new Map(structureLineEvidence.raw_segments.map((segment) => [segment.id, segment]));
  const eligible = structureLineEvidence.eligible_segment_ids
    .map((id) => segmentById.get(id))
    .filter(Boolean);
  const seeds = structureLineEvidence.seed_segment_ids
    .map((id) => segmentById.get(id))
    .filter(Boolean);
  const horizontalEligible = eligible.filter((segment) => !isVerticalLike(segment.angle_deg));
  const horizontalSeeds = seeds.filter((segment) => !isVerticalLike(segment.angle_deg));
  const finiteCandidates = buildFiniteVanishingCandidates({
    seeds: horizontalSeeds,
    eligible: horizontalEligible,
    imageSize
  });
  const infiniteCandidates = buildInfiniteDirectionCandidates({
    eligible: horizontalEligible,
    seeds: horizontalSeeds,
    imageSize,
    role: 'horizontal_candidate'
  });
  const verticalCandidate = buildVerticalFamily({ eligible, seeds, imageSize });
  const horizontalCandidates = deduplicateFamilies([
    ...finiteCandidates,
    ...infiniteCandidates
  ], imageSize).slice(0, 32);
  const selectedHorizontal = selectDistinctHorizontalFamilies(
    horizontalCandidates,
    imageSize,
    2,
    verticalCandidate
  );
  const selectedFamilies = [
    ...selectedHorizontal.map((family, index) => finalizeFamily({
      family,
      id: `horizontal_direction_family_${index + 1}`,
      role: 'horizontal_candidate'
    })),
    ...(verticalCandidate ? [finalizeFamily({
      family: verticalCandidate,
      id: 'vertical_direction_family_1',
      role: 'vertical_candidate'
    })] : [])
  ];
  const horizontalFamilyCount = selectedFamilies.filter((family) => family.role === 'horizontal_candidate').length;
  const verticalFamilyCount = selectedFamilies.filter((family) => family.role === 'vertical_candidate').length;
  const spatialSupportOk = selectedFamilies
    .filter((family) => family.role === 'horizontal_candidate')
    .every((family) => family.spatial_cell_count >= 3 && family.support_count >= 5);
  const cameraModelCandidates = buildCameraModelCandidates({
    horizontalFamilies: selectedFamilies.filter((family) => family.role === 'horizontal_candidate'),
    verticalFamily: selectedFamilies.find((family) => family.role === 'vertical_candidate') || null
  });
  const modelContextEvidenceQuality = evaluateModelContextEvidenceQuality({
    selectedFamilies,
    cameraModel: cameraModelCandidates[0]?.model || 'unknown'
  });
  const evidenceQualityOk = modelContextEvidenceQuality.status === 'strong_for_review';
  const sufficientForReview = horizontalFamilyCount >= 2 && spatialSupportOk && evidenceQualityOk;
  const qaStatus = horizontalFamilyCount < 2
    ? 'blocked_insufficient_direction_families'
    : !spatialSupportOk
      ? 'blocked_insufficient_spatial_support'
      : evidenceQualityOk
        ? 'ready_for_calibration_review'
        : 'blocked_low_family_evidence_quality';
  const blockers = ['accepted_calibration_review_required'];
  if (horizontalFamilyCount < 2) blockers.push('second_horizontal_direction_family_missing');
  if (!spatialSupportOk) blockers.push('horizontal_direction_family_spatial_support_insufficient');
  if (!evidenceQualityOk) blockers.push('direction_family_pixel_support_quality_insufficient');
  return {
    kind: PERSPECTIVE_CALIBRATION_HYPOTHESES_KIND,
    version: 1,
    source_structure_line_evidence: sourceStructureLineEvidence,
    source_image: { ...imageSize },
    direction_families: selectedFamilies,
    alternative_direction_families: horizontalCandidates
      .filter((candidate) => !selectedHorizontal.includes(candidate))
      .slice(0, 30)
      .map((family, index) => finalizeFamily({
        family,
        id: `alternative_horizontal_family_${index + 1}`,
        role: 'unassigned_candidate'
      })),
    camera_model_candidates: cameraModelCandidates,
    review_policy: {
      status: sufficientForReview ? 'needs_calibration_review' : 'blocked_insufficient_direction_families',
      accepted_calibration_review_required: true,
      review_required: true,
      promotion_allowed: false,
      compile_allowed: false,
      blockers
    },
    qa: {
      status: qaStatus,
      sufficient_for_review: sufficientForReview,
      review_quality_basis: modelContextEvidenceQuality,
      false_promotion_count: 0,
      blockers
    },
    summary: {
      direction_family_count: selectedFamilies.length,
      horizontal_family_count: horizontalFamilyCount,
      vertical_family_count: verticalFamilyCount,
      finite_candidate_count: finiteCandidates.length,
      infinite_candidate_count: infiniteCandidates.length,
      strong_evidence_family_count: selectedFamilies.filter((family) => family.evidence_quality.status === 'strong').length,
      review_required: true,
      promotion_allowed: false
    }
  };
}

function evaluateModelContextEvidenceQuality({ selectedFamilies, cameraModel }) {
  const horizontal = selectedFamilies.filter((family) => family.role === 'horizontal_candidate');
  const vertical = selectedFamilies.find((family) => family.role === 'vertical_candidate') || null;
  if (cameraModel !== 'one_point_or_near_affine') {
    const weakIds = selectedFamilies
      .filter((family) => family.evidence_quality.status !== 'strong')
      .map((family) => family.id);
    return {
      status: weakIds.length === 0 && selectedFamilies.length > 0 ? 'strong_for_review' : 'weak_for_review',
      camera_model: cameraModel,
      policy: 'strict_all_selected_families',
      accepted_family_ids: weakIds.length ? [] : selectedFamilies.map((family) => family.id),
      blockers: weakIds.map((id) => `strict_family_quality_insufficient:${id}`)
    };
  }

  const finite = horizontal.find((family) => family.vanishing_type === 'finite') || null;
  const infinite = horizontal.find((family) => family.vanishing_type === 'infinite') || null;
  const blockers = [];
  if (!finite) blockers.push('one_point_finite_depth_family_required');
  if (!infinite) blockers.push('one_point_infinite_width_family_required');
  if (!vertical || vertical.vanishing_type !== 'infinite') blockers.push('one_point_infinite_vertical_family_required');
  if (finite) blockers.push(...onePointFamilyBlockers(finite, {
    prefix: 'finite_depth',
    minSupport: 24,
    minCells: 6,
    maxResidual: 1.2,
    minEdge: 0.82,
    minSeed: 0.72,
    minHighEdgeRatio: 0.5
  }));
  if (infinite) blockers.push(...onePointFamilyBlockers(infinite, {
    prefix: 'infinite_width',
    minSupport: 24,
    minCells: 5,
    maxResidual: 1,
    minEdge: 0.72,
    minSeed: 0.6,
    minHighEdgeRatio: 0.4
  }));
  if (vertical?.evidence_quality.status !== 'strong') {
    blockers.push('vertical_family_strict_quality_insufficient');
  }
  return {
    status: blockers.length ? 'weak_for_review' : 'strong_for_review',
    camera_model: cameraModel,
    policy: 'one_point_finite_depth_plus_infinite_width',
    accepted_family_ids: blockers.length ? [] : [finite?.id, infinite?.id, vertical?.id].filter(Boolean),
    blockers
  };
}

function onePointFamilyBlockers(family, thresholds) {
  const quality = family.evidence_quality;
  const blockers = [];
  if (family.support_count < thresholds.minSupport) blockers.push(`${thresholds.prefix}_support_count_insufficient`);
  if (family.spatial_cell_count < thresholds.minCells) blockers.push(`${thresholds.prefix}_spatial_support_insufficient`);
  if (family.median_angular_residual_deg > thresholds.maxResidual) blockers.push(`${thresholds.prefix}_angular_residual_too_high`);
  if (quality.median_edge_support < thresholds.minEdge) blockers.push(`${thresholds.prefix}_edge_support_insufficient`);
  if (quality.median_seed_quality < thresholds.minSeed) blockers.push(`${thresholds.prefix}_seed_quality_insufficient`);
  if (quality.high_edge_support_ratio < thresholds.minHighEdgeRatio) blockers.push(`${thresholds.prefix}_high_edge_ratio_insufficient`);
  return blockers;
}

function buildFiniteVanishingCandidates({ seeds, eligible, imageSize }) {
  const diagonal = Math.hypot(imageSize.width, imageSize.height);
  const center = [imageSize.width / 2, imageSize.height / 2];
  const candidates = [];
  for (let firstIndex = 0; firstIndex < seeds.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < seeds.length; secondIndex += 1) {
      const first = seeds[firstIndex];
      const second = seeds[secondIndex];
      const pairAngle = acuteAngleDelta(first.angle_deg, second.angle_deg);
      if (pairAngle < 1.5 || pairAngle > 86) continue;
      const vp = lineIntersection(first.line_px, second.line_px);
      if (!vp || !vp.every(Number.isFinite)) continue;
      const vpDistance = distance(vp, center);
      if (vpDistance > diagonal * 30) continue;
      const refined = refineFiniteVanishingPoint({
        initialVp: vp,
        eligible,
        seeds,
        imageSize
      });
      const evaluated = refined.evaluated;
      if (evaluated.support.length < 5 || evaluated.spatialCellCount < 3) continue;
      const refinedDistance = distance(refined.vp, center);
      candidates.push({
        vanishingType: refinedDistance > diagonal * 8 ? 'infinite' : 'finite',
        vp: refinedDistance > diagonal * 8 ? null : refined.vp,
        direction: refinedDistance > diagonal * 8
          ? normalizeVector([refined.vp[0] - center[0], refined.vp[1] - center[1]])
          : null,
        support: evaluated.support,
        seedSupport: evaluated.seedSupport,
        residuals: evaluated.residuals,
        spatialCellCount: evaluated.spatialCellCount,
        score: evaluated.score - (pointInsideImage(refined.vp, imageSize) ? 4 : 0)
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function refineFiniteVanishingPoint({ initialVp, eligible, seeds, imageSize }) {
  let vp = initialVp;
  let evaluated = evaluateFiniteFamily({ vp, eligible, seeds, imageSize });
  const diagonal = Math.hypot(imageSize.width, imageSize.height);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = weightedLineIntersection({
      segments: evaluated.support,
      currentVp: vp,
      imageSize
    });
    if (!next || !next.every(Number.isFinite)) break;
    if (distance(next, [imageSize.width / 2, imageSize.height / 2]) > diagonal * 30) break;
    const movement = distance(next, vp);
    vp = next;
    evaluated = evaluateFiniteFamily({ vp, eligible, seeds, imageSize });
    if (movement < 0.25) break;
  }
  return { vp, evaluated };
}

function weightedLineIntersection({ segments, currentVp, imageSize }) {
  if (segments.length < 2) return null;
  const scale = Math.hypot(imageSize.width, imageSize.height);
  const center = [imageSize.width / 2, imageSize.height / 2];
  let m00 = 0;
  let m01 = 0;
  let m11 = 0;
  let rhs0 = 0;
  let rhs1 = 0;
  for (const segment of segments) {
    const first = [
      (segment.line_px.a[0] - center[0]) / scale,
      (segment.line_px.a[1] - center[1]) / scale
    ];
    const second = [
      (segment.line_px.b[0] - center[0]) / scale,
      (segment.line_px.b[1] - center[1]) / scale
    ];
    let a = first[1] - second[1];
    let b = second[0] - first[0];
    let c = first[0] * second[1] - second[0] * first[1];
    const norm = Math.max(1e-9, Math.hypot(a, b));
    a /= norm;
    b /= norm;
    c /= norm;
    const residual = finiteVpAngularResidual(segment, currentVp);
    const robust = 1 / (1 + (residual / 1.8) ** 2);
    const weight = segmentVoteWeight(segment) * robust;
    m00 += weight * a * a;
    m01 += weight * a * b;
    m11 += weight * b * b;
    rhs0 -= weight * a * c;
    rhs1 -= weight * b * c;
  }
  const determinant = m00 * m11 - m01 * m01;
  if (Math.abs(determinant) < 1e-9) return null;
  const normalizedX = (rhs0 * m11 - m01 * rhs1) / determinant;
  const normalizedY = (m00 * rhs1 - m01 * rhs0) / determinant;
  return [normalizedX * scale + center[0], normalizedY * scale + center[1]];
}

function evaluateFiniteFamily({ vp, eligible, seeds, imageSize }) {
  const seedIds = new Set(seeds.map((segment) => segment.id));
  const support = [];
  const seedSupport = [];
  const residuals = [];
  let score = 0;
  for (const segment of eligible) {
    const residual = finiteVpAngularResidual(segment, vp);
    const tolerance = segmentAngularTolerance(segment);
    if (residual > tolerance) continue;
    support.push(segment);
    if (seedIds.has(segment.id)) seedSupport.push(segment);
    residuals.push(residual);
    const robust = Math.max(0.05, 1 - residual / tolerance);
    score += segmentVoteWeight(segment) * robust;
  }
  const spatialCellCount = countSpatialCells(support, imageSize);
  score += spatialCellCount * 2.4 + seedSupport.length * 0.7;
  return { support, seedSupport, residuals, spatialCellCount, score };
}

function buildInfiniteDirectionCandidates({ eligible, seeds, imageSize, role }) {
  const seedIds = new Set(seeds.map((segment) => segment.id));
  const buckets = new Map();
  for (const segment of eligible) {
    const bucket = Math.round(segment.angle_deg / 2) * 2;
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(segment);
  }
  const peaks = [...buckets.entries()]
    .map(([angle, segments]) => ({
      angle: Number(angle),
      score: segments.reduce((sum, segment) => sum + segmentVoteWeight(segment), 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
  const candidates = [];
  for (const peak of peaks) {
    const support = eligible.filter((segment) => (
      acuteAngleDelta(segment.angle_deg, peak.angle) <= segmentAngularTolerance(segment)
    ));
    const spatialCellCount = countSpatialCells(support, imageSize);
    if (support.length < 5 || spatialCellCount < 3) continue;
    const residuals = support.map((segment) => acuteAngleDelta(segment.angle_deg, peak.angle));
    const seedSupport = support.filter((segment) => seedIds.has(segment.id));
    candidates.push({
      vanishingType: 'infinite',
      vp: null,
      direction: angleDirection(peak.angle),
      support,
      seedSupport,
      residuals,
      spatialCellCount,
      score: support.reduce((sum, segment, index) => {
        const tolerance = segmentAngularTolerance(segment);
        return sum + segmentVoteWeight(segment) * Math.max(0.05, 1 - residuals[index] / tolerance);
      }, 0) + spatialCellCount * 2.2 + seedSupport.length * 0.6,
      role
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function buildVerticalFamily({ eligible, seeds, imageSize }) {
  const verticalEligible = eligible.filter((segment) => isVerticalLike(segment.angle_deg));
  const verticalSeeds = seeds.filter((segment) => isVerticalLike(segment.angle_deg));
  if (verticalEligible.length < 3) return null;
  const candidates = buildInfiniteDirectionCandidates({
    eligible: verticalEligible,
    seeds: verticalSeeds,
    imageSize,
    role: 'vertical_candidate'
  });
  return candidates[0] || null;
}

function deduplicateFamilies(families, imageSize) {
  const sorted = [...families].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const family of sorted) {
    const duplicate = kept.some((candidate) => {
      const overlap = supportOverlapRatio(candidate.support, family.support);
      if (overlap >= 0.7) return true;
      return familySignatureDistance(candidate, family, imageSize) <= 1.1;
    });
    if (!duplicate) kept.push(family);
    if (kept.length >= 32) break;
  }
  return kept;
}

function selectDistinctHorizontalFamilies(candidates, imageSize, limit, verticalFamily = null) {
  if (limit <= 0 || candidates.length === 0) return [];
  let best = [];
  let bestScore = -Infinity;
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    const first = candidates[firstIndex];
    if (limit === 1) return [first];
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const second = candidates[secondIndex];
      const overlap = supportOverlapRatio(first.support, second.support);
      if (overlap > 0.48) continue;
      const signatureDistance = familySignatureDistance(first, second, imageSize);
      if (signatureDistance < 7) continue;
      const geometry = horizontalPairGeometry({
        first,
        second,
        verticalFamily,
        imageSize
      });
      if (!geometry.feasible) continue;
      const coverage = new Set([
        ...spatialCellKeys(first.support, imageSize),
        ...spatialCellKeys(second.support, imageSize)
      ]).size;
      const firstBalancedSeeds = Math.min(first.seedSupport.length, 12);
      const secondBalancedSeeds = Math.min(second.seedSupport.length, 12);
      const balancedSeedSupport = (firstBalancedSeeds + secondBalancedSeeds) * 0.6
        + Math.min(firstBalancedSeeds, secondBalancedSeeds) * 1.2;
      const combined = Math.log1p(first.score) * 28
        + Math.log1p(second.score) * 28
        + Math.min(signatureDistance, 25) * 0.8
        + coverage * 1.2
        + balancedSeedSupport
        + geometry.score
        - overlap * 20;
      if (combined > bestScore) {
        bestScore = combined;
        best = [first, second];
      }
    }
  }
  if (best.length) return best.slice(0, limit);
  return candidates.slice(0, 1);
}

function horizontalPairGeometry({ first, second, verticalFamily, imageSize }) {
  const finite = first.vanishingType === 'finite' && first.vp
    ? first
    : second.vanishingType === 'finite' && second.vp
      ? second
      : null;
  const infinite = first.vanishingType === 'infinite' && first.direction
    ? first
    : second.vanishingType === 'infinite' && second.direction
      ? second
      : null;
  if (finite && infinite) {
    let horizonResidual = 0;
    if (verticalFamily?.vanishingType === 'infinite' && verticalFamily.direction) {
      const infiniteAngle = vectorAngle(infinite.direction);
      const verticalAngle = vectorAngle(verticalFamily.direction);
      horizonResidual = acuteAngleDelta(infiniteAngle, normalizeAxisAngle(verticalAngle + 90));
      if (horizonResidual > 12) {
        return {
          feasible: false,
          score: -100,
          horizon_residual_deg: horizonResidual
        };
      }
    }
    return {
      feasible: true,
      score: (12 - horizonResidual) * 7,
      horizon_residual_deg: horizonResidual,
      model_hint: 'one_point_or_near_affine'
    };
  }
  if (!finite || first.vanishingType !== 'finite' || second.vanishingType !== 'finite' || !first.vp || !second.vp) {
    return { feasible: true, score: 8 };
  }
  const center = [imageSize.width / 2, imageSize.height / 2];
  const firstFromCenter = [first.vp[0] - center[0], first.vp[1] - center[1]];
  const secondFromCenter = [second.vp[0] - center[0], second.vp[1] - center[1]];
  const firstLength = Math.max(1e-9, Math.hypot(firstFromCenter[0], firstFromCenter[1]));
  const secondLength = Math.max(1e-9, Math.hypot(secondFromCenter[0], secondFromCenter[1]));
  const centerCosine = (
    firstFromCenter[0] * secondFromCenter[0]
    + firstFromCenter[1] * secondFromCenter[1]
  ) / (firstLength * secondLength);
  if (centerCosine >= -0.02) {
    return { feasible: false, score: -100, center_cosine: centerCosine };
  }
  let horizonResidual = 0;
  if (verticalFamily?.vanishingType === 'infinite' && verticalFamily.direction) {
    const horizonAngle = vectorAngle([
      second.vp[0] - first.vp[0],
      second.vp[1] - first.vp[1]
    ]);
    const verticalAngle = vectorAngle(verticalFamily.direction);
    const expectedHorizonAngle = normalizeAxisAngle(verticalAngle + 90);
    horizonResidual = acuteAngleDelta(horizonAngle, expectedHorizonAngle);
    if (horizonResidual > 12) {
      return {
        feasible: false,
        score: -100,
        center_cosine: centerCosine,
        horizon_residual_deg: horizonResidual
      };
    }
  }
  return {
    feasible: true,
    score: (12 - horizonResidual) * 7 + Math.abs(Math.min(centerCosine, 0)) * 36,
    center_cosine: centerCosine,
    horizon_residual_deg: horizonResidual
  };
}

function finalizeFamily({ family, id, role }) {
  const residuals = [...family.residuals].sort((a, b) => a - b);
  const medianResidual = residuals.length
    ? residuals[Math.floor(residuals.length / 2)]
    : 90;
  const supportCountScore = clamp01(family.support.length / 24);
  const spatialScore = clamp01(family.spatialCellCount / 8);
  const residualScore = clamp01(1 - medianResidual / 4);
  const evidenceQuality = familyEvidenceQuality(family.support, role);
  return {
    id,
    role,
    axis_assignment: 'axis_unassigned',
    vanishing_type: family.vanishingType,
    vanishing_point_px: family.vp ? family.vp.map(round) : null,
    image_direction_px: family.direction ? family.direction.map(round) : null,
    support_segment_ids: family.support.map((segment) => segment.id),
    seed_segment_ids: family.seedSupport.map((segment) => segment.id),
    support_count: family.support.length,
    spatial_cell_count: family.spatialCellCount,
    median_angular_residual_deg: round(medianResidual),
    hypothesis_score: round(family.score),
    confidence: round(supportCountScore * 0.4 + spatialScore * 0.35 + residualScore * 0.25),
    evidence_quality: evidenceQuality,
    review_required: true,
    promotion_allowed: false
  };
}

function familyEvidenceQuality(segments, role) {
  const edgeSupport = segments
    .map((segment) => Number(segment.feature_scores?.edge_support || 0))
    .sort((a, b) => a - b);
  const seedQuality = segments
    .map((segment) => Number(segment.feature_scores?.seed_quality || 0))
    .sort((a, b) => a - b);
  const medianEdgeSupport = median(edgeSupport);
  const medianSeedQuality = median(seedQuality);
  const highEdgeSupportRatio = segments.length
    ? segments.filter((segment) => Number(segment.feature_scores?.edge_support || 0) >= 0.8).length / segments.length
    : 0;
  const edgeThreshold = role === 'vertical_candidate' ? 0.8 : 0.84;
  const seedThreshold = role === 'vertical_candidate' ? 0.7 : 0.72;
  const blockers = [];
  if (medianEdgeSupport < edgeThreshold) blockers.push('median_edge_support_below_threshold');
  if (medianSeedQuality < seedThreshold) blockers.push('median_seed_quality_below_threshold');
  if (highEdgeSupportRatio < 0.5) blockers.push('high_edge_support_ratio_below_threshold');
  return {
    status: blockers.length ? 'weak' : 'strong',
    median_edge_support: round(medianEdgeSupport),
    median_seed_quality: round(medianSeedQuality),
    high_edge_support_ratio: round(highEdgeSupportRatio),
    blockers
  };
}

function buildCameraModelCandidates({ horizontalFamilies, verticalFamily }) {
  const finiteHorizontalCount = horizontalFamilies.filter((family) => family.vanishing_type === 'finite').length;
  const infiniteHorizontalCount = horizontalFamilies.filter((family) => family.vanishing_type === 'infinite').length;
  const verticalInfinite = verticalFamily?.vanishing_type === 'infinite';
  const horizontalIds = horizontalFamilies.map((family) => family.id);
  const verticalId = verticalFamily?.id || null;
  const minimumConfidence = horizontalFamilies.length
    ? Math.min(...horizontalFamilies.map((family) => family.confidence))
    : 0;
  if (finiteHorizontalCount >= 2 && verticalInfinite) {
    return [
      {
        id: 'camera_model_candidate_1',
        model: 'two_point_vertical_parallel',
        horizontal_family_ids: horizontalIds,
        vertical_family_id: verticalId,
        confidence: round(minimumConfidence),
        review_required: true,
        promotion_allowed: false,
        notes: ['Vertical direction is at infinity; this is compatible with a level camera or vertical perspective correction.']
      },
      {
        id: 'camera_model_candidate_2',
        model: 'shifted_lens_off_axis',
        horizontal_family_ids: horizontalIds,
        vertical_family_id: verticalId,
        confidence: round(minimumConfidence * 0.9),
        review_required: true,
        promotion_allowed: false,
        notes: ['Image evidence alone cannot distinguish optical shift from post-process vertical correction.']
      }
    ];
  }
  if (finiteHorizontalCount >= 1 && infiniteHorizontalCount >= 1) {
    return [{
      id: 'camera_model_candidate_1',
      model: 'one_point_or_near_affine',
      horizontal_family_ids: horizontalIds,
      vertical_family_id: verticalId,
      confidence: round(minimumConfidence),
      review_required: true,
      promotion_allowed: false,
      notes: ['One horizontal direction is finite and one is near parallel.']
    }];
  }
  if (infiniteHorizontalCount >= 2) {
    return [{
      id: 'camera_model_candidate_1',
      model: 'orthographic_or_near_orthographic',
      horizontal_family_ids: horizontalIds,
      vertical_family_id: verticalId,
      confidence: round(minimumConfidence),
      review_required: true,
      promotion_allowed: false,
      notes: ['Both horizontal directions are estimated at infinity.']
    }];
  }
  return [{
    id: 'camera_model_candidate_1',
    model: 'unknown',
    horizontal_family_ids: horizontalIds,
    vertical_family_id: verticalId,
    confidence: round(minimumConfidence * 0.5),
    review_required: true,
    promotion_allowed: false,
    notes: ['Insufficient independent horizontal direction families.']
  }];
}

function finiteVpAngularResidual(segment, vp) {
  const midpoint = lineMidpoint(segment.line_px);
  const toVp = [vp[0] - midpoint[0], vp[1] - midpoint[1]];
  const vpAngle = vectorAngle(toVp);
  return acuteAngleDelta(segment.angle_deg, vpAngle);
}

function segmentAngularTolerance(segment) {
  const reported = Number(segment.uncertainty?.angle_sigma_deg || 2);
  return clamp(1.4 + reported * 1.25, 1.8, 5.2);
}

function segmentVoteWeight(segment) {
  const lengthWeight = Math.sqrt(Math.max(1, Number(segment.length_px || 0))) / 5;
  const edge = Number(segment.feature_scores?.edge_support || 0);
  const contrast = Number(segment.feature_scores?.contrast || 0);
  return lengthWeight * (0.55 + edge * 0.3 + contrast * 0.15);
}

function countSpatialCells(segments, imageSize) {
  return spatialCellKeys(segments, imageSize).size;
}

function spatialCellKeys(segments, imageSize) {
  const cells = new Set();
  for (const segment of segments) {
    const midpoint = lineMidpoint(segment.line_px);
    const x = clamp(Math.floor(midpoint[0] / imageSize.width * 6), 0, 5);
    const y = clamp(Math.floor(midpoint[1] / imageSize.height * 4), 0, 3);
    cells.add(`${x}:${y}`);
  }
  return cells;
}

function supportOverlapRatio(first, second) {
  const secondIds = new Set(second.map((segment) => segment.id));
  const overlap = first.filter((segment) => secondIds.has(segment.id)).length;
  return overlap / Math.max(1, Math.min(first.length, second.length));
}

function familySignatureDistance(first, second, imageSize) {
  const anchors = [
    [imageSize.width * 0.2, imageSize.height * 0.25],
    [imageSize.width * 0.5, imageSize.height * 0.25],
    [imageSize.width * 0.8, imageSize.height * 0.25],
    [imageSize.width * 0.35, imageSize.height * 0.7],
    [imageSize.width * 0.7, imageSize.height * 0.7]
  ];
  const deltas = anchors.map((anchor) => acuteAngleDelta(
    familyAngleAt(first, anchor),
    familyAngleAt(second, anchor)
  ));
  return deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
}

function familyAngleAt(family, point) {
  if (family.vanishingType === 'finite' && family.vp) {
    return vectorAngle([family.vp[0] - point[0], family.vp[1] - point[1]]);
  }
  return vectorAngle(family.direction || [1, 0]);
}

function lineIntersection(first, second) {
  const x1 = first.a[0];
  const y1 = first.a[1];
  const x2 = first.b[0];
  const y2 = first.b[1];
  const x3 = second.a[0];
  const y3 = second.a[1];
  const x4 = second.b[0];
  const y4 = second.b[1];
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 1e-7) return null;
  const firstCross = x1 * y2 - y1 * x2;
  const secondCross = x3 * y4 - y3 * x4;
  return [
    (firstCross * (x3 - x4) - (x1 - x2) * secondCross) / denominator,
    (firstCross * (y3 - y4) - (y1 - y2) * secondCross) / denominator
  ];
}

function pointInsideImage(point, imageSize) {
  return point[0] >= 0 && point[0] <= imageSize.width && point[1] >= 0 && point[1] <= imageSize.height;
}

function isVerticalLike(angle) {
  return Math.abs(angle) >= 68;
}

function lineMidpoint(line) {
  return [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
}

function angleDirection(angleDeg) {
  const radians = angleDeg * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

function vectorAngle(vector) {
  let angle = Math.atan2(vector[1], vector[0]) * 180 / Math.PI;
  while (angle >= 90) angle -= 180;
  while (angle < -90) angle += 180;
  return angle;
}

function normalizeAxisAngle(angle) {
  let result = angle;
  while (result >= 90) result -= 180;
  while (result < -90) result += 180;
  return result;
}

function normalizeVector(vector) {
  const length = Math.max(1e-9, Math.hypot(vector[0], vector[1]));
  let result = [vector[0] / length, vector[1] / length];
  if (result[0] < 0 || result[0] === 0 && result[1] < 0) result = [-result[0], -result[1]];
  return result;
}

function acuteAngleDelta(first, second) {
  let delta = Math.abs(first - second) % 180;
  if (delta > 90) delta = 180 - delta;
  return delta;
}

function distance(first, second) {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function median(values) {
  if (!values.length) return 0;
  return values[Math.floor(values.length / 2)];
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}
