# Image Structured Modeler Memo

更新时间：2026-06-01

## 当前结论

子项目已经从“方向和 schema”推进到“Switch 手柄示例闭环 baseline + 第二产品泛化样例”，但本轮验收后结论需要下调：当前能力适合作为技术预览和研发基线，不适合按阶段成果直接发布。

当前 Switch 链路能从 `test/手柄` 生成：

```text
observations.json -> model-plan.json -> output.json -> review/index.html -> mock/queue SketchUp output
```

它不是闭门造车：架构参考过 Free2CAD、Img2CAD、CSGNet、PartNet、DeepCAD 等项目，但当前实现没有直接照搬这些项目代码，而是吸收它们的思路后落成自己的确定性 CV baseline、人工 review/corrections 和 SketchUp DSL 编译器。

阶段 6 收口新增并补齐了这些技术预览门槛：

- correction-driven regression：`examples/switch-controller/manual-corrections.regression.json` 会验证只改 corrections 就能改变 `model-plan.json` 里的 part 参数，并进一步改变编译后的 DSL。
- 第二产品样例：`examples/compact-remote` 通过 `object_profile: "compact_remote"` 走独立生成/编译路径，生成 `model-plan.json`、`output.json`、`review/index.html` 和 mock snapshot。
- evidence status 边界切片：`model-plan.json`、`manual-corrections.json`、review report 和 `npm run test:image-structured` 已接入 `observed` / `inferred` / `template_prior` / `manual_confirmed`，单图输出会记录 open question 和 template-prior 状态。
- evidence graph：`observations.json` 已有原生 `evidence_graph`，`model-plan.review.evidence_graph` 会优先合并该图，并按 part 汇总 required/confirmed/missing views、source records、template-prior / feature fallback conflicts 和 part-level open questions；review report 已新增 Evidence Graph 表格。
- VisualRelationGraph 第一切片：`observations.json` 现在会写入 image-space `visual_relation_graph`，覆盖 `left_of` / `right_of` / `above` / `below` / `inside` / `aligned_with` / `touching` / `same_row` / `mirrored_pair` / `centered_on`，每条 relation 都带 source image、bbox/keypoint/semantic-anchor basis、confidence 和 `review_required`；该 relation graph 会同步进入 `evidence_graph.visual_relations`，PartGraph 生成器会把匹配到 part id 的关系回灌到 `evidence_graph.visual_relations`、part `relationships` 和可检查的 spatial `physical_relations`。
- correction patch suggestions：`model-plan.review.correction_suggestions` 和 review report 会给出可复制到 `manual-corrections.json` 的 patch 骨架，用于把待确认 part 显式标成 `manual_confirmed`，并保留当前 feature semantics / fallback 信息。
- feature mapping 第一切片：`blind_recess -> cut_recess`、`through_hole -> cut_hole`、`convex -> add_boss/add_raised_rib` 已进入 model-plan 和 compiler；当语义仍只能降级成 marker/helper 时，model-plan graph 和 review 会显式记录 `feature_mapping_fallback` conflict。
- semantic fusion：`model-plan.review.semantic_fusion` 会把 evidence graph 融合为 per-part `status`、`decision`、`confidence`、semantic evidence、feature mapping signals 和 review flags。
- corrections workbench：review HTML 已新增交互式工作台，可选择建议 patch、编辑 JSON、校验、复制和下载 `manual-corrections.workbench.json`。
- R4 image evidence -> PartGraph 闭环：ambulance 样例现在能从 `test/救护车` 生成 `observations.json`、seed `part-graph.generated.json`、no-seed `part-graph.skeleton.json`、compiled DSL、Reference Visual QA report、PartGraph correction patch、corrected PartGraph 和 quality report；contour/polyline、keypoint candidates、跨图 part matching、scale calibration、per-part confidence 和 PartGraph correction targets 都写入产物。
- R6 no-seed 参数提案当前边界：no-seed skeleton 会输出 review-gated `parameter_proposals`，把 image scale calibration、bbox/keypoint measurement 和 profile role ratio 组合成候选 PartGraph 参数；当前 skeleton 覆盖 7 个 required roles、20 条 proposal，seed generated PartGraph 记录 45 条 proposal，质量报告会统计 proposal 覆盖。
- R6 proposal-to-patch 当前边界：`image-structured:proposal-patch-ambulance` 会读取 `parameter-proposal-review.accepted.json`，把 accepted proposal 转成 `part_graph_correction_patch` 并输出 `part-graph.proposal-applied.json`；当前 fixture 接受 `main_body` 和 `cab` shape 参数，共 2 个 set edits。
- R6 proposal review UI 当前边界：`image-structured:proposal-review-ambulance` 会生成 `examples/ambulance/proposal-review/index.html`，列出 20 条 no-seed proposal、预选 fixture 接受项、展示 patch target，并允许导出 accepted proposal JSON。
- R6 proposal review 复验链当前边界：`image-structured:proposal-review-chain-ambulance` 会重建 accepted proposal patch、刷新 proposal review、编译 `output.proposal-applied.json` 并跑 mock QA；`:queue` 版本会保存 `output/image-structured-ambulance-proposal-applied.skp`。当前只接受 body/cab 两项时输出 `review_required: true`，layout/reference QA fail，physical consistency pass。
- 镜像/手性风险已显式证据化：`observations.json` 的每张图会写入 `orientation_hints`，记录 `image_x_right_y_down` 坐标约定、mirror risk、semantic anchors 和 `review_required`；主线 Reference Visual QA 也新增 `orientation` 规则组，Switch 左右摇杆镜像负例会被 `reference.orientation_order` 打回。
- Switch 人工视觉检查已内化成 VisualRelationGraph fixture：`image-structured:visual-relation-switch` 会用 `examples/switch-controller/visual-relations.fixture.json` 对比 observation relation candidates 与 accepted Switch PartGraph 投影，当前检查 6 条关系和 8 个 contour/keypoint footprint（左右手柄、摇杆手性、ABXY vs D-pad、中心屏/面板包含与居中、左右手柄镜像对），0 issues，并用 `mirror_x` 负例确认左右镜像会失败；`image-structured:geometry-fit-switch` 会输出 Switch contour/keypoint projection residual。
- 建筑群关系检查已补第一版 VisualRelationGraph fixture：`image-structured:visual-relation-building-group` 会用 `examples/building-group/visual-relations.fixture.json` 检查 12 条关系 / 0 issues；其中 6 条蓝顶厂房、仓库 row、停车场、site boundary、罐区关系会对比 massing PartGraph 投影，6 条四栋仓库、停车线/车道、树列关系保留 image-only QA，同时进入 PartGraph 的 review-gated `part_candidates` proposal queue。`image-structured:proposal-review-chain-building-group-candidates` 已接受全部 8 个关系候选，把两条 warehouse row 转为不编译 reference container，并新增 4 个 warehouse unit、2 条 parking stall row、1 条 parking drive aisle 和 1 条 tree row 真实 `manual_confirmed` parts；candidate fixture 当前检查 12 条模型关系和 9 个 pixel footprint。Perception-to-Geometry Grounding v2 第一刀已把这些 pixel candidates 升级为 mask/contour evidence，并新增 `image-structured:geometry-fit-building-group-candidates` / `geometry-fit-report.json`，输出 top-view affine projection calibration、center/extent/relation/scale/handedness residual；右下角停车线、negative-space drive aisle 和 tree row 已改为 mask/gap/contour-grounded evidence，mock/live queue GeometryFit 当前通过。
- R7 建筑群当前边界：`image-structured:build-building-group` 会读取 `test/建筑群/` 的 3 张 GPT Image 合成航拍图，使用 `building_group` observation profile 和 `building_group_industrial_campus` ProductProfile，生成 `observations.json`、review overlays、`part-graph.massing.json` 和 `output.massing.json`。scale calibration 使用停车位、车道和人行横道 known-element anchors，估算厂区约 `130m x 98m`；所有 massing shape proposal 仍是 `review_required: true`。`image-structured:qa-building-group` 和 `image-structured:qa-building-group:queue` 已分别生成 mock/live layout/reference QA 报告并通过，queue 版保存 `output/image-structured-building-group-massing.skp`。建筑细节已保留主厂房 accepted subset 回归，并新增 R7 final accepted-all fixture：`image-structured:proposal-review-chain-building-group-all` / `:queue` 会接受 5 个当前 roofline/facade/opening detail proposal target，生成 `part-graph.r7-final.json`、`output.r7-final.json`、`proposal-qa-r7-final/*` 和 `proposal-qa-r7-final-queue/*`，通过 mock/live queue compile/layout/feature Reference Visual QA/physical QA，并保存 `output/image-structured-building-group-r7-final.skp`。这是当前 GPT Image 建筑群样例的 R7 technical baseline，不是测绘级建筑重建。

