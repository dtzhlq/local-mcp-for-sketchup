#!/usr/bin/env python3
import argparse
import json
import math
import os
from pathlib import Path

import cv2
import numpy as np


CLASSES = [
    "building_outline",
    "roof_internal_seam",
    "site_perimeter_candidate",
    "road_boundary_candidate",
    "paved_green_boundary",
    "unknown_strong_edge",
]

COLORS = {
    "building_outline": (255, 119, 22),
    "roof_internal_seam": (247, 85, 168),
    "site_perimeter_candidate": (68, 68, 239),
    "road_boundary_candidate": (11, 158, 245),
    "paved_green_boundary": (74, 163, 22),
    "unknown_strong_edge": (139, 116, 100),
}


def main():
    args = parse_args()
    image = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"failed to read image: {args.image}")
    if args.width and args.height:
        image = cv2.resize(image, (args.width, args.height), interpolation=cv2.INTER_AREA)
    site = normalize_bbox(json.loads(args.site_bbox))
    building_boxes = [normalize_bbox(item) for item in json.loads(args.building_boxes or "[]")]
    parking_boxes = [normalize_bbox(item) for item in json.loads(args.parking_boxes or "[]")]
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    preprocess = build_preprocess(image, site)
    candidates = extract_candidates(
        image=image,
        preprocess=preprocess,
        site=site,
        building_boxes=building_boxes,
        parking_boxes=parking_boxes,
    )
    site_ranking = rank_site_candidates(candidates, site)
    candidates = apply_acceptance(candidates, site_ranking)
    qa = build_qa(candidates, site_ranking)
    result = {
        "kind": "opencv_edge_v1",
        "version": 1,
        "backend": "opencv_clahe_canny_hough_lsd_v1",
        "opencv_version": cv2.__version__,
        "numpy_version": np.__version__,
        "coordinate_convention": "image_x_right_y_down",
        "source_image": args.source_image or args.image,
        "analysis_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        "site_bbox_px": site,
        "classes": CLASSES,
        "preprocessing": {
            "grayscale": True,
            "contrast_method": "cv2.createCLAHE",
            "edge_method": "cv2.Canny + cv2.HoughLinesP",
            "lsd_available": bool(preprocess["lsd_available"]),
            "canny_low": int(preprocess["canny_low"]),
            "canny_high": int(preprocess["canny_high"]),
        },
        "edge_pixel_count": int(np.count_nonzero(preprocess["canny"])),
        "candidate_edges": candidates,
        "site_perimeter_candidates": site_ranking,
        "qa": qa,
        "correction_targets": correction_targets(qa),
        "artifacts": {
            "preprocess_png": str((output_dir / "opencv-edge-preprocess-debug.png").as_posix()),
            "classification_png": str((output_dir / "opencv-edge-candidate-classification.png").as_posix()),
        },
        "notes": [
            "This report is produced by real OpenCV cv2 operations, not the JS fallback.",
            "OpenCV edges are observed evidence only; GroundPlan promotion remains residual/QA gated.",
        ],
    }

    cv2.imwrite(str(output_dir / "opencv-edge-preprocess-debug.png"), render_preprocess(image, preprocess))
    cv2.imwrite(str(output_dir / "opencv-edge-candidate-classification.png"), render_classification(image, candidates, qa))
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(json.dumps({
        "ok": qa["ok"],
        "verdict": qa["verdict"],
        "opencv_version": cv2.__version__,
        "accepted_edge_count": qa["accepted_edge_count"],
        "rejected_edge_count": qa["rejected_edge_count"],
        "site_perimeter_confidence": qa["site_perimeter_confidence"],
        "road_boundary_confidence": qa["road_boundary_confidence"],
        "output": args.output,
    }, indent=2))


