# Image Structured Modeler

> 子项目：从多张参考图片生成可编辑、结构化的 SketchUp MCP 模型计划，而不是生成不可编辑的点云/三角网。

创建时间：2026-05-11

## 一句话定位

Image Structured Modeler 是 SketchUp MCP 的上游“视觉理解与结构化建模规划器”。

它不直接替代 SketchUp MCP，也不以三角网点云为最终目标；它负责把图片理解成可编辑的对象结构、约束、轮廓、部件层级和参数，最后输出 SketchUp MCP JSON DSL 或中间结构化模型计划。

```text
参考图片 / 三视图 / 实拍多角度
        ↓
Image Structured Modeler
  - 相机/视角校正
  - 轮廓与关键点识别
  - 部件语义拆解
  - 尺寸与比例约束
  - 参数化组件规划
        ↓
Structured Model Plan
        ↓
SketchUp MCP JSON DSL
        ↓
SketchUp Runtime / .skp
```

## 它和 SketchUp MCP 的关系

### SketchUp MCP 是“执行层”

负责：

- 接收安全 JSON DSL
- 生成 SketchUp 几何
- 管理材质、场景、保存文件
- 提供 mock/queue runtime
- 返回 snapshot 做质量检查

SketchUp MCP 不应该承担复杂视觉识别，否则会变成一个又大又难测的黑盒。

### Image Structured Modeler 是“理解层 / 编译前端”

负责：

- 读图片
- 判断视角和透视
- 提取轮廓、关键点、部件语义
- 形成可解释的结构化对象树
- 选择合适的 SketchUp DSL 组件
- 生成可审查的 2D overlay 和 3D plan

它输出的是干净结构，而不是直接生成一坨 mesh。

## 当前可运行入口

```bash
npm run image-structured:analyze-switch
npm run image-structured:generate-switch
npm run image-structured:compile-switch
npm run image-structured:review-switch
npm run image-structured:visual-relation-switch
npm run image-structured:visual-relation-building-group
npm run image-structured:geometry-fit-building-group-candidates
npm run image-structured:photo-grade-readiness-building-group
npm run image-structured:edge-preprocess-building-group
npm run image-structured:opencv-edge-building-group
npm run image-structured:segmentation-backend-compare-building-group
npm run image-structured:boundary-groundplan-ablation-building-group
npm run image-structured:bird-eye-land-cover-building-group
npm run image-structured:boundary-graph-building-group
npm run image-structured:boundary-completion-building-group
npm run image-structured:bird-eye-groundplan-building-group
npm run image-structured:bird-eye-segmentation-building-group
npm run image-structured:auto-groundplan-building-group
npm run image-structured:structured-plan-building-group
npm run image-structured:part-graph-building-group-r10-groundplan
npm run image-structured:photo-grade-readiness-second-sample
npm run image-structured:auto-groundplan-second-sample
npm run image-structured:photo-grade-readiness-real-sample
npm run image-structured:auto-groundplan-real-sample
npm run image-structured:proposal-review-chain-building-group-candidates
npm run image-structured:snapshot-switch
npm run image-structured:snapshot-switch:queue
npm run image-structured:diff-switch:queue
npm run image-structured:build-switch
npm run image-structured:generate-remote
npm run image-structured:compile-remote
npm run image-structured:review-remote
npm run image-structured:snapshot-remote
npm run image-structured:build-remote
npm run image-structured:build-ambulance-part-graph
npm run test:image-structured
```

`analyze-switch` 会读取 `test/手柄`，生成：

- `projects/image-structured-modeler/examples/switch-controller/observations.json`
- `projects/image-structured-modeler/examples/switch-controller/review-overlays/*.png`

`build-switch` 会串起 analyze → generate model plan → compile DSL，额外生成：

- `projects/image-structured-modeler/examples/switch-controller/model-plan.json`
- `projects/image-structured-modeler/examples/switch-controller/output.json`
- `projects/image-structured-modeler/examples/switch-controller/review/index.html`
- `projects/image-structured-modeler/examples/switch-controller/visual-relation-qa/report.json`
- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-report.json`
- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-report.md`