当前完成度判断：

- Switch-only 技术预览闭环：约 95%。
- 通用“图片 -> 结构化 SketchUp 模型”技术预览 MVP：约 88%。
- 当前优先级：semantic fusion、corrections workbench 和主线 CAD boolean/manifold 已补齐；R1/R2 已把救护车验收迁移到 `ProductProfile + PartGraph -> JSON DSL`；R3 Reference Visual QA 已能对救护车做 silhouette/keypoint/area/relative-placement/orientation gate；R4 已完成 image evidence -> PartGraph -> DSL -> Reference Visual QA -> CorrectionPatch -> QualityGate 的 ambulance 闭环；R5 三产品样本 gate 已由主线完成；R6 已补 no-seed parameter proposals、proposal-to-patch authoring、proposal review UI、proposal-applied mock/queue QA 链路，并在主线把 physical consistency QA 扩到 ambulance/Switch/Fuji 三样例。R7 已完成当前建筑群 evidence/known-scale/massing PartGraph 输入链、mock/live queue layout/reference QA、accepted-all roofline/facade/opening detail proposal -> patch -> feature Reference Visual QA -> mock/live queue QA。2026-06-01 的 Visual Grounding / VisualRelationGraph 第一刀已把 Switch 人工视觉检查变成代码闭环，并把建筑群四栋仓库、停车线/车道、树列候选从 image-only evidence 推进到 accepted promotion、pixel footprint QA、mock/live queue artifact；Grounding v2 现在把 observation/evidence/PartGraph provenance、GeometryFit v2 residual、R8 dense helper exclusion 和第二建筑群 mock gate 都纳入测试。R8 证明 no-texture editable geometry boundary：dense details helper ratio `1`、photo-grade eligible ratio `0`。R9 第一版把 ScaleAnchorGraph、GroundPlan subdivision、line/grid residual、TopViewOverlay QA 和 promotion decision 接入 observation/evidence/PartGraph/report/test，但当前两个建筑样本仍保持 `photo_grade_candidate=false`。

下一轮建议：

- Reference Visual QA 已能反向给出 `update_part_graph` correction suggestion，目标是修改 part graph 字段，而不是直接改 DSL 坐标；`part_graph_correction_patch` 已可生成和应用。
- 下一步：把第二生成样本 gate 继续推进到真实照片/oblique facade height cues；在 ScaleAnchorGraph、GroundPlan、line/grid residual 和 TopViewOverlay QA 先成立前，cars、trees、roof vents、facade openings 等 dense helper classes 不能晋级为看似完整的真实几何。

本轮验收暴露的关键事实：

- Switch 主流程是“多图输入 + 视角分类 + Switch layout prior 模板化生成”，不是多图联合理解后重建模型。
- 救护车验收模型是人工综合多张图片后手写 DSL，不是子项目自动多视角融合能力。
- 单图 per-image 测试中 6 张图片仍能生成完整 41-op / 24-group / 1776-face 模型，说明当前模板补全权重过高；当前已在 per-image `model-plan.json` / `summary.json` 中显式记录单图 open question 和 template-prior 状态，避免把完整输出误读为高可信多图结果。
- 子项目已经有 observation/model-plan/review 贯通的 evidence graph、semantic fusion 和 corrections workbench，并能消费主线第一批真实 feature operations；图像侧语义仍主要来自确定性 CV、视角分类、profile prior 和 manual corrections，后续大样例验证不能把它误写成照片级自动重建。
- R4 的 seed ambulance PartGraph 生成仍保留 seed PartGraph 的 shape 参数；no-seed skeleton 已能表达 profile-required part 和图像证据，但 inferred-only 几何默认保持 `needs_review`。这仍不是照片级无先验多视角重建，后续 R5/R6 要继续扩大样例和参数提案覆盖。

## 当前可用状态