def build_preprocess(image, site):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
    contrast = clahe.apply(gray)
    blur = cv2.GaussianBlur(contrast, (3, 3), 0)
    masked = np.zeros_like(blur)
    x, y, w, h = [int(round(v)) for v in site]
    masked[y:y + h, x:x + w] = blur[y:y + h, x:x + w]
    median = np.median(masked[masked > 0]) if np.any(masked > 0) else np.median(blur)
    low = int(max(24, min(110, median * 0.55)))
    high = int(max(70, min(210, median * 1.35)))
    canny = cv2.Canny(masked, low, high, apertureSize=3, L2gradient=True)
    lines = cv2.HoughLinesP(
        canny,
        rho=1,
        theta=np.pi / 180,
        threshold=42,
        minLineLength=max(34, int(min(w, h) * 0.055)),
        maxLineGap=18,
    )
    lsd_lines = []
    lsd_available = hasattr(cv2, "createLineSegmentDetector")
    if lsd_available:
        detector = cv2.createLineSegmentDetector(0)
        detected = detector.detect(contrast)[0]
        if detected is not None:
            for item in detected[:320]:
                x1, y1, x2, y2 = item[0]
                if line_length((x1, y1), (x2, y2)) >= 28:
                    lsd_lines.append([float(x1), float(y1), float(x2), float(y2)])
    return {
        "gray": gray,
        "contrast": contrast,
        "blur": blur,
        "canny": canny,
        "hough_lines": [] if lines is None else lines.reshape(-1, 4).tolist(),
        "lsd_lines": lsd_lines,
        "lsd_available": lsd_available,
        "canny_low": low,
        "canny_high": high,
    }


def extract_candidates(image, preprocess, site, building_boxes, parking_boxes):
    raw_lines = []
    for index, line in enumerate(preprocess["hough_lines"]):
        raw_lines.append(("hough", index, [float(v) for v in line]))
    for index, line in enumerate(preprocess["lsd_lines"]):
        raw_lines.append(("lsd", index, [float(v) for v in line]))
    candidates = []
    for source, index, line in raw_lines:
        x1, y1, x2, y2 = normalize_line(line)
        length = line_length((x1, y1), (x2, y2))
        if length < 30:
            continue
        angle = abs(math.degrees(math.atan2(y2 - y1, x2 - x1))) % 180
        orthogonal_residual = min(angle, abs(angle - 90), abs(angle - 180)) / 90
        if orthogonal_residual > 0.18:
            continue
        axis = "x" if abs(x2 - x1) >= abs(y2 - y1) else "y"
        context = line_context(
            image=image,
            a=(x1, y1),
            b=(x2, y2),
            axis=axis,
            building_boxes=building_boxes,
            parking_boxes=parking_boxes,
        )
        support = line_support(preprocess["canny"], (x1, y1), (x2, y2))
        classified = classify_candidate((x1, y1), (x2, y2), axis, site, context, support, length)
        candidates.append({
            "id": f"opencv_{source}_{index + 1}",
            "source": source,
            "class": classified["class"],
            "axis": axis,
            "a": [round_float(x1), round_float(y1)],
            "b": [round_float(x2), round_float(y2)],
            "length_px": round_float(length),
            "angle_deg": round_float(angle),
            "orthogonal_residual": round_float(orthogonal_residual),
            "confidence": round_float(classified["confidence"]),
            "source_pixel_support_ratio": round_float(support),
            "source_edge_strength": round_float(float(np.mean(preprocess["contrast"]))),
            "score": round_float(length * max(0.18, support) * classified["confidence"]),
            "accepted": bool(classified["accepted"]),
            "acceptance_reason": classified.get("acceptance_reason"),
            "rejection_reason": classified.get("rejection_reason"),
            "risk_flags": classified.get("risk_flags", []),
            "context": context,
        })
    merged = merge_candidates(candidates)
    return sorted(merged, key=lambda item: (-item["score"], -item["length_px"]))[:260]