当前 `observations.json` 和 `model-plan.json` 都会记录 evidence graph：每个 part 有 `required_views`、`confirmed_views`、`missing_views`、`sources`、`conflicts` 和 open questions。`observations.json` 还会记录 `visual_relation_graph`，把 image-space 的 `left_of` / `right_of` / `above` / `below` / `inside` / `aligned_with` / `touching` / `same_row` / `mirrored_pair` / `centered_on` 候选关系写成带 source image、bbox/keypoint/semantic-anchor basis、confidence 和 `review_required` 的结构化证据，并同步到 `evidence_graph.visual_relations`。`model-plan.review.semantic_fusion` 会进一步把跨视图 evidence 融合为 per-part `status`、`decision`、`confidence`、semantic evidence、feature mapping signals 和 review flags。Review 页面会显示 Evidence Graph、Semantic Fusion、Correction Patch Suggestions 和 Corrections Workbench，方便把人工确认直接转成可编辑/可下载的 `manual-corrections.json` patch。

`image-structured:visual-relation-switch` 会把 Switch 之前的人工视觉检查变成代码 fixture：`visual-relations.fixture.json` 读取 observation relation candidates，并对比 accepted Switch PartGraph 投影里的左右顺序、间距比例、手性、父子包含和镜像对。当前 fixture 检查 6 条关系和 8 个 contour/keypoint footprint，报告在 `examples/switch-controller/visual-relation-qa/report.json`，并包含 `mirror_x` 负例来确认左右镜像会被打回。`image-structured:geometry-fit-switch` 会输出 Switch 控件投影 residual。

`image-structured:visual-relation-building-group` 使用同一套 VisualRelationGraph QA 跑建筑群 fixture：当前检查 12 条关系，报告在 `examples/building-group/visual-relation-qa/report.json`。其中 6 条蓝顶厂房、仓库 row、停车场、site boundary、罐区关系会对比 massing PartGraph 投影，6 条四栋仓库、停车线/车道、树列关系保留为 image-only QA；同时 `part-graph.massing.json` 会把这些细粒度对象写成 review-gated `part_candidates` proposals，防止把未确认的视觉识别误报成已可编辑几何。可判定的方向/包含关系还会同步进入 PartGraph `physical_relations`，由 physical consistency QA 检查模型投影后的空间关系。

`image-structured:geometry-fit-building-group-candidates` 是 Perception-to-Geometry Grounding v2 的第一刀：它使用同一份 candidate fixture，对 top-view image frame 和 site boundary 做 affine projection calibration，并输出 `proposal-qa-candidates/geometry-fit-report.json`。当前 mock/live queue 报告检查 9 个 mask/contour footprint、12 条 projected relation、4 个 known-element scale anchor 和 1 个 `mirror_x` handedness negative；max center residual `0.003`，max relation residual `0.002`，max scale residual `0.118`，grounding issues 0。右下角两条停车线、negative-space drive aisle 和 tree row 已由 bbox proxy / mixed grounding 改为 mask/gap/contour-grounded evidence。

`image-structured:grounding-v3-building-group` 是 R9 GroundingGraph v3 门：`ObservationSet.grounding_v3` 和 `PartGraph.evidence_graph.ground_plan` 会记录多候选 `ScaleAnchorGraph`、R10-backed `GroundPlan` regions、parking/road line-grid residual、TopViewOverlay QA 和 `promoted_geometry` / `review_candidate` / `helper_only` / `rejected` promotion decisions。当前报告为 `proposal-qa-candidates/grounding-v3-report.json`，检查 5 个 scale anchor、3 个 anchor family、13 个 ground regions、2 条 parking line fit，并保持 `photo_grade_candidate=false`。