- 输入：`test/手柄` 共 6 张图片。
- 视角覆盖：`front` / `rear` / `right` / `oblique`。
- 缺失视角：`top`。
- 图片集质量：`medium`。
- `observations.json`：已生成，可作为 review 和后续 model-plan 的第一版证据。
- `visual_relation_graph`：当前 Switch observations 生成 270 条 image-space relation candidates，并同步到 `evidence_graph.visual_relations`；每条 relation 带 source image、bbox/keypoint/semantic-anchor basis、confidence 和 `review_required`。
- `visual-relation-qa/report.json`：当前 Switch VisualRelationGraph fixture 为 `pass`，6 条关系、8 个 contour/keypoint footprint / 0 issues；`mirror_x` 负例会打回左右手柄、摇杆手性、ABXY vs D-pad 三类关系。`visual-relation-qa/geometry-fit-report.json` 当前 `pass`，8 个 footprint、6 条 projected relation、1 个 handedness negative，grounding issues 0。
- `review-overlays/*.png`：已生成 6 张 overlay，包含 edge sample、bbox、symmetry axis、view label 和 metrics。
- `manual-corrections.json`：已接入，当前锁定 `280mm x 155mm x 42mm` baseline 尺寸。
- `model-plan.json`：当前 9 个 parts：
  - `center_grip_body`
  - `left_joycon_shell`
  - `right_joycon_shell`
  - `rear_grip_pair`
  - `left_thumbstick`
  - `right_thumbstick`
  - `abxy_cluster`
  - `left_button_cluster`
  - `shoulder_rail_pair`
  - evidence summary：7 个 `observed`、2 个 `inferred`、0 个 `manual_confirmed`；9 个 part 均带 `template_prior: true`，用于提示 Switch layout prior 仍参与参数补全。
  - evidence graph：`observations.json` 和 `model-plan.review.evidence_graph` 都会记录 `required_views` / `confirmed_views` / `missing_views`；当前多图 Switch 所有 required views 均有 confirmed evidence，但 9 个 part 均记录 `template_prior_used` conflict。
  - visual relation graph：当前 fixture 覆盖手柄左右关系、摇杆/按钮/d-pad 手性、中心屏/面板相对中心握把的包含与居中，以及左右手柄镜像对。
- `output.json`：当前 41 个 DSL operations：
  - `reset`: 1
  - `material`: 6
  - `component_definition`: 1
  - `rounded_box`: 6
  - `domed_surface`: 2
  - `bowed_panel`: 2
  - `analog_stick`: 2
  - `button_on_panel`: 8
  - `component_instance`: 4
  - `screw_hole`: 4
  - `scene`: 2
  - `style`: 1
  - `shadow`: 1
  - `rendering_options`: 1
- Mock snapshot：
  - `24 groups`
  - `4 component instances`
  - `1776 faces`
  - `2964 edges`
  - `1212 vertices`
  - `2 scenes`
  - bbox: `280 x 174 x 40 mm`
  - warning：0 个 geometry warn，0 个 error。
- `review/snapshot-report.json` / `review/snapshot-report.md`：
  - 已接入 mock snapshot report。
  - 当前 geometry warning 为 0。
  - 当前无 `needs_geometry_review` bucket。
  - 当前分类来源不再依赖对象命名猜测；`npm run test:image-structured` 会检查 geometry warning baseline 保持为 0。
- Queue/SketchUp output：
  - `output/image-structured-switch-controller.skp`
  - 当前文件 `253,177 bytes`
  - 最近真实生成时间：2026-05-20 22:16 CST
  - 2026-05-20 已将新版插件安装到 SketchUp 2026 Plugins 目录，重启 SketchUp 后通过 Extensions 菜单启动 Bridge，并重新生成 queue artifact。
  - queue snapshot 记录见 `examples/switch-controller/QUEUE_VERIFICATION.md`。
  - `review/snapshot-report-queue.json` / `review/snapshot-report-queue.md` 已生成。
  - queue warning 分类：
    - `queue_material_limitation`: 4
    - 当前 geometry warning 为 0。
    - 当前无 `needs_geometry_review` bucket。
    - 4 个 PBR warning 来自 `runtime_material_capability`。
- Mock/queue diff：
  - `review/snapshot-diff-queue.json` / `review/snapshot-diff-queue.md` 已生成。
  - verdict：`pass`
  - level：`ok`
  - total diffs：`0`
  - warning gate：`pass`
  - mock/queue bbox：`280 x 174 x 40 mm -> 280 x 174 x 40 mm`
- Per-image 单图验收：
  - `examples/switch-controller/per-image/summary.json` 已生成。
  - `test/手柄/IMG_0152.jpeg` 到 `IMG_0157.jpeg` 均已生成独立 observations/model-plan/output/review/mock report/queue report。
  - 对应 queue SKP 已保存到 `output/switch-controller-per-image/IMG_0152.skp` 到 `IMG_0157.skp`。
  - 每个单图输出均为 41 ops / 24 groups / 1776 faces / 2 scenes，queue 侧均为 4 个已分类 PBR limitation warning。
  - 每个单图 `model-plan.json` 和 `summary.json` 已记录 `evidence_summary`、`evidence_graph`、template-prior parts 和单图 open question；例如 front-only `rear_grip_pair` 会记录缺 `rear/right` 证据。
- Compact remote 第二样例：
  - `examples/compact-remote/observations.json`
  - `examples/compact-remote/manual-corrections.json`
  - `examples/compact-remote/model-plan.json`
  - `examples/compact-remote/output.json`
  - `examples/compact-remote/review/index.html`
  - `examples/compact-remote/review/snapshot-report.json`
  - 当前 mock snapshot：`3 groups`、`364 faces`、`780 edges`、`128 vertices`、`2 scenes`，bbox `44 x 158 x 16.6 mm`，warnings 0。
  - 当前 queue snapshot：`3 groups`、`369 faces`、`1035 edges`、`690 vertices`、`2 scenes`，bbox `44 x 158 x 16.6 mm`，SKP `182920 bytes`，仅 3 个已分类 `queue_material_limitation` warning。
  - 当前 mock/queue diff：report `ok`，warning gate `pass`；拓扑计数和 brand label fallback 的 bbox 存在 mock 估算与 SketchUp 真实几何差异，level 为 `warn`。