def classify_candidate(a, b, axis, site, context, support, length):
    center = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    near_site = distance_to_site_edge(center, site) <= max(15, min(site[2], site[3]) * 0.028)
    long_site_like = length >= (site[2] if axis == "x" else site[3]) * 0.32
    if context["inside_building_ratio"] > 0.52 and context["building_transition_ratio"] < 0.28:
        return {
            "class": "roof_internal_seam",
            "confidence": min(0.88, 0.52 + support * 0.24),
            "accepted": False,
            "rejection_reason": "inside_building_roof_seam",
            "risk_flags": ["inside_building"],
        }
    if context["building_transition_ratio"] > 0.3:
        return {
            "class": "building_outline",
            "confidence": min(0.9, 0.55 + context["building_transition_ratio"] * 0.25 + support * 0.12),
            "accepted": True,
            "acceptance_reason": "building_exclusion_transition",
            "risk_flags": [],
        }
    if near_site and long_site_like:
        return {
            "class": "site_perimeter_candidate",
            "confidence": min(0.9, 0.54 + support * 0.24),
            "accepted": True,
            "acceptance_reason": "site_perimeter_rank_candidate",
            "risk_flags": [],
        }
    if context["vegetation_hardscape_transition_ratio"] > 0.18:
        return {
            "class": "paved_green_boundary",
            "confidence": min(0.88, 0.5 + context["vegetation_hardscape_transition_ratio"] * 0.24 + support * 0.12),
            "accepted": True,
            "acceptance_reason": "vegetation_hardscape_transition",
            "risk_flags": [],
        }
    if context["parking_context_ratio"] > 0.28 or context["hardscape_ratio"] > 0.5:
        accepted = context["inside_building_ratio"] < 0.28
        return {
            "class": "road_boundary_candidate",
            "confidence": min(0.86, 0.48 + context["hardscape_ratio"] * 0.18 + support * 0.12),
            "accepted": accepted,
            "acceptance_reason": "hardscape_or_parking_context" if accepted else None,
            "rejection_reason": None if accepted else "road_boundary_inside_building_rejected",
            "risk_flags": [] if accepted else ["inside_building"],
        }
    return {
        "class": "unknown_strong_edge",
        "confidence": min(0.72, 0.4 + support * 0.18),
        "accepted": False,
        "rejection_reason": "unknown_strong_edge_needs_review",
        "risk_flags": ["unknown_source_context"],
    }


def line_context(image, a, b, axis, building_boxes, parking_boxes):
    length = line_length(a, b)
    steps = max(8, min(70, math.ceil(length / 8)))
    offset = 7
    counts = {
        "building_a": 0,
        "building_b": 0,
        "vegetation_a": 0,
        "vegetation_b": 0,
        "hardscape_a": 0,
        "hardscape_b": 0,
        "parking": 0,
        "samples": 0,
    }
    for index in range(steps + 1):
        t = index / steps
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        p_a = (x, y - offset) if axis == "x" else (x - offset, y)
        p_b = (x, y + offset) if axis == "x" else (x + offset, y)
        s_a = sample_pixel(image, p_a)
        s_b = sample_pixel(image, p_b)
        counts["building_a"] += int(point_in_any_bbox(p_a, building_boxes))
        counts["building_b"] += int(point_in_any_bbox(p_b, building_boxes))
        counts["vegetation_a"] += int(s_a["vegetation"])
        counts["vegetation_b"] += int(s_b["vegetation"])
        counts["hardscape_a"] += int(s_a["hardscape"])
        counts["hardscape_b"] += int(s_b["hardscape"])
        counts["parking"] += int(point_in_any_bbox((x, y), parking_boxes))
        counts["samples"] += 1
    samples = max(1, counts["samples"])
    building_a = counts["building_a"] / samples
    building_b = counts["building_b"] / samples
    veg_a = counts["vegetation_a"] / samples
    veg_b = counts["vegetation_b"] / samples
    hard_a = counts["hardscape_a"] / samples
    hard_b = counts["hardscape_b"] / samples
    vegetation_hard_transition = (veg_a > 0.35 and hard_b > 0.32) or (veg_b > 0.35 and hard_a > 0.32)
    return {
        "inside_building_ratio": round_float(min(1, (counts["building_a"] + counts["building_b"]) / (samples * 2))),
        "building_transition_ratio": round_float(abs(building_a - building_b)),
        "vegetation_hardscape_transition_ratio": round_float((abs(veg_a - veg_b) + max(hard_a, hard_b) * 0.5) if vegetation_hard_transition else 0),
        "hardscape_ratio": round_float((hard_a + hard_b) / 2),
        "vegetation_ratio": round_float((veg_a + veg_b) / 2),
        "parking_context_ratio": round_float(counts["parking"] / samples),
    }