`image-structured:bird-eye-land-cover-building-group` / `image-structured:bird-eye-groundplan-building-group` / `image-structured:bird-eye-segmentation-building-group` 是 R11 BirdEyeLandCover 门：它把鸟瞰图作为独立 land-cover 品类，默认用 local classical CV 先输出 building exclusion、paved surface、road/parking surface candidates、markings、vegetation、bare soil 和 shadow/unknown，再交给 AutoGroundPlan。当前 `land-cover-v1-report.json` 为 `verdict=pass`，summary 包含 `unknown_land_cover_ratio=0.013`、`paved_surface_ratio=0.195`、`vegetation_ratio=0.207`、`boundary_confidence=0.791`；`structured-plan/bird-eye-segmentation.png` 是四联 QA 入口：original、raw land-cover mask、source edge overlay、final planar subdivision。

`image-structured:boundary-graph-building-group` / `image-structured:boundary-completion-building-group` 是 R11.1/R11.2 BoundaryGraph + aggressive completion 门：它把肉眼清晰的厂区外围边线、道路边线、铺装/绿化分界线聚合成 `boundary_graph_v1`，并允许 observed、completed、extrapolated、weak inferred 几何进入 structured output，但全部带 `inference_level`、completion hypothesis 和 QA trace。当前 `boundary-graph-v1-report.json` 会融合 source-image detector、HighContrastEdge 和真实 OpenCV edge backend：OpenCV 可用时 `opencv_edge_available=true`、`opencv_version=4.13.0`、`opencv_boundary_edge_count=112`，BoundaryGraph 当前 `site_boundary_closure_ratio=1`、`road_corridor_count=7`。BoundaryGraph 自身为 `verdict=review`，它证明 edge extraction 可进入结构化链路，但不会自动让 photo-grade readiness 晋级。

`image-structured:edge-preprocess-building-group` / `image-structured:opencv-edge-building-group` / `image-structured:segmentation-backend-compare-building-group` / `image-structured:boundary-groundplan-ablation-building-group` 是 R11.2 Edge-First backend test 门。`HighContrastEdge v1` 仍保留 JS fallback，输出 `edge-v1-report.json`、`edge-preprocess-debug.png` 和 `edge-candidate-classification.png`；新增的 `OpenCvEdge v1` 则使用真实 Python `cv2` backend（CLAHE、Canny、HoughLinesP、LSD when available），输出 `opencv-edge-v1-report.json`、`opencv-edge-preprocess-debug.png` 和 `opencv-edge-candidate-classification.png`。当前 building-group OpenCV report 为 `backend=opencv_clahe_canny_hough_lsd_v1`、`opencv_version=4.13.0`、`verdict=pass`：accepted edges 112、rejected edges 148、site perimeter confidence 0.778、road boundary confidence 0.727、building outline confidence 0.848、roof seam rejection count 77。`segmentation-backend-compare-report.json` 仍把 INSID3 作为 optional backend contract：默认 `insid3_status=skipped_unavailable`，fused observed mask candidates 59，promoted geometry 0；它会生成 `reference-mask-bank/` scaffold，但没有 Python/DINOv3/INSID3 环境时不会声称实际使用 INSID3。`boundary-groundplan-ablation-report.json` 当前对比 source-edge、HighContrastEdge-only、OpenCV-only 和 fused 四条路径；fused summary 记录 `fused_opencv_boundary_edges=112`、`fused_high_contrast_boundary_edges=86`、`accepted_edge_source_breakdown.opencv_edge_v1_segment=104`，remaining unknown gap 为 0.198。因此 R11.2 的纠偏结果是把真实 OpenCV 边线接进结构化链路，并暴露可解释边线/拒绝边线；它仍不是 photo-grade 晋级。

OpenCV backend 的运行依赖本地 Python `cv2` / `numpy`。当前测试机使用 `python3 -m pip install --target output/python-opencv-smoke numpy opencv-python-headless` 安装，脚本也会读取 `OPENCV_PYTHONPATH` 或 `output/python-opencv`；缺少依赖时 `OpenCvEdge v1` 会写出 unavailable/skip report，只有显式传 `--require-opencv` 才会让命令失败。