- Ambulance R4 PartGraph evidence 样例：
  - `examples/ambulance/observations.json` 已从 `test/救护车` 5 张图片生成，profile 为 `vehicle_ambulance`，views 为 `rear / left / top / oblique / front`，missing views 为 0。
  - observations 现在包含 `silhouette` contour/polyline、`keypoint` candidates、component bbox/center point、scale calibration 和 evidence graph part matches。
  - `examples/ambulance/part-graph.generated.json` 以已验收的 ambulance PartGraph 作为 seed，输出 53 个 parts：10 个 `observed`、41 个 `inferred`、2 个 `needs_review`，证据状态中 `profile_default` 为 0，并记录 45 条 parameter proposal。
  - `examples/ambulance/part-graph.skeleton.json` 不使用 seed，输出 7 个 profile-required parts；每个 part 都带 image-derived inferred sources，但由于缺少已确认视图，全部保持 `needs_review`，并输出 20 条 review-gated parameter proposal。
  - `examples/ambulance/correction-patch.parameter-proposals.json` 当前由 `parameter-proposal-review.accepted.json` 生成，包含 `main_body` 和 `cab` 的 2 个 accepted proposal set edits；`part-graph.proposal-applied.json` 已回写这两个 shape 参数并追加 `parameter_proposal_review` evidence。
  - `examples/ambulance/proposal-review/index.html` 由 `image-structured:proposal-review-ambulance` 生成，展示 no-seed proposal queue、accepted fixture 预选、patch targets，并可导出 accepted proposal JSON。
  - `examples/ambulance/output.proposal-applied.json` 由 `part-graph.proposal-applied.json` 编译生成；`image-structured:proposal-review-chain-ambulance` 和 `:queue` 会对它做 QA 复验。当前报告保持 `review_required: true`，queue artifact 为 `output/image-structured-ambulance-proposal-applied.skp`。
  - `examples/ambulance/output.generated.json` 可由 `part-graph-compiler` 编译为当前 104-op ambulance DSL；compiled QA metadata 会保留 `generated_from_image_evidence`、evidence confidence 和 missing views。
  - `examples/ambulance/reference-visual-qa/ambulance-generated/report.json` 当前 pass / 0 issues；`correction-patch.reference-visual.json` 因 pass 为空 patch，`part-graph.corrected.json` 保持 part count 不变。
  - `examples/ambulance/quality-report.json` 当前 pass：`profile_default_ratio=0`、`needs_review_ratio=0.038`、scale confidence `0.86`、`parameter_proposals=45`、`parameter_proposal_parts=17`。
- Building group R7 样例：
  - `test/建筑群/` 包含 3 张 GPT Image 合成厂区航拍图：1 张 top/site-plan、2 张 oblique。
  - `examples/building-group/view-hints.json` 锁定 top/oblique 视角，避免 CV-only view classification 漂移。
  - `examples/building-group/observations.json` profile 为 `building_group`，views 为 `oblique / top`，missing views 为 0，image set quality 为 `high`，scale strategy 为 `known_site_element_anchors`。
  - evidence graph 覆盖 `site_boundary`、`primary_blue_roof_hall`、`warehouse_row_west`、`warehouse_row_inner`、`tank_farm`、`utility_building`、`admin_office`、`parking_lot` 和 `internal_roads`。
  - visual relation graph 当前生成 image-space relation candidates，其中 `part-graph.massing.json` 接收 coarse + fine relation evidence；蓝顶主厂房相对仓库、停车场、道路、site boundary 等粗关系会回灌到 part `relationships` 和 spatial `physical_relations`。`examples/building-group/visual-relation-qa/report.json` 当前为 `pass`，12 条关系 / 0 issues：6 条粗 massing 关系对比模型投影，6 条四栋仓库、停车线/车道、树列关系保留 image-only QA，但已作为 4 条 review-gated `part_candidates` proposal 进入 PartGraph review queue，共覆盖 8 个 candidate parts。
  - `examples/building-group/part-graph.part-candidates-applied.json` 当前接受 4 条 candidate proposal，把两条 warehouse row 转为 `compile.emit=false` reference container，并新增 8 个 `manual_confirmed` parts；`output.part-candidates-applied.json` 编译为 20 个实际 groups。`proposal-qa-candidates/report.json` 与 queue 报告现在为 `ok=true` / `review_required=false`：layout/reference/visual relation/GeometryFit/physical consistency 均通过。`proposal-qa-candidates/geometry-fit-report.json` 记录 top-view affine calibration，检查 9 个 mask/contour footprint、12 条 projected relation、4 个 known-element scale anchor 和 1 个 handedness negative，grounding issues 0，max center residual `0.003`，max relation residual `0.002`。live queue artifact 为 `output/image-structured-building-group-candidate-warehouses.skp`，226653 bytes，20 groups / 292 faces / 524 edges / 272 vertices。
  - R9 `proposal-qa-candidates/grounding-v3-report.json` 当前检查 5 个 scale anchor / 3 个 anchor family、14 个互斥 ground regions、2 条 parking line fit、2 条 road axis、top-view overlay mean IoU `0.954`，promotion decisions 为 10 个 `promoted_geometry`、1 个 `review_candidate`、3 个 `helper_only`；第二建筑样本同一 runner 检查 4 个 anchor / 2 个 family、13 个 regions、2 条 line fit，两个样本都保持 `photo_grade_candidate=false`。
  - `examples/building-group/part-graph.massing.json` 当前 `review.part_candidate_proposals` 覆盖 `warehouse_row_west`、`warehouse_row_inner`、`parking_lot` 和 `site_boundary` 四个 parent review target；候选包括 4 个 warehouse unit、2 条停车线、1 条停车车道和 1 条树列，全部 `review_required: true`。
  - scale measurements 覆盖 `parking_bay_width_span`、`parking_bay_single`、`parking_drive_aisle_width`、`crosswalk_width` 和派生 site boundary；估算 site scale 为约 `130m x 98m`，所有 measurement 都 `review_required: true`。
  - `examples/building-group/part-graph.massing.json` 生成 14 个 parts：site slab、蓝顶主厂房、两组仓库、utility building、admin office、parking lot、internal roads、两个 tank cylinder 和 4 个 scale anchor marker。
  - `examples/building-group/output.massing.json` 由 PartGraph compiler 生成 32 个 DSL ops，当前 mock build 为 14 groups / 2 scenes / 0 error warning。
  - `examples/building-group/layout-qa/building-group-massing/report.json` 和 `examples/building-group/reference-visual-qa/building-group-massing/report.json` 当前均为 mock `pass` / 0 issues；layout QA 覆盖 site containment、support、road/scale-anchor intentional overlap 和 massing separation，Reference Visual QA 覆盖 site plan placement/extent/area、scale-anchor ratio、height tier 和 orientation。
  - `examples/building-group/layout-qa-queue/building-group-massing/report.json` 和 `examples/building-group/reference-visual-qa-queue/building-group-massing/report.json` 当前均为 queue `pass` / 0 issues；SKP 保存到 `output/image-structured-building-group-massing.skp`，208737 bytes，queue snapshot 为 14 groups / 256 faces / 452 edges / 224 vertices / 2 scenes。
  - `examples/building-group/part-graph.massing.json` 当前还有 5 条 roofline/facade/opening `feature_intents` proposals，全部 `review_required: true`；`examples/building-group/parameter-proposal-review.accepted.json` 只接受 `primary_blue_roof_hall` detail subset，用于保留 partial review-gated 回归。
  - `examples/building-group/proposal-qa/report.json` 当前 mock `pass`，`examples/building-group/proposal-qa-queue/report.json` 当前 queue `pass`：accepted subset 编译为 3 个 `add_raised_rib` 和 3 个 `cut_recess`，layout/reference/physical consistency 均为 0 issues；queue SKP 保存到 `output/image-structured-building-group-detail-proposal-applied.skp`，221357 bytes，snapshot 为 14 groups / 334 faces / 668 edges / 368 vertices。
  - R7 final 使用 `examples/building-group/parameter-proposal-review.accepted-all.json` 接受 5 个当前 detail proposal target，生成 `correction-patch.detail-proposals-all.json`、`part-graph.r7-final.json`、`output.r7-final.json`、`proposal-review-r7-final/index.html`、`proposal-qa-r7-final/report.json` 和 `proposal-qa-r7-final-queue/report.json`；final DSL 为 55 ops，包含 9 个 `add_raised_rib`、13 个 `cut_recess` 和 1 个 `cut_slot`。mock/live queue layout、feature Reference Visual QA 和 physical consistency 均为 `pass` / 0 issues；queue SKP 保存到 `output/image-structured-building-group-r7-final.skp`，253371 bytes，snapshot 为 14 groups / 609 faces / 1442 edges / 884 vertices。