def rank_site_candidates(candidates, site):
    sides = {side: {"side": side, "winner_id": None, "candidates": [], "rejected_alternatives": []} for side in ["top", "right", "bottom", "left"]}
    for item in candidates:
        side = site_side_for_candidate(item, site)
        if side is None:
            continue
        side_distance = distance_to_side(item, site, side)
        side_span = site[3] if side in ("left", "right") else site[2]
        outer_bonus = max(0, 1 - side_distance / max(1, side_span * 0.16))
        score = (
            item["confidence"] * 0.42
            + item["source_pixel_support_ratio"] * 0.28
            + min(0.22, item["length_px"] / max(1, side_span) * 0.22)
            + outer_bonus * 0.18
            - side_distance / max(1, side_span) * 0.24
        )
        sides[side]["candidates"].append({
            "id": item["id"],
            "class": item["class"],
            "score": round_float(score),
            "distance_to_side_px": round_float(side_distance),
            "confidence": item["confidence"],
            "source_pixel_support_ratio": item["source_pixel_support_ratio"],
            "length_px": item["length_px"],
            "a": item["a"],
            "b": item["b"],
        })
    for side in sides.values():
        side["candidates"].sort(key=lambda item: (-item["score"], -item["length_px"]))
        winner = next((item for item in side["candidates"] if item["class"] == "site_perimeter_candidate"), None)
        if winner is None and side["candidates"]:
            winner = side["candidates"][0]
        side["winner_id"] = winner["id"] if winner else None
        side["rejected_alternatives"] = [
            {**item, "rejection_reason": "lower_rank_site_perimeter_alternative"}
            for item in side["candidates"]
            if item["id"] != side["winner_id"]
        ][:6]
    return sides


def apply_acceptance(candidates, ranking):
    winners = {side["winner_id"] for side in ranking.values() if side["winner_id"]}
    alternatives = {
        item["id"]
        for side in ranking.values()
        for item in side["rejected_alternatives"]
    }
    result = []
    for item in candidates:
        next_item = dict(item)
        if next_item["class"] == "site_perimeter_candidate":
            if next_item["id"] in winners:
                next_item["accepted"] = True
                next_item["acceptance_reason"] = "winner_site_perimeter_candidate"
            elif next_item["id"] in alternatives:
                next_item["accepted"] = False
                next_item["rejection_reason"] = "lower_rank_site_perimeter_alternative"
                next_item["risk_flags"] = sorted(set(next_item.get("risk_flags", []) + ["site_perimeter_lower_rank"]))
        if next_item["class"] in ("roof_internal_seam", "unknown_strong_edge"):
            next_item["accepted"] = False
            next_item["rejection_reason"] = next_item.get("rejection_reason") or f"{next_item['class']}_needs_review"
        result.append(next_item)
    return result