`image-structured:auto-groundplan-building-group` / `image-structured:structured-plan-building-group` 是 R10/R11/R11.2 AutoGroundPlan hardening 门：它在 Grounding v3 前增加 `GroundEvidenceResolver`、`ParkingGridCanonicalizer`、`RoadCorridorBuilder`、rectilinear `PlanarSubdivisionBuilder`、R10.5 `GapCompletionSolver`、R11 `BirdEyeLandCover`、R11.1 `BoundaryGraph`、R11.2 `HighContrastEdge`、`OpenCvEdge` 和 `StructuredPlan QA`。当前 `structured-plan/structured-plan-qa-report.json` 为 `verdict=review`，但 hard gates 已收紧到 `road_building_overlap_ratio=0`、`raw_contour_leakage=0`、`parent_child_double_occupancy=0`、`canonical_region_overlap_ratio=0`；source-edge + OpenCV + high-contrast fused path 后 site surface 来自 boundary graph `[81,31,738,558]`，`gap_ratio=0.474`、`gap_completion_ratio=0.557`、`remaining_unknown_gap_ratio=0.198`、`road_candidate_review_count=0`、`boundary_road_corridor_count=7`。这个 gap 仍会阻止 photo-grade candidate；R11.2 的成功点是把真实边线证据、rejected alternatives 和 optional segmentation backend contract 暴露出来，而不是把 unknown gap 强行压低。默认 HTML 先显示 Bird-eye QA 四联图，structured view 画 canonical subdivision 和带样式的 inferred/review surfaces，raw evidence、layout prior 和 rejected conflicts 只在 diagnostic view 出现。`image-structured:part-graph-building-group-r10-groundplan` 会生成 `part-graph.r10-groundplan.json`，证明 R10/R11/R11.2 PartGraph path 不再 emit `internal_roads`、`parking_lot` 或 `warehouse_row_*` parent occupancy。

`image-structured:grounding-v2-second-sample` / `image-structured:grounding-v3-second-sample` 是当前泛化门：它生成第二个可分发建筑群样本 fixture，跑通 ObservationSet、EvidenceGraph、PartGraph candidate promotion、mock compile、GeometryFit v2 和 Grounding v3。当前第二样本 Grounding v3 检查 4 个 scale anchor、2 个 anchor family、13 个 ground regions、2 条 parking line fit，并同样保持 `photo_grade_candidate=false`，用于证明证据链和失败门槛可复用，而不是声明照片级重建。

`image-structured:photo-grade-readiness-building-group` / `:second-sample` / `:real-sample` 是 R9.5 PhotoGradeReadiness 门：它在 Grounding v3 之上统一检查 scale、subdivision、line/grid、top-view overlay、oblique/facade 和 promotion 六类 gate，并输出 `photo-grade-readiness-report.json`。当前 building-group candidate 与 second sample 都是 `photo_grade_readiness=technical_baseline`、`photo_grade_candidate=false`：line/grid 和 top-view overlay 已过 candidate 阈值，但 scale review、GroundPlan gap、oblique/facade 证据和 review/helper promotion 仍阻止晋级。`examples/building-real-photo-smoke/` 是真实/历史照片 contract scaffold；在没有真实建筑照片资产前，它完整跑同一 gate，但 verdict 固定为 `review_required`，blocker 指向缺失真实输入资产。

`image-structured:proposal-review-chain-building-group-candidates` 会接受 `part-candidate-review.accepted-warehouses.json` 中的 8 个关系候选，生成 `correction-patch.part-candidates.json`、`part-graph.part-candidates-applied.json`、`output.part-candidates-applied.json`、`proposal-review-candidates/index.html` 和 `proposal-qa-candidates/report.json`。当前结果把两条 warehouse row 退成不编译 reference container，并新增 4 个 `manual_confirmed` warehouse unit parts、2 条 parking stall row、1 条 parking drive aisle 和 1 条 tree row；mock proposal QA 会同时跑 layout/reference/visual relation/GeometryFit/physical gates。live queue 版会保存 `output/image-structured-building-group-candidate-warehouses.skp`，当前 proposal QA 为 `ok=true`，但这仍只是当前生成图样例的技术基线，不是照片级/测绘级完成。