## 已完成

- 子项目 README / PLAN / MEMO 基础文档。
- `schema/model-plan.schema.json` 初版，并允许未知物理尺寸用 `null` 表示。
- `schema/image-observation.schema.json` 初版。
- `schema/image-set-observation.schema.json` 初版。
- `schema/manual-corrections.schema.json` 初版。
- `examples/switch-controller/model-plan.example.json` 示例。
- `scripts/analyze-image-set.mjs`：
  - 读取图片目录。
  - 缩放图片。
  - Sobel 边缘检测。
  - 主体 bbox。
  - 垂直对称轴候选。
  - 视角启发式分类。
  - 可选读取 `model-plan.example.json` 的 `views[]` 作为人工 view hints。
- `scripts/make-review-overlay.mjs`：
  - 基于 observations 生成 overlay PNG。
- `scripts/generate-model-plan.mjs`：
  - 将 observations 转成半自动 `model-plan.json`。
  - 已按 `object_profile` 分流：`switch_controller` 保留 Switch layout prior，`compact_remote` 走遥控器样例 profile；仍不是完全自动语义识别。
- `scripts/generate-part-graph-from-observations.mjs`：
  - 完成 R4 闭环入口，将 image observations + ProductProfile + 可选 seed PartGraph 转成 seed generated PartGraph 或 no-seed skeleton PartGraph。
  - 写入 scale calibration、cross-view part matches、per-part evidence confidence、fallback summary 和 PartGraph correction targets。
- `scripts/apply-part-graph-correction-patch.mjs`：
  - 将 Reference Visual QA 的 `update_part_graph` suggestions 转为 `part_graph_correction_patch`，并可回写 PartGraph。
- `scripts/validate-part-graph-quality.mjs`：
  - 输出 PartGraph 质量门禁，检查 profile-default ratio、needs-review ratio、observed/inferred parts 和 scale confidence。
- `scripts/compile-plan-to-sketchup-dsl.mjs`：
  - 将 model plan 编译为 SketchUp JSON DSL。
  - 已使用 `rounded_box` 改善外壳、中心握把、前面板凹槽和肩键轨道。
  - 已改用直接的 `analog_stick`、`button_on_panel`、`screw_hole` 产品 helper，替代按钮/螺丝/摇杆的粗 component overlap。
  - 已给 face dome、rear grip、thumbstick、buttons、screws 写入 `qa.expected_contacts`，用于解释当前 baseline 的预期接触/包围盒 overlap。
  - 已新增 `compact_remote` 编译路径，覆盖 rounded body、face panel、button cluster、slot_array grille、真实 `text_3d` brand label 和 review scenes。
  - 关闭了全局 transparency，SketchUp 视图不再像调试半透明图。
- `scripts/make-review-report.mjs`：
  - 生成 `review/index.html`。
  - 汇总 image quality、overlay、model plan parts、manual corrections 和 output DSL operation counts。
- `sketchup_plugin/alma_sketchup_mcp.rb`：
  - 支持 `rounded_box`。
  - snapshot 已支持 group/component instance 的 `qa` 属性，插件重载后 queue report 可使用 DSL 里的 expected contact 元数据。
  - reset 清理已增强：清 entities、pages、未使用 component definitions，再 purge materials。
  - 修复旧 `Sree_*` 材质污染 snapshot 的问题。
- `test/validate.mjs`：
  - 已去掉对 Ajv runtime import 的依赖，改为项目内轻量 JSON Schema subset validator。
  - 已校验 `review/snapshot-report.json` 和可选的 `review/snapshot-report-queue.json`，防止 warning 分类缺失。
  - 已校验 mock snapshot 中 `qa.expected_contacts` 被保留，并要求 mock geometry warning 分类全部来自该元数据。
  - 已新增 correction-driven regression，断言 manual corrections 会改变 model plan 和 compiled DSL。
  - 已新增 compact remote 第二样例校验，防止生成器/编译器回退成 Switch-only profile。
  - `npm run test:image-structured` 当前可正常退出并通过。

## 当前已知问题