def build_qa(candidates, ranking):
    accepted = [item for item in candidates if item["accepted"]]
    rejected = [item for item in candidates if not item["accepted"]]
    site_winners = [
        next((item for item in candidates if item["id"] == side["winner_id"]), None)
        for side in ranking.values()
    ]
    site_winners = [item for item in site_winners if item is not None]
    road = [item for item in accepted if item["class"] == "road_boundary_candidate"]
    building = [item for item in accepted if item["class"] == "building_outline"]
    roof = [item for item in rejected if item["class"] == "roof_internal_seam"]
    issues = []
    if len(site_winners) < 3:
        issues.append(issue("review", "opencv_site_perimeter_incomplete", "OpenCV found fewer than 3 site perimeter winners."))
    if not road:
        issues.append(issue("review", "opencv_road_boundary_missing", "OpenCV found no road boundary candidates."))
    if not building:
        issues.append(issue("review", "opencv_building_outline_missing", "OpenCV found no building outline candidates."))
    ok = len(site_winners) >= 3 and len(accepted) >= 4
    return {
        "ok": ok,
        "verdict": "pass" if ok else "review",
        "accepted_edge_count": len(accepted),
        "rejected_edge_count": len(rejected),
        "site_perimeter_confidence": round_float(avg([item["confidence"] for item in site_winners])),
        "road_boundary_confidence": round_float(avg([item["confidence"] for item in road])),
        "building_outline_confidence": round_float(avg([item["confidence"] for item in building])),
        "roof_seam_rejection_count": len(roof),
        "internal_strong_edge_rejection_count": len([
            item for item in rejected
            if item.get("rejection_reason") == "lower_rank_site_perimeter_alternative"
            or item.get("context", {}).get("inside_building_ratio", 0) > 0.35
        ]),
        "site_perimeter_sides_with_rejected_alternatives": len([side for side in ranking.values() if side["rejected_alternatives"]]),
        "accepted_by_class": count_by(accepted, "class"),
        "rejected_by_class": count_by(rejected, "class"),
        "issues": issues,
    }


def render_preprocess(image, preprocess):
    gray = cv2.cvtColor(preprocess["gray"], cv2.COLOR_GRAY2BGR)
    contrast = cv2.cvtColor(preprocess["contrast"], cv2.COLOR_GRAY2BGR)
    canny = cv2.cvtColor(preprocess["canny"], cv2.COLOR_GRAY2BGR)
    top = np.hstack([image, gray])
    bottom = np.hstack([contrast, canny])
    return np.vstack([top, bottom])