`feature_semantics` 的第一批真实 feature op 映射已经接入：`blind_recess` 会编译为 `cut_recess`，`through_hole` 会编译为 `cut_hole`，`convex` 会按部件形态编译为 `add_boss` 或 `add_raised_rib`。Review 的 parts 表会显示当前是 `real feature op` 还是 `fallback: visual_marker`。

主线 CAD boolean/manifold 已补齐 `boolean_union`、`boolean_difference`、`boolean_intersect`、`manifold_check` 和 `manifold_repair`。子项目下一步会把这些实体操作纳入更多产品样例，减少开孔、实体相交和拓扑修复场景里的 visual fallback。

当前 compact remote queue snapshot 已验证 feature mapping 链路：输出包含 `add_boss ×6`、`add_raised_rib ×1`、`cut_recess ×5`，真实 queue 产物为 `3 groups / 369 faces / 1035 edges / 690 vertices / 2 scenes`，warning gate pass。Switch queue snapshot/diff 也已刷新，warning gate pass。

`build-remote` 会使用第二产品样例 `examples/compact-remote`，验证生成器/编译器已经按 `object_profile` 分流，而不是只套 Switch-specific layout prior。该样例会生成：

- `projects/image-structured-modeler/examples/compact-remote/model-plan.json`
- `projects/image-structured-modeler/examples/compact-remote/output.json`
- `projects/image-structured-modeler/examples/compact-remote/review/index.html`
- `projects/image-structured-modeler/examples/compact-remote/review/snapshot-report.json`
- `projects/image-structured-modeler/examples/compact-remote/review/snapshot-report.md`

`build-ambulance-part-graph` 是 R4 图像证据升级的第一条 PartGraph 链路：它会读取 `test/救护车` 和 `vehicle_ambulance` ProductProfile 的 reference image hints，生成：

- `projects/image-structured-modeler/examples/ambulance/observations.json`
- `projects/image-structured-modeler/examples/ambulance/review-overlays/*.png`
- `projects/image-structured-modeler/examples/ambulance/part-graph.generated.json`
- `projects/image-structured-modeler/examples/ambulance/part-graph.skeleton.json`
- `projects/image-structured-modeler/examples/ambulance/part-graph.proposal-applied.json`
- `projects/image-structured-modeler/examples/ambulance/output.proposal-applied.json`
- `projects/image-structured-modeler/examples/ambulance/output.generated.json`
- `projects/image-structured-modeler/examples/ambulance/reference-visual-qa/ambulance-generated/report.json`
- `projects/image-structured-modeler/examples/ambulance/correction-patch.reference-visual.json`
- `projects/image-structured-modeler/examples/ambulance/part-graph.corrected.json`
- `projects/image-structured-modeler/examples/ambulance/quality-report.json`