- 当前 Switch 输出主要由 `switch_controller` layout prior 补全；图片证据用于视角分类和局部部件证据，不是完整多图融合重建。
- 单图 per-image 生成仍能得到完整几何模型；当前已通过 `evidence_status` / `template_prior` / open question 降低可信度，但尚未真正减少或留空证据不足的 geometry。
- 当前 `observations.json` 和 `model-plan.review.evidence_graph` 已有原生证据图，`model-plan.review.semantic_fusion` 已把它提升为 graph-based 语义融合结果；证据来源仍主要由 deterministic CV、profile requirements 和 manual corrections 推导，还不是学习式视觉识别系统。
- 当前 model-plan 已有初步 `feature_semantics`：`concave`、`convex`、`flush`、`decal_printed`、`through_hole`、`blind_recess`；`blind_recess` / `through_hole` / `convex` 的第一批映射已能编译到 `cut_recess` / `cut_hole` / `add_boss` / `add_raised_rib`，但语义仍主要由 part type / manual corrections 推导，还不是图像侧稳定识别结果。
- 子项目仍依赖主线 MCP 的真实特征编辑能力；当前已接上第一批 face-feature ops，复杂 `cut_slot`、实体文字 boolean 和更广泛目标面仍属于后续 CAD slice。
- 缺 true top view，厚度、后握把和肩键深度仍然靠 side/rear 和人工尺寸推断。
- observations 仍主要是 bbox、edge sample 和 symmetry axis，还不是完整建模证据系统。
- Switch 示例仍依赖 layout prior；当前泛化靠 `object_profile` 分流和第二样例证明路径可扩展，不是完整通用语义识别。
- mock/queue warning 分类已推进到 DSL/runtime `qa.expected_contacts` 元数据；queue 侧已在 SketchUp 2026 中重新验证。
- 当前 geometry warning 已收敛到 0；correction-driven regression 第一条已经进测试门禁，下一步应增强 review/corrections authoring 工作台，而不是继续扩 allowlist。
- `QUEUE_VERIFICATION.md` 已同步最新 `rounded_box` 后的 queue 指标；后续需要改成自动生成，避免手工维护再次漂移。
- 当前 review report 已提供 Correction Patch Suggestions 和 Corrections Workbench，可交互编辑、复制和下载 corrections JSON；自动写盘和重跑生成链路仍是后续 CLI polish。

## 规划路线

### 阶段 0：暂停发布，修正能力边界

目标：文档、review 页面和 status 不再暗示“自动多图统一重建”已经完成。

任务：

- [x] 记录 per-image 单图验收结果，明确模板补全风险。
- [x] review 页面增加“证据来源/模板补全/人工确认”区分。
- [x] model-plan 每个 part 增加 `evidence_status`：`observed` / `inferred` / `template_prior` / `manual_confirmed`。
- [x] 单图输入时，如果关键 evidence 缺失，生成低置信 open question，而不是静默补全完整 Switch。

验收：

- 用户能从 review artifact 看出哪些部件来自图片、哪些来自模板、哪些需要人工确认。
- 单图和多图输出的置信度/证据完整度有明显差异。

### 阶段 1：跨图融合 evidence graph

目标：从“每张图各自 observation”升级到“同一对象的跨图部件证据表”。

任务：

- 为每个 candidate part 建立跨图 evidence records。
- 记录轮廓来源、厚度来源、正反面来源、细节来源。
- 记录冲突：不同视角对同一 part 的位置/尺寸/语义不一致时，进入 review open questions。
- 建立凹凸语义：`concave`、`convex`、`flush`、`decal/printed`、`through_hole`、`blind_recess`。
- `generate-model-plan.mjs` 基于 evidence graph 生成 model plan，不再直接按 profile 固定补全。

当前进展：

- [x] 派生 evidence graph：每个 part 记录 required/confirmed/missing views、sources、conflicts 和 open questions。
- [x] observation schema 原生 `evidence_graph`：`observations.json` 会保存 per-part requirements、sources、conflicts 和 open questions。
- [x] model-plan graph 优先合并 observation graph，并补充 model-plan evidence sources、template-prior 和 feature fallback conflicts。
- [x] review report 展示 Evidence Graph 表格。
- [x] 单图 per-image summary 写入 evidence graph，能暴露缺失 rear/right/top 证据。
- [x] review report 展示 Correction Patch Suggestions，人工确认可复制为 `manual-corrections.json` patch。
- [x] model-plan / review 接入 Semantic Fusion，按 part 记录 status、decision、confidence、semantic evidence 和 review flags。
- [x] review report 提供 Corrections Workbench，支持选择 patch、编辑 JSON、校验、复制和下载。
- [x] feature mapping 第一切片：compact remote 已把凸起按钮/摇杆和 blind recess grille 编译为 `add_boss` / `add_raised_rib` / `cut_recess`，并新增 manual-correction regression 验证 decal marker 可切到真实 `cut_recess`。
- [ ] 更广泛产品类的图像侧凹凸/贴花/开孔语义识别、基于 graph 而非 profile prior 的生成器重构，以及第 3 项 CAD boolean/manifold 仍待做。

验收：

- Switch 多图 model-plan 能解释每个主要 part 的视图证据。
- 救护车样例能把侧窗、红色腰线、车顶筋线、警灯、后窗分别映射到不同视图证据。

### 阶段 2：feature operations 映射

目标：把图片里的凹槽、孔、凸筋映射到主线 MCP 的真实编辑操作。

任务：

- 编译器支持从 `concave` / `convex` / `through_hole` / `blind_recess` 生成 `cut_hole`、`cut_slot`、`cut_recess`、`add_boss`、`add_raised_rib`。
- 当主线 runtime 不支持对应 feature operation 时，review 输出明确降级原因，不再伪装成真实开槽。
- 增加 correction-driven regression：人工把一个 feature 从 `decal` 改成 `recess` 后，compiled DSL 必须从贴面/文字变成 `cut_recess`。

验收：

- 至少一个 Switch 凹槽/螺丝孔和一个救护车车顶筋线能以真实 feature operation 表达。

### 已完成阶段：把现有 baseline 稳住（历史基线）

目标：当前 Switch 示例必须可重复跑、可验证、文档不误导。

任务：

- [x] 修复 `npm run test:image-structured` 卡住问题。
- [x] 更新 `QUEUE_VERIFICATION.md` 到当前 `rounded_box` 输出指标。
- [x] 增加 mock snapshot report。
- [x] 分类当前 22 个 mock overlap warning。
- [x] 增加 queue snapshot report。
- [x] 增加 mock-queue diff report 入口。
- [x] 生成正式 mock-queue diff artifact。
- [x] 将 warning 分类下沉成测试 budget / allowlist。
- [x] 将当前 mock warning 分类推进到 DSL/runtime `qa.expected_contacts` 元数据。
- [x] 将 queue snapshot/diff 的 geometry warning 分类也推进到 `qa.expected_contacts`，并纳入测试校验。
- [x] 给当前 Switch 输出增加质量门槛：
  - bbox 接近 `280 x 174 x 40 mm`
  - groups/instances/scenes 数量稳定
  - `warning_summary.by_severity.error === 0`
  - `rounded_box` 不能回退为粗 `mesh` / `box`