def render_classification(image, candidates, qa):
    canvas = image.copy()
    for item in candidates:
        color = COLORS.get(item["class"], (120, 120, 120))
        thickness = 4 if item["accepted"] else 2
        line_type = cv2.LINE_AA
        p1 = tuple(int(round(v)) for v in item["a"])
        p2 = tuple(int(round(v)) for v in item["b"])
        if item["accepted"]:
            cv2.line(canvas, p1, p2, color, thickness, line_type)
        else:
            draw_dashed_line(canvas, p1, p2, color, thickness)
    footer = np.full((96, canvas.shape[1], 3), 255, dtype=np.uint8)
    text = f"OpenCV edges accepted {qa['accepted_edge_count']} | rejected {qa['rejected_edge_count']} | site {qa['site_perimeter_confidence']:.2f} | road {qa['road_boundary_confidence']:.2f}"
    cv2.putText(footer, text, (18, 38), cv2.FONT_HERSHEY_SIMPLEX, 0.68, (20, 30, 40), 2, cv2.LINE_AA)
    cv2.putText(footer, "solid=accepted, dashed=rejected; masks/geometry are not promoted by this backend", (18, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.48, (70, 82, 96), 1, cv2.LINE_AA)
    return np.vstack([canvas, footer])


def draw_dashed_line(image, p1, p2, color, thickness):
    length = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
    if length <= 0:
        return
    dash = 12
    gap = 8
    steps = int(length / (dash + gap)) + 1
    for index in range(steps):
        start = index * (dash + gap) / length
        end = min(1, (index * (dash + gap) + dash) / length)
        if start >= 1:
            continue
        a = (int(round(p1[0] + (p2[0] - p1[0]) * start)), int(round(p1[1] + (p2[1] - p1[1]) * start)))
        b = (int(round(p1[0] + (p2[0] - p1[0]) * end)), int(round(p1[1] + (p2[1] - p1[1]) * end)))
        cv2.line(image, a, b, color, thickness, cv2.LINE_AA)


def merge_candidates(candidates):
    merged = []
    for item in candidates:
        existing = next((candidate for candidate in merged if can_merge(candidate, item)), None)
        if existing is None:
            merged.append(dict(item))
            continue
        axis = item["axis"]
        a0 = min(existing["a"][0], existing["b"][0]) if axis == "x" else min(existing["a"][1], existing["b"][1])
        a1 = max(existing["a"][0], existing["b"][0]) if axis == "x" else max(existing["a"][1], existing["b"][1])
        b0 = min(item["a"][0], item["b"][0]) if axis == "x" else min(item["a"][1], item["b"][1])
        b1 = max(item["a"][0], item["b"][0]) if axis == "x" else max(item["a"][1], item["b"][1])
        start = min(a0, b0)
        end = max(a1, b1)
        fixed = avg([existing["a"][1], item["a"][1]]) if axis == "x" else avg([existing["a"][0], item["a"][0]])
        existing["a"] = [round_float(start), round_float(fixed)] if axis == "x" else [round_float(fixed), round_float(start)]
        existing["b"] = [round_float(end), round_float(fixed)] if axis == "x" else [round_float(fixed), round_float(end)]
        existing["length_px"] = round_float(end - start)
        existing["confidence"] = round_float(max(existing["confidence"], item["confidence"]))
        existing["source_pixel_support_ratio"] = round_float(max(existing["source_pixel_support_ratio"], item["source_pixel_support_ratio"]))
        existing["score"] = round_float(max(existing["score"], item["score"]))
    return [item for item in merged if item["length_px"] >= 32]


def can_merge(a, b):
    if a["axis"] != b["axis"] or a["class"] != b["class"]:
        return False
    fixed_a = a["a"][1] if a["axis"] == "x" else a["a"][0]
    fixed_b = b["a"][1] if b["axis"] == "x" else b["a"][0]
    if abs(fixed_a - fixed_b) > 6:
        return False
    a0 = min(a["a"][0], a["b"][0]) if a["axis"] == "x" else min(a["a"][1], a["b"][1])
    a1 = max(a["a"][0], a["b"][0]) if a["axis"] == "x" else max(a["a"][1], a["b"][1])
    b0 = min(b["a"][0], b["b"][0]) if b["axis"] == "x" else min(b["a"][1], b["b"][1])
    b1 = max(b["a"][0], b["b"][0]) if b["axis"] == "x" else max(b["a"][1], b["b"][1])
    return not (b0 - a1 > 28 or a0 - b1 > 28)


def site_side_for_candidate(item, site):
    horizontal = abs(item["a"][1] - item["b"][1]) <= abs(item["a"][0] - item["b"][0])
    if horizontal:
        cy = (item["a"][1] + item["b"][1]) / 2
        side = "top" if abs(cy - site[1]) <= abs(cy - (site[1] + site[3])) else "bottom"
        distance = abs(cy - site[1]) if side == "top" else abs(cy - (site[1] + site[3]))
        return side if distance <= max(78, site[3] * 0.14) and item["length_px"] >= site[2] * 0.22 else None
    cx = (item["a"][0] + item["b"][0]) / 2
    side = "left" if abs(cx - site[0]) <= abs(cx - (site[0] + site[2])) else "right"
    distance = abs(cx - site[0]) if side == "left" else abs(cx - (site[0] + site[2]))
    return side if distance <= max(78, site[2] * 0.14) and item["length_px"] >= site[3] * 0.22 else None


def line_support(canny, a, b):
    length = line_length(a, b)
    steps = max(8, min(90, math.ceil(length / 6)))
    votes = 0
    for index in range(steps + 1):
        t = index / steps
        x = int(round(a[0] + (b[0] - a[0]) * t))
        y = int(round(a[1] + (b[1] - a[1]) * t))
        x0 = max(0, x - 2)
        x1 = min(canny.shape[1], x + 3)
        y0 = max(0, y - 2)
        y1 = min(canny.shape[0], y + 3)
        if np.any(canny[y0:y1, x0:x1] > 0):
            votes += 1
    return votes / max(1, steps + 1)


def sample_pixel(image, point):
    x = int(round(max(0, min(image.shape[1] - 1, point[0]))))
    y = int(round(max(0, min(image.shape[0] - 1, point[1]))))
    b, g, r = [int(v) for v in image[y, x]]
    max_v = max(r, g, b)
    min_v = min(r, g, b)
    saturation = 0 if max_v <= 0 else (max_v - min_v) / max_v
    value = max_v / 255
    exg = 2 * g - r - b
    vegetation = exg > 18 and g > r + 8 and g > b + 4 and saturation > 0.12
    hardscape = saturation < 0.32 and 0.34 < value < 0.9
    return {"vegetation": vegetation, "hardscape": hardscape}


def normalize_line(line):
    x1, y1, x2, y2 = line
    if abs(x2 - x1) >= abs(y2 - y1):
        return (x1, y1, x2, y2) if x1 <= x2 else (x2, y2, x1, y1)
    return (x1, y1, x2, y2) if y1 <= y2 else (x2, y2, x1, y1)


def normalize_bbox(bbox):
    x, y, w, h = [float(v) for v in bbox]
    return [round_float(x), round_float(y), round_float(max(0, w)), round_float(max(0, h))]


def point_in_any_bbox(point, boxes):
    return any(point_in_bbox(point, box) for box in boxes)


def point_in_bbox(point, box):
    return box[0] <= point[0] <= box[0] + box[2] and box[1] <= point[1] <= box[1] + box[3]


def distance_to_site_edge(point, site):
    x, y = point
    sx, sy, sw, sh = site
    return min(abs(x - sx), abs(x - (sx + sw)), abs(y - sy), abs(y - (sy + sh)))


def distance_to_side(item, site, side):
    if side == "top":
        return abs((item["a"][1] + item["b"][1]) / 2 - site[1])
    if side == "bottom":
        return abs((item["a"][1] + item["b"][1]) / 2 - (site[1] + site[3]))
    if side == "left":
        return abs((item["a"][0] + item["b"][0]) / 2 - site[0])
    return abs((item["a"][0] + item["b"][0]) / 2 - (site[0] + site[2]))


def line_length(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def avg(values):
    values = [value for value in values if value is not None and math.isfinite(value)]
    return sum(values) / len(values) if values else 0


def count_by(items, key):
    result = {}
    for item in items:
        value = item.get(key) or "unknown"
        result[value] = result.get(value, 0) + 1
    return result


def issue(severity, rule_id, message):
    return {"severity": severity, "rule_id": rule_id, "message": message}


def correction_targets(qa):
    targets = []
    if qa["site_perimeter_confidence"] < 0.5:
        targets.append({
            "target": "opencv_edge_v1.site_perimeter_candidates",
            "action": "inspect_opencv_rejected_site_perimeter_alternatives",
            "reason": "OpenCV site perimeter confidence is low or incomplete",
        })
    if qa["road_boundary_confidence"] < 0.45:
        targets.append({
            "target": "opencv_edge_v1.candidate_edges",
            "action": "add_ground_surface_or_boundary_support",
            "reason": "OpenCV road boundary confidence is low",
        })
    return targets


def round_float(value, digits=3):
    if value is None or not math.isfinite(float(value)):
        return 0
    return round(float(value), digits)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--source-image", default=None)
    parser.add_argument("--output", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--width", type=int, default=None)
    parser.add_argument("--height", type=int, default=None)
    parser.add_argument("--site-bbox", required=True)
    parser.add_argument("--building-boxes", default="[]")
    parser.add_argument("--parking-boxes", default="[]")
    return parser.parse_args()


if __name__ == "__main__":
    main()