该链路会把 coarse contour/polyline、bbox/keypoint candidates、跨图 part matching、profile-backed scale calibration、orientation/mirror hints 和 per-part confidence 写入 generated PartGraph。当前 seed 版本输出 53 个 parts：10 个 `observed`、41 个 `inferred`、2 个 `needs_review`，证据状态已经没有 `profile_default`；质量门禁会显式检查 `profile_default_ratio=0`、`needs_review_ratio<=0.12`、尺度置信度和 parameter proposal 覆盖。无 seed skeleton 版本会生成 7 个 profile-required parts，并把 inferred-only 的图像证据保留为 `needs_review`，用于表达“有部分证据但不能当作已确认几何”。R6 当前边界已让 no-seed skeleton 生成 20 条 review-gated `parameter_proposals`，每条记录 PartGraph path、当前值、候选值、置信度、图像尺度校准和 bbox/keypoint measurement；seed generated PartGraph 记录 45 条 proposal。`observations.json` 现在会为每张图写入 `orientation_hints`：包含 `image_x_right_y_down` 坐标约定、mirror risk、semantic anchors 和 `review_required`，例如 ambulance side view 会记录 front/rear wheel 与 cab/body 的手性锚点，避免把左右镜像误判静默传入模型布局。`image-structured:proposal-patch-ambulance` 会读取 `parameter-proposal-review.accepted.json`，把已接受 proposal 转成 `correction-patch.parameter-proposals.json` 并应用到 `part-graph.proposal-applied.json`。`image-structured:proposal-review-ambulance` 生成 `proposal-review/index.html`，用于勾选 proposal、预览 patch targets 并导出 accepted proposal JSON。`image-structured:proposal-review-chain-ambulance` 会继续编译 `output.proposal-applied.json` 并运行 mock QA；`:queue` 版本会保存 `output/image-structured-ambulance-proposal-applied.skp`。当前只接受 body/cab 两项时报告 `review_required: true`，layout/reference QA fail，physical consistency pass。Reference Visual QA 通过时 correction patch 为空；测试会人工制造侧窗漂移和镜像/手性负例，验证 `update_part_graph` suggestion 能生成并应用 PartGraph correction patch，再降低 reference visual QA issue 数。主线产品样本 gate 还会对 ambulance、Switch、Fuji 的 PartGraph physical relations 做一致性检查。

`snapshot-switch` 会对当前 DSL 运行 mock snapshot，并把 warning 分成 expected contact / shallow overlap / needs review 等 bucket。当前 Switch DSL 会为 face dome、rear grip、thumbstick、buttons、screws 写入 `qa.expected_contacts`，warning 分类会优先使用这些元数据，而不是只靠对象命名启发式。当前 mounted detail 已改用 `analog_stick`、`button_on_panel`、`screw_hole`，rear grip attachment 已调整为接触不穿插，mock geometry warning 已收敛到 0。

`snapshot-switch:queue` 会通过 SketchUp queue runtime 生成真实 `.skp` 和 queue snapshot report，运行前需要 SketchUp 已启动 Alma SketchUp MCP Bridge。更新 `sketchup_plugin/alma_sketchup_mcp.rb` 后，需要重载插件或重启 SketchUp，queue snapshot 才会带出最新的 `qa` 元数据。

`diff-switch:queue` 会复用根项目 `src/snapshot-diff.mjs` 的 mock/queue snapshot 对比逻辑，生成：

- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-diff-queue.json`
- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-diff-queue.md`

它会自动对照 totals、bbox、scene/material parity，并把 mock/queue 两侧 warning bucket 做 delta 汇总；运行前同样需要 SketchUp + Alma SketchUp MCP Bridge 正在响应 queue runtime。

当前 Switch 示例的 warning budget 在：

- `projects/image-structured-modeler/examples/switch-controller/warning-budget.json`

`npm run test:image-structured` 会读取样例 warning budget，校验 mock/queue snapshot report 中没有 error warning、没有 `needs_geometry_review`，并锁定当前 expected bucket baseline。测试还会卡住 bbox、groups/instances/scenes、不能回退到粗 `mesh` / `box` primitive，并要求 Switch mock 和已生成的 queue geometry warning 分类全部来自 `qa.expected_contacts`。阶段 6 已新增 correction-driven regression：`manual-corrections.regression.json` 必须让 Switch `model-plan.json` 和编译后的 DSL 发生预期变化；`manual-corrections.feature-regression.json` 会验证只改 manual corrections 就能把 compact remote 的 decal/text marker 改成真实 `cut_recess`；compact remote 第二样例必须完整跑通 observations → model-plan → output → review → mock snapshot；evidence graph / semantic fusion / corrections workbench 也纳入门禁，防止单图输出重新伪装成多图确认。

人工修正入口：