验收：

- 一条命令能重建 `observations -> model-plan -> output.json -> review.html`。
- mock build 稳定通过。
- queue build warning 都能解释。
- 文档和真实产物一致。

### 后续能力：图片识别证据系统（原阶段 2，已被跨图 evidence graph 扩展）

目标：不是只生成 bbox，而是提取可用于建模的证据。

任务：

- 从 edge cloud 进化到 contour/polyline。
- 提取 keypoints：
  - 外壳角点
  - 按钮中心
  - 摇杆中心
  - 肩键边界
- 生成 component candidates：
  - shell
  - center grip
  - thumbstick
  - button cluster
  - screw
  - rail
- 参考 Free2CAD 做基础约束检测：
  - 对称轴
  - 平行边
  - 同心圆
  - 等距按钮阵列
- 在 review overlay 里标出证据来源和低置信区域。

验收：

- `observations.json` 中有可追踪的候选部件和 keypoints。
- review HTML 能解释“模型为什么这么生成”。

### 后续能力：人工修正闭环产品化（原阶段 3，已并入新阶段 0/2）

目标：用户指出错处后，修正能稳定影响模型。

任务：

- 扩展 `manual-corrections.json`，支持改 part 参数：
  - 按钮中心
  - 半径
  - 外壳宽度
  - 握把厚度
  - 肩键位置
- 每个 part 增加状态：
  - `visually_detected`
  - `inferred`
  - `manually_confirmed`
- review report 显示：
  - part id
  - 当前参数
  - evidence
  - 推荐 correction 示例
- 增加测试：correction 改变后，`model-plan.json` 和 `output.json` 必须发生预期变化。
  - 当前第一条测试已落地：Switch regression fixture 会移动左摇杆、调整半径、增加 Home button，并断言编译 DSL 同步变化。

验收：

- 不改代码，只改 corrections，就能调整模型关键比例。
- 人工 review 能进入下一轮构建。

### 后续能力：提高 SketchUp 几何质量（原阶段 4，依赖主线 feature operations）

目标：模型从“结构正确”提升到“看起来像产品”。

任务：

- 继续补产品 primitive：
  - `button_on_panel`
  - `recess`
  - `screw_hole`
  - `slot`
  - `beveled_panel`
  - `shell_from_front_side_profiles`
- Switch 编译器从固定模板改成根据 evidence/part 参数选择 primitive。
- 减少硬贴/穿插，用 recess 和 contact metadata 替代粗 overlap。
- 做 front/top/oblique 三个 QA scene。

验收：

- Switch 模型不再主要依赖 box/粗 mesh。
- warning 明显减少，或者都被标为 expected contact。
- `.skp` 打开后能作为可继续编辑的产品模型。

### 后续能力：开始泛化（原阶段 5，延后到特征编辑和多图融合之后）

目标：证明不是只为一个手柄硬编码。

任务：

- 增加第二个产品样例，优先选鼠标、遥控器或小电器外壳。
- 把 Switch-specific prior 收敛到 `object_profile`。
- 抽象通用 part taxonomy：
  - shell
  - panel
  - button
  - stick
  - slot
  - screw
  - grip
- 评估是否引入 VLM：只用于语义判断，不替代几何测量。

验收：

- 第二个产品能跑完整链路。
- Switch 专用逻辑减少。
- VLM 是否接入有明确成本/收益判断。
- 当前第二样例已落地：`compact-remote` 可跑 observations → model-plan → output → review → mock snapshot，warnings 0。VLM 仍不接入发布阻塞路径。

## 推荐下次开工入口

从新的阶段 7 目标继续：

1. 把主线 `boolean_union` / `boolean_difference` / `boolean_intersect` / `manifold_check` / `manifold_repair` 接入更多产品样例验收，让 `cut_hole` / `cut_slot` / `cut_recess` / `add_boss` / `add_raised_rib` 之外的实体编辑也可被复验。
2. 在更多产品样例中复用 semantic fusion、Corrections Workbench、真实 feature operations 和 boolean/manifold，继续压低 visual fallback 比例。
3. 后续再把 workbench 的下载/复制流升级成直接写盘和一键重跑。

## 2026-05-19 交接记录

本轮已经完成：

- `npm run test:image-structured` 卡住问题已修复：`test/validate.mjs` 不再依赖 Ajv runtime import，改用项目内轻量 JSON Schema subset validator。
- `image-structured:snapshot-switch` 已接入常规 `image-structured:build-switch`，默认生成 mock snapshot report：
  - `examples/switch-controller/review/snapshot-report.json`
  - `examples/switch-controller/review/snapshot-report.md`
- `image-structured:snapshot-switch:queue` 已接通真实 SketchUp queue runtime，并在用户启动 SketchUp + Alma Bridge 后成功跑通。
- 最新真实 `.skp`：
  - `output/image-structured-switch-controller.skp`
  - 文件大小：`227,317 bytes`
  - 生成时间：2026-05-19 14:32
- 最新 queue snapshot：
  - `12 groups`
  - `16 component instances`
  - `1632 faces`
  - `2772 edges`
  - `1196 vertices`
  - bbox：`280 x 174 x 40 mm`
- 最新 warning 分类：
  - mock：22 个 geometry warnings 全部 classified，无 `needs_geometry_review`
  - queue：26 个 warnings 全部 classified，无 `needs_geometry_review`
  - queue buckets：
    - `queue_material_limitation`: 4
    - `intentional_shallow_overlap`: 2
    - `expected_grip_attachment`: 6
    - `expected_mounted_detail`: 14
- `test/validate.mjs` 已校验 mock report 和 queue report 的 warning buckets。
- 已修复一个并发隐患：子项目 snapshot/test 使用独立 mock session，避免和根 `npm test` 同时写 `.session/mock-model.json`。
- 文档已同步：
  - `README.md`
  - `PLAN.md`
  - `MEMO.md`
  - `examples/switch-controller/QUEUE_VERIFICATION.md`

本轮最后验证通过：

- `npm run image-structured:snapshot-switch:queue`
- `npm run test:image-structured`
- `npm test`

继续工作记录（2026-05-19 下午）：

- 已在 `projects/image-structured-modeler/scripts/make-snapshot-report.mjs` 增加 runtime diff 模式：
  - `--compare-runtime queue`
  - 默认输出 `snapshot-diff-queue.json` / `snapshot-diff-queue.md`
  - 内部复用 `src/bridge.mjs` 的 `compare_model`，最终仍走 `src/snapshot-diff.mjs`，没有另造平行 diff 系统。