- `projects/image-structured-modeler/examples/switch-controller/manual-corrections.json`
- `projects/image-structured-modeler/examples/switch-controller/manual-corrections.regression.json`
- `projects/image-structured-modeler/examples/compact-remote/manual-corrections.json`

改完 `manual-corrections.json` 后重新运行 `npm run image-structured:build-switch`，修正会进入 `model-plan.json`，并显示在 review report 中。Review 里的 Corrections Workbench 会基于 Correction Patch Suggestions 生成可编辑 JSON，支持选择 patch、校验、复制和下载 `manual-corrections.workbench.json`；默认把待确认 part 标为 `manual_confirmed` 并保留当前 feature semantics / fallback 信息。

当前实现是确定性的 CV baseline：缩放图片、Sobel 边缘检测、主 bbox、coarse contour/polyline、bbox keypoints、垂直对称轴候选、视角启发式分类。Switch 示例会额外读取 `model-plan.example.json` 里的 `views[]` 作为人工视角 hint；ambulance 示例读取 `ProductProfile.reference_images` 作为 view hints；compact remote 示例使用固定 observation fixture 验证第二产品路径。通用 CLI 不传 `--view-hints-file` 时仍走纯 CV 模式。它只负责给人工 review、PartGraph 更新和后续 VLM/语义识别提供第一版证据，不直接声称完成照片级 3D 重建。

### 两者边界

| 层级 | 负责什么 | 不负责什么 |
|---|---|---|
| Image Structured Modeler | 图片理解、部件拆解、参数计划、轮廓/关键点、建模策略 | 直接操作 SketchUp、保存 `.skp`、插件 runtime |
| SketchUp MCP | 安全 DSL 执行、SketchUp 几何落地、材质/场景/snapshot | 图片识别、相机估计、语义推理 |

## 产品化流程

### 1. 输入阶段

用户上传：

- 严格三视图：front / side / top / back
- 非正交实拍：多个角度照片
- 产品页尺寸图
- 细节特写
- 可选已知尺寸：总宽、总高、厚度、某个按钮直径等

系统先做输入质量报告：

```json
{
  "object_type": "game_controller",
  "image_set_quality": "medium",
  "views_detected": ["front", "rear", "right_side", "top_oblique"],
  "missing_views": ["true_top", "left_side"],
  "known_scale": null,
  "risk_notes": [
    "front photo has perspective distortion",
    "black glossy grip has weak contour contrast",
    "side thickness partly occluded"
  ]
}
```

### 2. 视角校正阶段

目标不是三维重建，而是把非正交照片转成更可靠的参考层。

方法：

- 找对称轴
- 找长直边/平行边
- 用已知圆形按钮在透视下的椭圆反推局部透视
- 根据对象类别套用结构先验
- 生成近似正交 overlay

输出：

- front rectified overlay
- side thickness overlay
- rear/back grip overlay
- top/depth overlay

### 3. 结构识别阶段

识别的不是像素，而是组件：

```json
{
  "components": [
    { "id": "center_grip", "type": "rounded_rect_body", "material": "black_plastic" },
    { "id": "left_joycon", "type": "rounded_panel_shell", "material": "white_plastic" },
    { "id": "right_joycon", "type": "rounded_panel_shell", "material": "white_plastic" },
    { "id": "left_thumbstick", "type": "analog_stick", "parent": "left_joycon" },
    { "id": "abxy_cluster", "type": "button_cluster", "parent": "right_joycon" },
    { "id": "rear_grip_left", "type": "lofted_handle", "material": "black_plastic" }
  ]
}
```

### 4. 人工确认阶段

必须有一个 review artifact。不要直接出 3D。

对用户展示：

- 识别到的部件框
- 关键轮廓线
- 按钮中心点
- 对称轴
- 厚度曲线
- 不确定区域标红

用户可以说：

- “右边握把再厚一点”
- “这个不是按钮，是螺丝”
- “这里是凹槽不是凸起”
- “整体宽度按 280mm 算”

### 5. 参数化模型计划阶段