- 已新增 npm 命令：
  - `npm run image-structured:diff-switch:queue`
- diff report 会记录：
  - mock/queue totals、bbox、scene/material parity
  - `src/snapshot-diff.mjs` 产生的 `report.summary` / `top_issues` / `diffs`
  - mock/queue 两侧 warning classification delta
  - `warning_gate.ok`
- 已用 mock/mock smoke test 验证新 diff 路径能跑通：
  - `npm run image-structured:snapshot-switch -- --compare-runtime mock --output-dir output/image-structured-modeler/diff-smoke --json-name snapshot-diff-mock.json --markdown-name snapshot-diff-mock.md`
  - 结果：`0` diffs，warning gate pass。
- 当时还没有生成正式 `snapshot-diff-queue.*` artifact：那轮检查时 SketchUp queue runtime 未响应，`get_capabilities --runtime queue --timeout-ms 5000` 超时；Computer Use 显示 SketchUp 2026 不是 running 状态。后续 2026-05-19 晚间和 2026-05-20 的记录已经覆盖这个状态。
- `test/validate.mjs` 已增加 optional queue diff report 校验；当 `snapshot-diff-queue.json` 存在时会校验 runtime、error diff、warning gate 和当前 warning bucket baseline。
- `README.md`、`PLAN.md`、`QUEUE_VERIFICATION.md` 已同步新命令和当前状态。
- 已新增 `projects/image-structured-modeler/scripts/lib/warning-budget.mjs`，报告生成和测试共用同一套 warning classifier / budget evaluator。
- 已新增 `projects/image-structured-modeler/examples/switch-controller/warning-budget.json`：
  - mock：`intentional_shallow_overlap=2`、`expected_grip_attachment=6`、`expected_mounted_detail=14`
  - queue：额外允许 `queue_material_limitation=4`
  - `max_error_warnings=0`
  - `max_needs_review=0`
- `npm run test:image-structured` 已接入 warning budget，并增加当前 Switch 输出质量门槛：
  - bbox 必须保持 `280 x 174 x 40 mm`
  - groups=`12`、instances=`16`、scenes=`2`
  - warning error 必须为 `0`
  - DSL 不能回退到粗 `mesh` / `box`
- 用户重新打开 SketchUp 后，`get_capabilities --runtime queue` 已通过，正式 queue artifact 已重新生成：
  - `output/image-structured-switch-controller.skp`
  - 文件大小：`227,322 bytes`
  - 生成时间：2026-05-19 18:06
- `npm run image-structured:diff-switch:queue` 已通过，生成：
  - `examples/switch-controller/review/snapshot-diff-queue.json`
  - `examples/switch-controller/review/snapshot-diff-queue.md`
  - 结果：`pass` / `ok` / `0` diffs / warning gate pass
- `npm run test:image-structured` 现在会校验 `queue_diff_report: true`。

## 2026-05-20 queue reload verification

本轮继续验证了 SketchUp queue runtime 的新版插件链路：

- 已把仓库新版 `sketchup_plugin/alma_sketchup_mcp.rb` 覆盖安装到 `~/Library/Application Support/SketchUp 2026/SketchUp/Plugins/alma_sketchup_mcp.rb`，原文件备份为 `alma_sketchup_mcp.rb.bak-20260520-qa`。
- 重启 SketchUp 2026 后，通过 Ruby Console 启动 Bridge timer。
- `node src/cli.mjs get_capabilities --runtime queue --timeout-ms 30000` 通过，runtime compatibility 为 `ok`。
- `npm run image-structured:snapshot-switch:queue` 通过，重新生成：
  - `output/image-structured-switch-controller.skp`
  - 文件大小：`228,627 bytes`
  - 生成时间：2026-05-20 10:28 CST
  - `review/snapshot-report-queue.json`
  - `review/snapshot-report-queue.md`
- queue snapshot warning source 已验证：
  - `runtime_material_capability`: 4
  - `qa.expected_contacts`: 22
  - 不再依赖 `name_heuristic` 分类当前几何 warning。
- `npm run image-structured:diff-switch:queue` 通过：
  - 结果：`pass` / `ok`
  - total diffs：`0`
  - warning gate：`pass`
  - expected warning source：`qa.expected_contacts=22`
  - actual warning source：`runtime_material_capability=4`、`qa.expected_contacts=22`
- `test/validate.mjs` 已收紧：当 queue snapshot/diff report 存在时，也会要求 queue geometry warning 分类全部来自 `qa.expected_contacts`。

下次直接继续：

1. 后续减少粗 overlap 时，同步收紧 `warning-budget.json` 的 expected bucket baseline。
2. 开始把按钮/螺丝从粗 component overlap 改为 `button_on_panel`、`recess`、`screw_hole` 等更具体的产品 primitive。
3. 增强 review/corrections 工作台，让 corrections 改 part 参数并进入回归测试。

## 2026-05-20 overlap reduction slice

本轮已执行第一轮几何 warning 收敛：

- Switch DSL 已将摇杆、按钮和螺丝从粗 component overlap 改为直接产品 helper：
  - `analog_stick`: 2
  - `button_on_panel`: 8
  - `screw_hole`: 4
  - LED 仍保留 `component_definition` / `component_instance` 复用。
- Face dome 改为贴在 shell 上方，并缩小 bbox 深度；mounted details 改为从 face dome 顶部以上生成。
- Mock snapshot：
  - `24 groups`
  - `4 component instances`
  - `1776 faces`
  - `2964 edges`
  - `1212 vertices`
  - bbox：`280 x 174 x 40 mm`
  - geometry warnings：`22 -> 0`
- Queue snapshot：
  - `24 groups`
  - `4 component instances`
  - `1776 faces`
  - `2964 edges`
  - `1244 vertices`
  - `.skp` 文件大小：`253,177 bytes`
  - queue warnings：`26 -> 4`，全部是 SketchUp PBR capability warning。
- Mock/queue diff：
  - 结果：`pass` / `ok`
  - total diffs：`0`
  - warning gate：`pass`
- `warning-budget.json` 已同步收紧：
  - mock：无 warning bucket
  - queue：`queue_material_limitation=4`
- `npm run test:image-structured` 和 `npm test` 均已通过。

下次直接继续：

1. 开始扩展 `manual-corrections.json`，让 part 参数调整进入 model plan、DSL 和回归测试。
2. 继续把 review/corrections 工作台产品化。