把识别结果转为 DSL 前的中间表示。

```json
{
  "scale": { "unit": "mm", "known_width": 280 },
  "parts": [
    {
      "name": "left_joycon_shell",
      "primitive": "beveled_panel",
      "profile_front": [[...]],
      "profile_side": [[...]],
      "thickness": 22,
      "corner_radius": 18,
      "material": "Warm_White_Plastic"
    },
    {
      "name": "left_thumbstick",
      "primitive": "button_on_panel",
      "center": [-112, 24, 27],
      "radius": 19,
      "recess_depth": 3,
      "material": "Rubber_Thumbstick"
    }
  ]
}
```

### 6. SketchUp MCP 输出阶段

生成安全 DSL：

- `component_definition` for simple repeated markers such as LEDs
- `component_instance` for reuse
- high-level primitives: `rounded_box`, `beveled_panel`, `loft_between_profiles`, `analog_stick`, `button_on_panel`, `screw_hole`, `text_emboss`
- scenes for front/top/side/rear review

### 7. 质量回路

通过 mock snapshot 和真实 queue snapshot 检查：

- group count
- bbox 是否符合尺寸
- 组件命名是否完整
- 是否存在零面/退化面
- 碰撞 warning 是否是预期接触
- 文件体积是否异常

## 为什么不直接点云 / 三角网

点云或 AI mesh 适合“看起来像”。

但产品目标是 SketchUp 里可编辑的结构化模型，所以直接点云有明显问题：

- 没有组件语义
- 面数大
- 不好改尺寸
- 不好替换材质
- 不好对齐/布尔/开槽
- 小细节容易糊
- SketchUp 里编辑体验差

点云/AI mesh 可以作为参考，不应作为最终模型。

## 最佳路线：混合式

```text
多图视觉估计 / 粗点云 / 深度估计
        ↓ 作为参考底模
结构化部件识别
        ↓
参数化组件生成
        ↓
SketchUp MCP 执行
```

即：

- 点云帮助判断大体曲面和比例
- 语言模型帮助判断“这是什么部件”
- 参数化 DSL 负责生成可编辑模型

## 需要补的 SketchUp DSL 能力

来自 Switch 手柄测试暴露的问题：

### 形体类

- `rounded_box`
- `beveled_panel`
- `fillet`
- `chamfer`
- `loft_between_profiles`
- `shell_from_front_side_profiles`
- `pipe_between_points`
- `face_on_cylinder`

### 细节类

- `button_on_panel`
- `analog_stick`
- `recess`
- `slot`
- `screw_hole`
- `boolean_cutout`
- `boolean_union` / `boolean_difference` / `boolean_intersect`
- `manifold_check` / `manifold_repair`
- `engraved_line`
- `text_emboss`
- `text_engrave`

### 复用/性能类

- robust `component_definition` / `component_instance` workflows
- repeated mesh instance reuse
- adjustable curve resolution
- snapshot file-size estimate
- warning classification

## MVP 范围

第一版先不要做大而全。

建议 MVP：

1. 支持单个对象类别：game controller / product gadget
2. 输入 3-6 张图片
3. 生成人工可审查 overlay
4. 手动/半自动标注关键点
5. 输出结构化 model plan
6. 生成 SketchUp MCP DSL
7. 支持 rounded panel、buttons、sticks、grip handles、logos 的基础版本

## MVP 子模块

```text
projects/image-structured-modeler/
  README.md
  schema/
    model-plan.schema.json
    image-observation.schema.json
  scripts/
    analyze-image-set.mjs
    make-review-overlay.mjs
    compile-plan-to-sketchup-dsl.mjs
  examples/
    switch-controller/
      observations.json
      model-plan.json
      output.json
```

## 关键原则

- 先结构，后几何
- 先 overlay，后 3D
- 点云只做参考，不做最终输出
- 每个部件必须有名称、类型、材质和来源证据
- 不确定的地方标红，不要假装确定
- SketchUp 输出必须可编辑、可分组、可复用
