# Image Structured Modeler — 开发计划

> 目标：从参考图片生成可审查、可编辑、结构化的 SketchUp MCP 模型计划。
> 周期：6 周，3 个 Sprint，MVP 范围。
> 基准日期：2026-05-11

---

> 说明：本文件上半部分是 2026-05-27 验收复盘后的最新执行顺序；2026-05-29 后的建模架构重构以 `../../docs/product-modeling-architecture-refactor-plan.md` 为主入口；后面的 6 周 Sprint 计划保留为历史 MVP 基线，不再作为发布判定。

## 2026-05-29 架构重构计划入口

下一阶段不是重写主线 runtime，而是把子项目输出从“图像观察 + profile prior 直接生成 DSL”推进到：

```text
ObservationSet -> EvidenceGraph -> ProductProfile -> PartGraph -> FeatureMappingPlan -> JSON DSL
```

子项目负责前三到四层：`ObservationSet`、`EvidenceGraph`、`ProductProfile` 和 `PartGraph`。主线继续负责 DSL runtime、mock/queue、operation registry 和 layout/reference QA。详细里程碑和验收标准见 `../../docs/product-modeling-architecture-refactor-plan.md`。

## 2026-06-16 Structured Asset Modeler 发布门禁

本轮问题的根因不是单个建筑样例错了，而是上传图片到建模之间缺少统一、强制的结构化入口。发布前的产品流程必须固定为：

```text
User Assets
  -> AssetSet
  -> ObservationSet / VisionEvidenceSet
  -> CandidateGraph
  -> ModelingBrief
  -> Review / Promotion Patch
  -> PartGraph with promoted geometry
  -> SketchUp DSL
```

已落地的底线：

1. 新增 `image-structured:intake`，作为图片结构化的核心入口，默认输出 `intake-summary.json`、`asset-set.json`、`observations.json`、`candidate-graph.json`、`modeling-brief.json`、`mcp-modeling-brief.json`、`mcp-modeling-brief.md`、`candidate-promotion-review.draft.json`、`candidate-promotion-patch.blocked.json`、`review/index.html` 和 overlay；`intake-summary.json` 是产品/API/队列/CI 的稳定机器摘要，汇总 `ok`、profile、compile gate、source-package gate 和关键 artifact 路径；产品/API 推荐先走 `image-structured:real-world-building-upload-session`，由一次命令串起 preflight、intake、source gate、MCP brief 和 review workbench，并写 `upload-session-summary.json`；未显式传 `--view-hints-file` 时，upload-session 会把 preflight 从文件名、上传包 `view-hints.json` / `manifest.json` / `upload-manifest.json`、CAD 默认视图里识别到的 front/side/oblique/top 标签写成 `view-hints.generated.json` 再交给 intake；同一上传 metadata 也可声明 `dimensions` / `known_dimensions` / `scale_hints` / `scale_anchors`，这些尺度线索会进入 preflight `scale_package`、ObservationSet `scale_calibration`、source-package 和 MCP brief，但仍保持 review-gated；upload-session summary 会稳定暴露 `preflight.metadata_files`，无效 metadata 标记为 `invalid_json` / `invalid_contract`，preflight 顶层状态为 `blocked_source_metadata`，并触发 `invalid_source_metadata`，不会贡献 view/scale hints；upload manifest 的 `views[].source_image` 和 `scale_anchors[].source_image` 必须引用上传包真实源文件，缺失引用也作为 `invalid_contract`；上传包也可单独走 `image-structured:preflight-real-world-building-source-package`，输出 `real-world-building-source-package-preflight` JSON/Markdown，用于检查媒体类型、生成/截图/脚手架路径标记、视角标签和尺度线索，但不承诺建模成功；显式加 `--real-world-building-release-draft` 时会额外生成 `real-world-building-release/manifest.draft.json`、`manifest-contract-summary.json`、release checklist 和 `release-work-order.json/md`，并在 review workbench 和 upload-session summary 暴露 artifact/status；work order 会把 source assets、PartGraph、compiled output、PhotoGradeReadiness、human review、draft validation 和 formal manifest promotion 拆成机器任务，但通过前仍不得进入正式 release manifest；upload-session 还会生成 `upload-session-handoff.json/md`，把 source refill、source request response refill、release artifact work 和 formal validation 转成产品/API/MCP 可直接消费的 primary action；`image-structured:export-mcp-brief` 可从既有 intake 产物重建 MCP/建模 agent brief 或改写输出位置。
   - upload-session handoff 必须是自包含的产品/API/MCP 入口：`primary_action.artifact_exists`、authoritative artifacts 的 `exists` 状态、`semantic_evidence_quality`、`vision_evidence.semantic_evidence_instances` 和 `vision_evidence.modeling_handoff` 要随 JSON/Markdown 一起输出，前端和队列不能再靠探测多文件或自由文本来判断下一步是否可执行、语义证据是否可几何提升，或凹进立面/方管风管/阴影边界该如何 review-gated 使用。
   - 图片分析现在会在主 bbox / component candidate 前运行 `auto_screenshot_chrome_v1` content frame detection：大块近黑截图面板、黑边和 screenshot chrome 会写入 `image.content_frame`、`metrics.content_frame_bbox`、raw/effective edge counts 和 `auto_content_frame` helper observation，并在 overlay 中画出边界。该能力只用于剔除截图 UI 污染，不替代阴影/凹槽分类或 facade plane segmentation。
   - 建筑类 raster image 现在还会默认生成 `VisionEvidenceSet v1` 和 `vision-evidence-v1-report.json`、`vision-evidence-review-patch.json/md`、`vision-evidence-review/index.html`；`intake-summary`、upload-session summary、handoff 和 MCP brief 会暴露这些 artifact。凹进侧立面、矩形风管/方管、阴影/凹槽边界等以 `semantic_candidate_policy` review item 进入该层，只能用于人工策略确认，不能直接 apply、compile 或 geometry promotion。
   - VisionEvidence review patch 的 `semantic_evidence_instances` 和 MCP brief 的 `modeling_handoff` 必须先进入 upload-session handoff，再继续进入 release artifact workspace：handoff 的 `vision_evidence`、workspace 的 `mcp_modeling_handoff.vision_evidence`、每个 `task_packets[].mcp_constraints.vision_evidence` 和 `task_packets[].mcp_authoring_handoff` 都要保留 source image、view、bbox、confidence、review-required 状态、建模决策、禁止误读、确认项，以及 VisionEvidence report/review patch/review workbench 路径；task packet acceptance criteria 包含 `use_vision_evidence_instances` / `use_vision_evidence_modeling_handoff`，workspace validator 检查 `vision_evidence_instances_propagated` / `vision_evidence_modeling_handoff_propagated` / `task_packet_mcp_authoring_handoff_present`，避免 MCP/建模任务只拿到角色名或自由文本。
2. 未声明或未识别对象画像时路由到 `unknown_object`，不再静默回退到 Switch profile。
3. `unknown_object` scale 为显式零尺寸、零置信度、review required；所有候选带 `unknown_profile` blocker。
4. no-seed PartGraph skeleton 不再把候选占位体放进 `shape`，而是放进 `candidate_shape`，并设置 `compile.emit=false`。
5. 只有 explicit proposal review / correction patch 接受后，候选 `shape.parameters` 才能提升成 compileable `shape`，并写入 `promoted_geometry` QA。
6. PartGraph compiler 会在 `promoted_geometry_parts=0` 时 fail closed，防止把模板/候选几何送进 SketchUp。
7. intake review workbench 现在可勾选候选、输入 reviewer/已知尺寸/备注，并导出 `candidate_promotion_review` JSON；只要 profile、scale、view 或候选 blockers 未解除，导出结果仍保持 `verdict=blocked`、`promotion_allowed=false`、`compile_allowed=false`。
8. 新增 `image-structured:promotion-patch`，可把 `candidate_promotion_review` 转成 `candidate_promotion_patch`；当前 blocked review 只会生成 `actions=[]`、`apply_allowed=false` 的 blocked patch，不能修改 PartGraph。
9. 新增 `image-structured:apply-promotion-patch`，只接受 `status=ready_for_part_graph_patch` 且 `apply_allowed=true` 的 patch；blocked patch 会拒绝应用。应用后的 PartGraph parts 会带 `manual_confirmed` evidence、`promoted_geometry`、`part_graph_review_required` 和 source candidate provenance，仍必须继续通过 PartGraph compiler gate / QA。
10. `test/建筑单体` 当前通过 intake 得到 29 个候选，但 `compile_allowed=false`，缺 `scale_confidence_below_publish_gate`、`missing_oblique_view`、`missing_left_view`、`missing_top_view`；凹进立面、矩形风管/方管、HVAC、阴影/凹槽边界只作为 review-only candidate，默认草稿为 `accepted_candidates=[]`、`held_candidates=29`，promotion patch 为 `actions=[]`，blocked apply 会按预期失败，因此只能进入 review/demo，不允许直接编译。MCP brief 会额外写出 role-level `modeling_constraint_summary`，把凹进立面、矩形风管和阴影/凹槽边界的禁令去重成建模约束摘要。
    - 同一 blocked demo 还必须写出 VisionEvidence review patch/workbench：patch 至少包含 `semantic_candidate:recessed_side_facade_plane`、`semantic_candidate:rectangular_utility_ducts`、`semantic_candidate:shadow_or_recess_boundary`，并保持 `apply_allowed=false`、`compile_allowed=false`、`geometry_promotion_allowed=false`。
11. 新增 `image-structured:release-gate`，输出 `release-gate-report.json`。当前硬门禁覆盖 unknown negative fail-closed、real-world building source-package preflight、real-world building upload session、real-world building upload session generated view hints、PDF/CAD AssetSet fail-closed、PDF/CAD parser positive review gate、PDF/CAD parser release matrix fixture、document review patch roundtrip fixture、building-single semantic matrix fixture、建筑单体 blocked demo、MCP modeling brief export fail-closed、synthetic ready promotion -> PartGraph -> compiler gate preserved、human review roundtrip matrix fixture、human review UI release matrix fixture、accepted positive release sample fixture、real-world Switch product photo fixture、real-world building formal manifest write guard、real-world building positive manifest/checklist contract、Rhino factory visual gap guard、real-world building demo candidate audit、release gate artifact integrity 二十一条路径；upload-session 相关 case 还会生成 `release-artifact-workspace.json/md`，分别验证 blocked 输入的 `blocked_needs_source_refill` 和 input-ready 输入的 `ready_for_artifact_authoring`。报告当前为 `ok=true`、`release_ready=false`、`verdict=technical_baseline`。
    - release gate 现在同步复验 VisionEvidence 默认接入：upload-session、building-single blocked demo、generated-view-hints、MCP brief export 和 accepted positive building-group case 都必须暴露 VisionEvidence report/review patch/workbench，并证明 review decision / policy correction 只更新 evidence metadata，不打开 direct DSL 或 promoted geometry。
12. PDF/CAD 已能进入 `image-structured:intake`，生成 `asset-set.json`、`observations.json`、`candidate-graph.json`、`modeling-brief.json`、`candidate-promotion-review.draft.json` 和 blocked promotion patch；缺 extractor 时带 `pdf_extractor_required` / `cad_extractor_required`，不得进入 PartGraph。显式传 `--parse-documents` 时，当前最小 parser 会解析 PDF metadata 和 DXF LWPOLYLINE outline，输出 `document-parse-report.json`、CAD top-view outline、document scale anchor 和 missing-view blockers。

发布前仍必须补齐：

1. 真实世界建筑正向样本矩阵：当前已有 synthetic ready patch 回归、document review roundtrip、建筑单体 blocked demo、building-group R7 final accepted positive fixture，以及真实 Switch 产品照片正样本；发布前还需要至少一个真实建筑照片/图纸输入经人工确认或多视角证据解除 blocker 后完整跑通 PartGraph -> compiler/QA。先用 `image-structured:real-world-building-upload-session` 生成上传会话，再用 `image-structured:prepare-real-world-building-release-artifact-workspace` 从 `upload-session-summary.json` 生成 release artifact workspace；当 workspace 为 `ready_for_artifact_authoring` 后，再用 `npm run image-structured:prepare-real-world-building -- --intake-dir ...` 生成 manifest 草稿和 release checklist。只有 checklist 的真实资产、artifact、PhotoGradeReadiness、VisionEvidence report/review patch/accepted decision/policy correction、人工 review 检查全部通过后，才按 `projects/image-structured-modeler/examples/real-world-building-positive/manifest.example.json` 写入正式 `manifest.json`，让 release gate 不再报告 `real_world_building_positive_release_sample_missing`。
   - Rhino factory 建筑单体样本当前被 release gate 明确列为 visual gap guard：layout QA/mock/queue 可通过，但人工视觉失败，因此只能作为负向守门，不得抵消真实建筑正向发布样本缺口。

已关闭的发布缺口：

- 建筑单体专用语义识别发布矩阵已进入 release gate：当前覆盖 canonical oblique/front、已追踪的建筑立面/屋面图纸样本，以及本地 `test/建筑单体` 可选 demo；会检查凹进墙面、风管/方管、空调外机、门窗/店面、光影/凹槽边界等候选必须出现且不得自动晋升。`building_single_semantic_release_matrix_missing` 已从剩余发布缺口移除。
- 建筑单体 VisionEvidence 默认入口已进入 release gate：普通 intake/upload-session 会把这些语义候选同步生成 `semantic_candidate_policy` review item，并在 `vision-evidence-review-patch.json`、review workbench、MCP `evidence_summary.vision_evidence` 和 authoritative artifacts 中暴露；这关闭的是“图片结构化证据没有进入 MCP 文本出口”的缺口，不关闭真实建筑正向发布样本缺口。
- 多模态解析器发布矩阵已进入 release gate：PDF/CAD/尺寸图已经接入 AssetSet fail-closed，当前矩阵覆盖正向 PDF+DXF、多页 PDF+DXF、DXF 米制单位缩放、图层过滤、多 outline 选择、坏 PDF、无 outline DXF、unsupported CAD；失败样本必须保留 extractor gate，所有正向样本仍保持 review-gated。`pdf_cad_parser_release_matrix_missing` 已从剩余发布缺口移除。
- 人工 review UI 发布矩阵已进入 release gate：当前 headless Chrome 会打开真实 review HTML，覆盖 document accepted、image accepted、image blocked selection 三条 UI 导出路径；ready 路径进入 patch/PartGraph，blocked 路径拒绝应用。`human_review_ui_release_matrix_missing` 已从剩余发布缺口移除。
- MCP/建模 agent 文本出口已进入 release gate：`image-structured:intake` 默认生成 `mcp-modeling-brief.json` 和 Markdown，并在 review workbench 暴露链接；brief 现在直接包含真实建筑 `source_package_gate`、`source_request`、`agent_contract`、`grounding_risk_register`、`candidate_disambiguation` 和 `modeling_constraint_summary`，把 `input_ready_for_release_work`、source/view/scale/semantic blockers、next actions、需要补充的素材请求、唯一权威 artifact、允许/阻断输出、证据规则、必需确认项、几何边界、稳定风险 ID、逐候选歧义说明和去重后的 role-level 建模约束带给 MCP，`image-structured:export-mcp-brief` 也会从已有 intake 自动重读 `real-world-building-source-package.json`。`grounding_risk_register` 会把直接 DSL 阻断、source authenticity、missing view、scale、release readiness、凹进立面、方管/风管、阴影/凹槽歧义拆成机器可读风险项；`candidate_disambiguation` 会逐候选写出 allowed semantics、blocked interpretations 和 required confirmations，`modeling_constraint_summary` 会去重汇总关键 role 的 blocked interpretations、required confirmations 和 promotion policy，明确凹进面不得塞到正立面、方管/风管不得当装饰线、阴影不得直接转几何。`source_package_gate` 和 `agent_contract.output_policy` 还会直接暴露 release checklist required/failed/review required id 摘要，保证 MCP brief、handoff 和 workspace 不再各自解析 checklist 文本。`mcp_modeling_brief_export_fixture` 会复验默认产物、workbench 链接，并从 blocked 建筑单体 intake 产物重建 brief，要求保留候选证据、source-package blockers、`source_request`、缺失输入、`direct_sketchup_dsl` 阻断、直接 DSL 禁令、风险 ID、release checklist 摘要、逐候选歧义表和 role-level 建模约束摘要。
  - MCP brief 现在还必须带 `evidence_summary.vision_evidence`，暴露 VisionEvidence availability、review_required、semantic review roles、`default_heavy_model_required=false`、`semantic_evidence_instances`、`modeling_handoff` 和 `vision_evidence_review_patch` 权威 artifact；Markdown 要列出 role、view、source id、bbox、confidence，以及每个角色的建模决策、禁止误读和确认项。这保证 MCP 使用的高质量文本来自图片结构化 contract，而不是凭空描述。
- VisionEvidence review patch 的语义 review item 必须可定位：`semantic_candidate_policy.current_value.evidence_instances[]` 要保留 source id/image、view、`bbox_px`、confidence、backend 和 review-required 状态。产品/API/MCP 可以直接从 patch 定位凹进侧立面、矩形风管/方管、阴影/凹槽边界等候选区域，不能退回只给角色名和自由文本风险。
- 建筑单体 blocked demo 的 release-positive 准备出口已进入 release gate：该 case 现在必须写出 `real-world-building-release/manifest.draft.json`、`manifest-contract-summary.json`、`release-checklist.json`、`release-work-order.json/md` 和 review workbench 链接；在真实 source assets、release artifacts、PhotoGradeReadiness 和人工验收未齐之前，summary/checklist/work-order 必须保持 fail-closed，不能关闭 `real_world_building_positive_release_sample_missing`。
- 真实产品图片正样本已进入 release gate：`real_world_positive_switch_product_fixture` 会复验 `test/手柄` 六张真实照片的 observation/model-plan/output 编译一致性，并检查 mock/queue snapshot、queue diff warning gate、VisualRelation QA 和 GeometryFit QA。旧的 `real_world_positive_release_sample_missing` 已关闭；剩余缺口被收窄为 `real_world_building_positive_release_sample_missing`。
- 真实建筑正样本不再需要改脚本接入：`npm run image-structured:prepare-real-world-building-release-artifact-workspace -- --upload-session-summary ...` 可把 upload-session、handoff、MCP brief、manifest draft、checklist 和 work-order 收敛成 `release-artifact-workspace.json/md`；blocked 输入保持 `blocked_needs_source_refill`，input-ready 但缺发布 artifact 时进入 `ready_for_artifact_authoring`，并明确 PartGraph、compiled output、PhotoGradeReadiness、VisionEvidence policy review、human review 和 formal validation 工作项。workspace 现在还会带 `mcp_modeling_handoff`，直接暴露 direct DSL 阻断、风险 ID、release checklist required/failed/review required id、候选 blocked interpretations、semantic evidence quality 和 VisionEvidence review patch/semantic roles，避免 MCP 在 release artifact 阶段重新猜凹进立面/风管/阴影语义；同时为 PartGraph、compiled output、PhotoGradeReadiness 生成 `task_packets`，把权威输入、MCP 约束、`mcp_authoring_handoff` prompt/digest、release checklist required/failed/review required id、语义质量 gate、验收条件、完成证据、验证命令和下一步动作结构化，并新增 `preserve_semantic_evidence_quality` / `use_vision_evidence_review_patch` / `task_packet_mcp_authoring_handoff_present` 验收链路；另有 `review_requirements` 结构化暴露 `vision_evidence_review`、human review、draft validation 和 formal promotion，尤其是 `vision_evidence_review_decision` / `vision_evidence_policy_correction_patch` 的存在状态，供产品/API/下游 agent 直接消费。upload-session handoff、workspace 根节点、MCP handoff、task packets 和 MCP authoring handoff 都会继承 release checklist required/failed/review required id 摘要，避免 artifact authoring 阶段再解析 checklist artifact。upload-session workflow、handoff 和 workspace commands 还会暴露 `prepare_vision_evidence_review_workbench` 与 `build_vision_evidence_policy_correction_patch`，让人工导出 accepted decision 后可以直接生成 evidence-policy correction patch；release checklist schema 会强制包含 required 的 source/assets/artifacts/PhotoGradeReadiness/VisionEvidence review/human review 检查项，release work-order schema 也会条件要求 `vision_evidence_review` task 带四个 VisionEvidence artifact role 和 policy correction command。新增 `image-structured:validate-real-world-building-release-artifact-workspace` 可独立验证 workspace schema、task packet 覆盖、review requirements 覆盖、release checklist required 摘要、release checklist 摘要传播到 MCP handoff/task packets、semantic evidence quality 传播、direct DSL fail-closed、候选消歧传播、VisionEvidence review patch 传播、MCP authoring handoff 覆盖和 ready-to-author 状态，CI/产品页无需绕回完整 release gate 才能判断交付包是否可继续。`npm run image-structured:prepare-real-world-building -- --intake-dir ...` 可从 intake `asset-set.json` 自动提取 source assets、sample id、profile hint 和默认 release artifact 路径，生成 manifest 草稿、`manifest-contract-summary.json`、`release-checklist.json`、`release-checklist.md` 和 `release-work-order.json/md`；也可继续用显式 source/PartGraph/output/QA 路径。checklist 会阻止生成图、脚手架、截图和网页来源路径进入 release-positive，并要求 VisionEvidence report、review patch、accepted review decision 和 policy correction patch 全部存在且保持 evidence-policy-only；work-order 会把阻塞原因拆成下一步可执行任务，而不是要求用户改样例脚本；`real_world_building_positive_manifest_contract` 会自动读取 `examples/real-world-building-positive/manifest.json`。当前正式 manifest 缺失，所以 contract case 通过但 `closes_release_gap=false`；将来 manifest 存在且通过真实资产、人工 review 字段、output freshness、physical QA、PhotoGradeReadiness、VisionEvidence policy review、PartGraph source provenance alignment 和 release checklist 后才会关闭剩余缺口。可用 `npm run image-structured:validate-real-world-building` 单独生成缺口/验证报告；无效草稿会返回 `ok=false` 但仍写出 summary/checklist/work-order artifact，正式验收时加 `-- --require-present`。
- release work-order 的定位固定为任务调度，不是几何证据源；`artifact_authoring_policy` 必须保持 `direct_sketchup_dsl_allowed=false`，并把语义证据质量的读取源指向 source request、MCP brief 或 release artifact workspace。产品/API/MCP 后续做 artifact authoring 时应消费 workspace task packets、`mcp_authoring_handoff` 和 `semantic_evidence_quality`，不能只读 work-order 任务标签生成 SketchUp DSL。
- 真实建筑 source-package 评估已接入 intake 和 demo audit：建筑类上传会写出 `real-world-building-source-package.json/md`，用同一套 contract 判断 source authenticity、required views、scale confidence、semantic role coverage 和 release checklist blockers，并给出 `input_ready_for_release_work` 和 `source_request`。`source_request` 是产品上传流程的补素材请求 contract，会把需要替换的源素材、缺失视角、尺度证据目标、允许的 image/PDF/CAD 类型、语义证据质量和满足前禁止的输出直接暴露给产品/API/MCP；现在它也会作为独立 `real-world-building-source-request.json/md` 落盘，并由 `schema/real-world-building-source-request.schema.json` 固定，upload-session summary 直接给出 artifact 路径。source request 根节点、`semantic_requirements` 和 `upload_package_requirements.semantic_evidence` 都必须继承 `semantic_evidence_quality`，即使 `status=input_ready_for_release_work` 也要保留 weak/review-required roles、risk flags 和 `geometry_promotion_allowed=false`。demo candidate audit 还会为每个候选暴露 `source_request` 摘要、`release_stage`、`release_candidate_assessment`、`artifacts.source_request`、`artifacts.upload_manifest_template` 和带 `--source-request-file` 的 `refill_workflow` 命令，让新 demo 素材可以按同一条 upload-session 补交验收而不是改样例脚本。`best_structure_review_candidate` 只代表结构审查素材，`best_release_work_candidate` 只有真实源图包过 source gate 后才会出现；`input_ready_for_release_work` 只表示源图包能否进入发布样本建模/人工确认，不会替代 `release_ready`；当前本地建筑单体/截图候选均为 `blocked_source_assets`，`input_ready_source_packages=0`、`release_selectable_candidates=0`。
  - Source request 现在还必须暴露 `upload_package_requirements`：下一轮上传包的 manifest 文件名、required view slots、missing required views、scale evidence、forbidden shortcuts 和 `next_upload_response_check_ids` 都要在一个机器块里可读，前端/API/MCP 不能靠自由文本或多字段拼接来生成补素材表单。
  - 新增 `image-structured:prepare-real-world-building-source-refill-package`：输入上一轮 `real-world-building-source-request.json`，输出 `source-refill-package-guide.json/md`、README、`source-slots.md`、安全的 `upload-manifest.template.json` 和专用 `upload-package/` 真实上传目录。guide 由 `schema/real-world-building-source-refill-package-guide.schema.json` 固定，明确 object type、required source slots、distinct `views[].source_image`、scale evidence、forbidden shortcuts、`build_manifest_from_sources`、`run_source_refill_workflow`、`validate_refill_package` / `require_upload_ready` 和下一轮 `real-world-building-upload-session --source-request-file ... --require-source-input-ready` 命令；它保持 `direct_upload_ready=false` / `template_only=true`，不能被当作真实上传包或 release candidate。新增 `image-structured:build-real-world-building-source-refill-manifest`，在用户把真实文件放进 `upload-package/sources/` 后按 front/left/oblique/top/plan/perspective 等明确文件名关键词生成 `upload-package/manifest.json`；缺视角时只输出 draft/pending，不按文件顺序硬猜。新增 `image-structured:run-real-world-building-source-refill-workflow` 和 `schema/real-world-building-source-refill-workflow-report.schema.json`，把 manifest build、upload-ready validation 和可选 `--run-upload-session` 收敛成单个产品/API report；默认只到 `ready_for_upload_session`，不自动触发 upload-session。新增 `image-structured:validate-real-world-building-source-refill-package` 和 `schema/real-world-building-source-refill-package-validation.schema.json`，在 upload-session 前区分 `template_package_pending`、`ready_for_upload_session` 和 `invalid_refill_package`，并检查 helper artifact 分离、真实 manifest、JSON 可解析、manifest `kind` / `object_type`、source refs 在 upload-package 内、required views、路径去重和内容去重。upload-session workflow/handoff、demo candidate audit 的 `refill_workflow` / `release_preparation_workflow` 和 blocked release artifact workspace commands 都必须暴露 `prepare_source_refill_package`、`validate_source_refill_package_require_upload_ready` 和指向专用 `upload-package/` 的 refill upload-session 命令，让产品/API/MCP 直接按同一条机器命令链推进。
  - 上传包预检和上传会话已进入 release gate：`image-structured:preflight-real-world-building-source-package` 在 intake 前输出 `real_world_building_source_package_preflight`，区分 `can_start_structured_intake` 和 `release_source_candidate`；`image-structured:real-world-building-upload-session` 会把 preflight、metadata 文件状态、自动生成/显式传入的 view hints、intake、source gate、MCP brief、source request、upload manifest template、release draft/checklist、review workbench 和下一步 `workflow` 收敛到 `upload-session-summary.json`，并额外写出 `upload-session-handoff.json/md` 作为产品/API/MCP 单文件交接入口。`workflow.stage` 会稳定区分 `source_refill_required`、`source_response_refill_required`、`source_input_ready_needs_release_artifacts` 等阶段，并给出 refill upload-session、source-package 复评、prepare release sample、prepare release artifact workspace、validate draft 和 release gate 命令；handoff 会把 artifact-ready 阶段的 primary action 指向 `release-artifact-workspace.json`。preflight 和 AssetSet 会记录 `content_sha256`，重复文件内容会进入 `source_content.duplicate_groups` 并触发 `duplicate_source_assets`；同一张图复制成多个 view label 时，必须保持 `release_source_candidate=false`，source-package 也不得 `input_ready_for_release_work`。release gate 已单独覆盖 generated-view-hints 上传会话，要求未传 `--view-hints-file` 时从上传包 `manifest.json` 自动生成 `view-hints.generated.json`、交给 intake并解除 front/left/oblique/top missing-view blockers；同一个 manifest 的 known dimensions 必须进入 observations/source-package/MCP brief 的 scale evidence；source input gate 必须通过并写出 gate-result artifact，同时 summary 必须暴露 `intake.source_package`、`artifacts.source_request` 和 `artifacts.upload_manifest_template`，包括 source/view/scale/semantic status、required/failed requirements、blockers、missing views、release-checklist blockers、workflow、handoff 和 next actions；请求 release draft 时 summary 必须暴露 manifest/checklist/work-order artifact、parsed metadata 状态、fail-closed draft 状态、release draft blockers、required/failed/review required checklist id 摘要、checklist check statuses、workspace next commands，并可生成 `release-artifact-workspace.json/md`；无效 upload manifest 必须在 preflight 和 upload-session summary 中记录 `invalid_contract`、顶层状态 `blocked_source_metadata`、触发 `invalid_source_metadata`，并且不能生成 view hints；manifest 指向缺失源文件、生成/截图/裁剪 demo 路径和重复源文件都必须被挡在 release-source 之前，blocked 时仍保留 review/demo artifact，并保持 `can_generate_sketchup_dsl=false`。
  - 上传会话同时承载 VisionEvidence artifact 和结构化 handoff：summary/handoff/workflow 会保留 `vision_evidence_report`、`vision_evidence_review_patch`、`vision_evidence_review_workbench`，handoff 会暴露 `vision_evidence.semantic_evidence_instances` 与 `vision_evidence.modeling_handoff`，review workbench 会链接独立 VisionEvidence workbench；这让产品上传页、API 和 MCP 都能直接消费同一份结构化图片理解结果。
  - `view_source_diversity` 已进入 preflight/upload-session/source-request contract：同一个上传源路径不能在 manifest 中同时满足多个 required view。即使 `missing_hinted_views=[]`，只要 front/left/oblique/top 等必需视角复用了同一路径，就必须触发 `view_sources_not_distinct`、保持 `release_source_candidate=false`，并在 `view_package.view_source_diversity.reused_source_paths` 中暴露复用路径和视角；upload-session 不得为这类冲突标签生成 `view-hints.generated.json`，summary 必须直接暴露 diversity 失败。`real-world-building-source-request.json` 和 `upload-manifest.template.json` 也会写 `view_source_requirements`，明确 required views 必须引用不同 `views[].source_image`。
  - Source-request response 已进入 upload-session contract：用户按上一轮 `real-world-building-source-request.json` 补交素材后，下一轮 upload-session 可传 `--source-request-file`，系统会写 `source-request-response.json/md`，并在 summary 的 `source_request_response`、`artifacts.source_request_response` 和 `gates.source_request_response_ok` 中明确本次上传是否满足上一轮请求。response checks 会同时验收 source assets、视角、`view_source_diversity`、尺度证据和语义角色，并在 artifact 的 `summary.requested_check_ids` / `satisfied_check_ids` / `unsatisfied_check_ids` / `unsatisfied_check_details` 以及 upload-session summary 中暴露可直接给产品/API/MCP 使用的失败摘要。当前 release gate 要求 generated-view-hints 正向上传包把 blocked fixture 的 source request 验收到 `satisfied_for_release_work`，但仍保持 `release_ready=false` 和 `can_generate_sketchup_dsl=false`，避免把“补素材请求满足”误报成“发布完成”；同一个 upload-session fixture 也覆盖错误补交负例：如果用户仍用同一个 `source_image` 路径标成 front/left/oblique/top，preflight 必须保留 `view_sources_not_distinct`，response artifact 必须把 `view_source_diversity.current_status=fail` 写入 failed check，`gates.source_request_response_ok=false`。
    - Response summary 必须回显上一轮 `upload_package_requirements.next_upload_response_check_ids` 为 `expected_check_ids`，并暴露 `missing_expected_check_ids` / `unexpected_requested_check_ids`；如果表单要求没有被实际验收覆盖，不能把 response 升级为 satisfied。视角补证必须进入 `summary.view_evidence`，稳定列出上一轮缺失视角、本轮 present/missing 状态、`view_source_diversity_status` 和 `requested_view_evidence`；语义补证也必须进入 `summary.semantic_evidence`，稳定列出上一轮要求、本轮覆盖和仍未满足的语义角色，并携带本轮全部 role evidence、上一轮请求对应的 `requested_role_evidence` 和 `evidence_quality`，不能再让视角来源、凹进立面、风管/方管、阴影/凹槽边界只以自由文本方式交给 MCP。
  - Source-package 的视角和语义覆盖必须带 provenance 和质量状态：`view_package.view_evidence`、`semantic_package.role_evidence`、`semantic_package.evidence_quality`、source request、upload-session summary/handoff 和 MCP brief `source_package_gate.view_evidence` / `semantic_role_evidence` / `semantic_evidence_quality` 需要同步暴露每个 required view 的 source asset 来源，以及每个 required role 的候选 id、视角、source image、置信度范围、弱候选/review-required 状态、风险 flags 和 `geometry_promotion_allowed=false`；MCP 不能只拿到 view/role count 或自由文本说明。
  - 补交轮次的 MCP brief 会同步回写 `source_request_response_gate`：如果 response 未满足，brief 的 `compile_permission.reasons` 和 `agent_contract.output_policy.blockers` 必须包含 `source_request_response_failed`，`agent_contract.required_confirmations` 必须列出需要解决的 failed response checks；如果 response 满足，brief 记录 `satisfied_for_release_work` 且 `unsatisfied_check_ids=[]`。upload-session 还会同步重写 review workbench，让内嵌 `mcp-modeling-brief-data` 和页面 MCP Brief 区块显示同一 response gate。这保证 MCP/建模 agent 或前端只消费 `mcp-modeling-brief.json/md` / review workbench 时也能看到上一轮补素材合同的验收结果。
  - 上传 manifest contract 已固定：`schema/real-world-building-upload-manifest.schema.json` 和 `examples/real-world-building-positive/upload-manifest.example.json` 区分上传 metadata 与最终 release manifest，主 validation 会校验示例、动态生成的 upload manifest fixture、缺失 source reference 负例和 `upload-manifest.template.json`。template 带 `template_only=true`，只用于产品/用户补素材指引；如果被原样改名成 `manifest.json` 进入上传包，或 manifest 引用了不存在的 `source_image`，preflight 必须以 `invalid_contract` 拒绝。
  - 主 validation 已有正向 contract：四视角、非生成源图、尺度置信度过线、建筑单体语义角色齐全时必须得到 `input_ready_for_release_work=true`；同时也有假阳性保护，即 source gate 未过时即便 checklist 被误填为 ready，source-package 的 `release_ready` 也必须保持 false。
  - `image-structured:intake` 自身也可作为 source-package 硬门禁：上传/API/CI 流程可直接加 `--require-source-input-ready` 或 `--require-source-release-ready`，命令会写 `real-world-building-source-package.gate-result.json` 和 `intake-summary.json` 并在不满足要求时返回非零退出；release gate 会对建筑单体 blocked demo 验证这个 intake 级 gate artifact 和 summary artifact。
  - 新增 `image-structured:assess-real-world-building-source-package`，可从已有 intake 目录重新读取 `asset-set.json`、`observations.json`、`candidate-graph.json` 和可选 release checklist，重写 `real-world-building-source-package.json/md`；默认模式只做审计复评，上传/CI 流程可加 `--require-input-ready`，正式发布验收可加 `--require-release-ready` 让不满足门禁的输入包返回非零退出；硬门禁模式会自动写 `*.gate-result.json`，由 `schema/real-world-building-source-package-gate-result.schema.json` 固定 `ok`、`required_gates`、`failed_requirements` 和 source-package artifact 路径，也可用 `--gate-output` 指定输出。release gate 会对建筑单体 blocked demo 同时复验默认审计、require-input-ready 失败语义和 gate-result artifact，确保补图/补 CAD/PDF 后可以单独复评输入包。
- 真实建筑 demo 候选审计已进入 release gate：`image-structured:audit-real-world-building-candidates` 会对候选路径批量运行 intake + release draft/checklist，输出 `candidate-audit-report.json/md`，JSON 由 `schema/real-world-building-demo-candidate-audit.schema.json` 固定；报告记录语义覆盖、source/artifact/PhotoGradeReadiness blockers、缺失视角/尺度、`release_stage`、`release_candidate_assessment`、source-request artifact、upload manifest template、下一轮 refill upload-session 命令和 `release_preparation_workflow`。`release_preparation_workflow` 会把选中候选后的 upload-session、release artifact workspace、workspace validation、manifest draft validation 和 guarded formal manifest write 命令串成机器可读流程；本地截图、canonical crop、生成图或网页来源样本只能作为结构化审查 demo，必须保持 `best_release_work_candidate=null` / `release_selectable_candidates=0`，不能关闭 release gap。
- 正式真实建筑 release checklist 也会检查源文件内容去重：`source_assets` 不只要求路径存在、不是生成/截图/脚手架来源，还会对 `manifest.source_images` 计算内容 hash；重复源文件会标记 `duplicate_content_blocker`，并阻止 `can_promote_to_release_manifest`。
- release gate artifact integrity 已进入 release gate：`release_gate_artifact_integrity` 会扫描前面所有 case 的 `artifacts` 声明，要求普通 artifact 路径真实存在；正式建筑 manifest 这种当前预期缺失的路径必须显式标成 `expected_missing`，不能在报告中宣称尚未生成的 release checklist、compiled output 或 QA 文件。生成的 `artifact-integrity-report.json` 由 `schema/release-gate-artifact-integrity-report.schema.json` 固定；该 case 现在还会做 release contract drift checks，确保 workspace 生成/验证脚本、schema、npm scripts、upload-session/handoff command schema、source-package/MCP brief release checklist summary schema、release checklist required-check schema、content frame schema/implementation、README/PLAN/MEMO 和主 validation 入口没有脱钩。

当前状态：

1. R1/R2 第一版已完成：root `ProductProfile` / `PartGraph` schema、`vehicle_ambulance` profile、救护车 part graph 和 part graph compiler 已落地。
2. 救护车验收 DSL 已从 part graph 编译生成，不再由脚本直接摆放 DSL object。
3. R3 Reference Visual QA 第一刀已完成：救护车样例有独立 reference visual spec，correction target 指向 PartGraph 字段。
4. R4 已完成到子项目技术预览闭环：ambulance image observations 会生成/更新 seed `part-graph.generated.json` 和 no-seed `part-graph.skeleton.json`，写入 contour/keypoint、跨图 part matching、尺度校准、证据置信度、PartGraph correction targets、Reference Visual QA correction patch 和质量门禁。
5. R6 当前边界已完成：no-seed skeleton 现在会输出 review-gated `parameter_proposals`，把图像尺度校准、bbox/keypoint evidence 和 profile role ratio 转成可审查候选参数；已接受的 proposal 可转成标准 `part_graph_correction_patch` 并回写 PartGraph，proposal review UI 可导出 accepted proposal JSON，并且 `image-structured:proposal-review-chain-ambulance` / `:queue` 已把 proposal-applied DSL 接到 mock/queue QA。当前只接受 body/cab 两项时仍输出 `review_required: true`，不会自动替换全部 inferred-only 几何。主线产品样本 gate 也已把 physical consistency QA 扩到 ambulance、Switch、Fuji 三样例。
6. 镜像/手性风险已进入当前门禁：Image observations 会写入 `orientation_hints` 和 mirror risk，Reference Visual QA 新增 `orientation` 规则组，当前三产品 reference spec 都有左右/上下方向锚点，Switch 镜像摇杆负例会被 `reference.orientation_order` 打回。
7. R7 当前生成图建筑群样例已收口到 technical baseline：`test/建筑群/` 的三张 GPT Image 合成航拍图已接入 `building_group` profile，`image-structured:build-building-group` 会生成 `examples/building-group/observations.json`、review overlays、`part-graph.massing.json` 和 `output.massing.json`。尺度来自停车位、车道和人行横道等 known-element anchors，约 `130m x 98m`，shape proposals 保持 review-gated。`image-structured:qa-building-group` / `:queue` 已补 massing mock/live QA 并保存建筑群 massing `.skp`。R7 final 新增 accepted-all detail review fixture、`building-group-r7-final` feature Reference Visual QA、`part-graph.r7-final.json` / `output.r7-final.json`，并通过 `image-structured:proposal-review-chain-building-group-all` / `:queue` 完成 all current roofline/facade/opening proposals -> patch -> mock/live queue QA，保存 `output/image-structured-building-group-r7-final.skp`。
8. Visual Grounding / Grounding v2 已完成当前目标：`ObservationSet` 现在输出 `visual_relation_graph`，每条 image-space relation candidate 带 source image、bbox/keypoint/semantic-anchor basis、confidence 和 `review_required`；Switch 的人工视觉检查已沉淀为 `visual-relations.fixture.json` + `image-structured:visual-relation-switch`，会对比 observation relation candidates 与 accepted Switch PartGraph 投影，并用 `mirror_x` 负例防止左右关系静默镜像。建筑群 massing PartGraph 也会接收 relation candidates 到 `evidence_graph.visual_relations`、part `relationships` 和 spatial `physical_relations`，并新增 `image-structured:visual-relation-building-group` fixture；四栋仓库、停车线/车道、树列这类细粒度关系保留 image-only QA，同时进入 review-gated `part_candidates` proposal queue。candidate promotion 已能把两条 row 拆成 4 个真实仓库 parts，并新增 2 条停车线、1 条停车车道、1 条树列。Grounding v2 已追加 provenance schema、mask/contour evidence、top/oblique calibration records、GeometryFit v2 residual QA、R8 helper-heavy dense report 和第二建筑群 mock gate；当前候选链检查 9 个 footprint、12 条 projected relation、4 个 scale anchor 和 1 个 handedness negative，第二样本检查 4 个 footprint、3 条 relation、2 个 scale anchor 和 1 个 handedness negative。R9 GroundingGraph v3 已补第一刀：`ObservationSet.grounding_v3`、`evidence_graph.ground_plan` 和 PartGraph `grounding_decision` 会记录多候选 ScaleAnchorGraph、互斥 GroundPlan region、line/grid residual、TopViewOverlay QA 和 candidate promotion decisions；当前样本与第二建筑样本都产出 `grounding-v3-report.json`，当前样本 live queue candidate chain 仍可保存 `.skp`，但 `photo_grade_candidate=false`。R9.5 已新增 PhotoGradeReadiness：三个 runner 会对 building-group、second sample 和 real-photo smoke scaffold 输出 `photo-grade-readiness-report.json`，统一检查 scale、subdivision、line/grid、top-view overlay、oblique/facade 和 promotion 六类 gate。R10 AutoGroundPlan 已把当前建筑群平面 grounding 改为 evidence resolver + canonical parking/grid + road corridor reject + rectilinear subdivision + StructuredPlan QA：当前 building-group hard gates 为 road/building overlap 0、raw contour leakage 0、parent/child double occupancy 0、canonical overlap 0。R11 BirdEyeLandCover 已新增 local classical CV land-cover 层，在 GroundPlan 前先输出建筑 exclusion、硬质铺装、道路/停车候选、标线、植被、裸土、阴影/unknown 和四联 QA 图。R11.1 BoundaryGraph 已从 bbox/prior 边线修正为 source-image edge-first。R11.2 已补真实 OpenCV backend：`opencv-edge-v1-report.json` 使用 Python `cv2` CLAHE/Canny/HoughLinesP/LSD，当前 OpenCV 4.13.0 提取 accepted edges 112、rejected edges 148、site perimeter confidence 0.778、road boundary confidence 0.727；BoundaryGraph 融合 source-image、OpenCV 和 HighContrastEdge 后 `opencv_boundary_edge_count=112`、`road_corridor_count=7`，AutoGroundPlan site surface 来自 boundary graph `[81,31,738,558]`，structured QA remaining unknown gap ratio 0.198、road candidate review count 0。R12 已把这些轻量视觉链路收敛到 `VisionEvidenceSet v1`：building-group 当前汇总 masks 91、edges 810、accepted edges 528、lines 166、regions 961、relations 1384，`default_heavy_model_required=false`，BoundaryGraph/AutoGroundPlan 优先通过该统一 evidence contract 消费 OpenCV、HighContrast、land-cover 和 VisualRelationGraph 输出。`view_ground_plane` 现在按每张图输出 evidence summary、confidence components、confidence band、usage policy 和 risks：当前 top 图为 `planar_groundplan_candidate`、confidence `0.94`，两张 oblique 图保持 `review_only_oblique_context` 并带 `oblique_view_not_planar_groundplan`。R12 review patch first slice 已生成 `vision-evidence-review-patch.json/md`，当前有 5 个 `needs_review` 项并显式禁止 apply/compile；review workbench first slice 已生成 `vision-evidence-review/index.html`，release gate 会用 headless Chrome 导出 `vision-evidence-review.browser-exported.json`；policy correction first slice 已能把 review decision 转成 `vision-evidence-policy-correction-patch.json/md` 和 `vision-evidence-v1.reviewed.json`，但 apply scope 仅限 `vision_evidence_set_policy_only`，仍禁止 compile 和 geometry promotion。这个结果比旧 HighContrast-only 更真实，但仍是 review/technical baseline：边线数量、top-view 使用边界和待确认事项已经更可解释，下一步瓶颈是更稳定的语义融合、把这个 workbench 接到真实上传会话和更多样本，而不是继续用旧 bbox/prior corridor 强行补洞。second sample 和 real-photo smoke 同 runner 会在 parking/road 与 building 冲突时自动降级 gap/review。当前两个生成样本仍为 `technical_baseline`，真实照片 scaffold 为 `review_required`；没有任何样本被静默升级成 photo-grade candidate。

## 当前执行计划（2026-05-27）

当前已完成 Switch 手柄示例的端到端 baseline：`observations.json -> model-plan.json -> output.json -> review/index.html -> output/image-structured-switch-controller.skp`。阶段 6 收口补齐了 correction-driven regression 和第二产品样例：`compact-remote` 通过 `object_profile` 走独立生成/编译路径。

本轮验收后，执行目标调整：子项目暂不作为可发布阶段提交，先作为技术预览继续攻关。当前 Switch 链路读取了多张图，但模型生成仍高度依赖 Switch layout prior；它不是多图联合理解后的三维重建。救护车验收模型是人工综合多图后手写 DSL，也不代表子项目已经具备自动多视角融合能力。

执行顺序：

1. **修正发布边界**
   - 文档和 review artifact 明确区分：图片证据、模板补全、人工确认。
   - 单图输入不能静默生成和多图同等完整/同等可信的模型。
   - 子项目状态改为技术预览，不进入正式发布提交。
   - 2026-05-25 已完成第一切片：schema、model-plan、manual corrections、review report 和测试门禁均接入 `evidence_status` / `template_prior` / `manual_confirmed`；per-image 单图产物会记录 open question 和 template-prior parts。

2. **补跨图融合**
   - 建立 evidence graph：每个 part 记录来自哪些视图。
   - 记录轮廓、厚度、前后表面、按钮/开孔/凹槽/凸起的来源。
   - 记录冲突和 open questions。
   - 2026-05-25 已完成第一切片：`model-plan.review.evidence_graph` 派生 required/confirmed/missing views、sources、conflicts 和 part-level open questions；review report 与 per-image summary 已展示/记录该 graph。
   - 2026-05-27 已完成第二切片：`observations.json` 原生保存 `evidence_graph`，model-plan 优先合并 observation graph，并把 template-prior / feature fallback conflicts、open questions 和 correction suggestions 展示到 review artifact。后续仍需做真正图像侧跨图冲突检测和基于 graph 的生成器重构。
   - 2026-05-27 已完成第三切片：`model-plan.review.semantic_fusion` 把 graph evidence 融合为 per-part `status` / `decision` / `confidence` / semantic evidence / feature mapping signals / review flags，Switch 和 compact remote artifacts 已刷新并纳入 `test:image-structured`。
   - 2026-06-01 已完成 VisualRelationGraph 第一切片：`observations.json` 原生保存 image-space relations，`evidence_graph.visual_relations` 同步携带候选关系；Switch fixture 覆盖手柄左右、摇杆/按钮/d-pad 手性、中心面板包含/居中和镜像负例，建筑群 PartGraph 已能消费关系证据并映射可判定的 `physical_relations`；building-group fixture 检查粗 massing 关系与 image-only 细粒度关系；细粒度建筑群对象已进入 review-gated `part_candidates` proposals，8 个候选已能 promotion 为真实 parts。随后追加的 GeometryFit 第一刀会对同一候选集输出 projection calibration 和 center/extent/relation/scale/handedness residual，并新增 grounding isolation gate；当前 mock/live queue 已通过，右下角停车线/车道/树列不再是 mixed bbox proxy grounding，但仍只代表当前生成图样例的技术基线。

3. **补凹凸/特征语义**
   - 在 observation/model-plan/corrections 中增加 `concave`、`convex`、`flush`、`decal/printed`、`through_hole`、`blind_recess`。
   - 编译器根据语义选择真实 feature operations；主线不支持时必须显式降级。
   - 2026-05-27 已完成第一切片：`blind_recess -> cut_recess`、`through_hole -> cut_hole`、`convex -> add_boss/add_raised_rib` 已进入 compact remote 编译路径；review report 会显示 real feature op 或 fallback 状态。

4. **产品化人工修正**
   - `manual-corrections.json` 支持 part 参数、证据状态、凹凸语义和 feature mapping。
   - review report 显示 part id、参数、evidence、模板来源和 Correction Patch Suggestions。
   - 2026-05-27 已完成 authoring data 第一切片：`model-plan.review.correction_suggestions` 给出可复制的 `manual-corrections.json` patch 骨架。
   - 2026-05-27 已完成交互式工作台切片：review HTML 新增 Corrections Workbench，可选择建议、编辑 JSON、校验、复制和下载 `manual-corrections.workbench.json`。

5. **稳住 baseline**
   - 修复测试/验证链路。
   - 同步 `MEMO.md`、`QUEUE_VERIFICATION.md` 和真实产物指标。
   - 建立 mock/queue snapshot 对照报告。
   - 将 warning 分成 expected contact、intentional shallow overlap、real collision、bbox false positive。

6. **增强建模证据**
   - 从 edge sample 提升到 contour/polyline。
   - 提取 keypoints：外壳角点、按钮中心、摇杆中心、肩键边界。
   - 生成 component candidates：shell、center grip、thumbstick、button cluster、screw、rail。
   - 参考 Free2CAD 的约束思路增加对称轴、平行边、同心圆、等距按钮阵列检测。
   - 2026-05-29 已完成 R4 image evidence -> PartGraph 闭环：`analyze-image-set` 输出 coarse contour/polyline 和 keypoint candidates；ambulance profile hints 会参与 view labeling；`generate-part-graph-from-observations.mjs` 会把 image evidence 写入 seed generated PartGraph 和 no-seed skeleton PartGraph；质量门禁会检查 `profile_default_ratio`、`needs_review_ratio`、observed/inferred 数量和 scale confidence。
   - 2026-05-30 已补 orientation/mirror hints：`observations.json` 会记录 image-space 坐标约定、mirror risk、semantic anchors 和 review_required；当前 ambulance side view 会记录 front/rear wheel 与 cab/body 的手性线索，供 PartGraph 生成和 review 使用。

7. **提升 SketchUp 几何质量**
   - 依赖主线 MCP 的 `cut_hole`、`cut_slot`、`cut_recess`、`add_boss`、`add_raised_rib`。
   - 编译器根据 evidence/part 参数选择真实 feature operation，而不是视觉 marker。
   - 已完成第一批消费：compact remote 的 button/rocker/grille 会编译为 `add_boss` / `add_raised_rib` / `cut_recess`；manual-correction regression 覆盖 decal marker 切换到真实 `cut_recess`。

8. **开始泛化**
   - 在特征编辑和多图融合稳定后增加第三产品样例。
   - 将 Switch-specific prior 收敛到可解释、可降级的 profile。
   - 抽象通用 part taxonomy。
   - 评估是否接入 VLM，只用于语义判断，不替代几何测量。

R4.2 已完成：

1. Reference Visual QA 的 `update_part_graph` suggestions 已可转成 `part_graph_correction_patch`，并可回写 generated PartGraph。
2. correction patch 会对 observed part 的 shape parameters 做可应用 proposal；测试中通过人工侧窗漂移验证 patch 能降低 Reference Visual QA issue 数。
3. `profile_default` / `needs_review` 比例已作为样例质量门禁输出，避免只看 runtime 成功。

R5 已由主线完成：

1. 增加第三产品样例，要求从 `ProductProfile -> PartGraph -> DSL -> Layout QA + Reference Visual QA` 跑通。
2. 将 Switch-specific prior 收敛为正式 `ProductProfile`，减少 model-plan 路径和 PartGraph 路径的长期分叉。

下一步：

1. 进入 R12 后的轻量图片结构化核心加固：默认链路已经收敛为 `Images -> VisionEvidenceSet v1 -> EvidenceGraph -> BoundaryGraph/GroundPlan/VisualRelationGraph -> PartGraph -> DSL -> QA`，且不依赖 SAM、INSID3、Grounded-SAM、CUDA 或云端大模型。`VisionEvidenceSet` 的第一层 view/ground-plane estimate 已结构化到每图 evidence summary、confidence components、usage policy 和 risk flags；`VisionEvidenceReviewPatch` 第一版已经把 ground-plane policy、oblique 风险和 edge-class policy 变成不可直接应用的 review contract；`VisionEvidenceReviewWorkbench` 第一版已能在浏览器导出 review decision；`VisionEvidencePolicyCorrectionPatch` 第一版已经把 browser-exported decision 回写成 VisionEvidenceSet policy metadata，并保持 `compile_allowed=false`、`geometry_promotion_allowed=false`。当前它已接入普通建筑 intake/upload-session/MCP brief，下一步应把语义融合、更多真实上传样本和样本集扩展做硬：OpenCV/HighContrast 边线继续区分建筑外轮廓、屋面内部缝、道路边线、铺装/绿化分界和 site perimeter；鸟瞰/轴测鸟瞰样本增加时仍走同一 schema 和 failure gates；真实照片 smoke 需要替换为真实 top/oblique 建筑照片资产或补更强 oblique facade/height cues。在 ScaleAnchorGraph、GroundPlan、line/grid residual、TopViewOverlay、oblique/facade 和 promotion gate 同时成立前，不尝试把任何样本标成 `photo_grade_readiness=candidate`。
2. 继续沿用 no-seed proposal -> proposal review -> correction patch -> QA/queue 纪律；真实建筑立面、屋顶和开口 geometry 在证据不足时仍必须保持 review-gated。
3. 之后再把 proposal/patch authoring 扩到 Switch/Fuji 或新的产品/场景边界样例。

已完成/保留的原计划能力：

1. **产品化人工修正**
   - 扩展 `manual-corrections.json`，支持修改 part 参数。
   - 给 part 标记 `observed` / `inferred` / `template_prior` / `manual_confirmed`，并保留旧 `visually_detected` / `inferred` / `manually_confirmed` 兼容字段。
   - review report 显示 part id、参数、evidence sources、evidence graph、模板来源、feature semantics 和 Correction Patch Suggestions。
   - 增加 correction-driven regression tests。**已完成第一条回归：Switch regression fixture 会验证 corrections 改变 model plan、evidence status 和 compiled DSL。**

2. **提升 SketchUp 几何质量**
   - 补 `button_on_panel`、`recess`、`screw_hole`、`slot`、`beveled_panel`、`shell_from_front_side_profiles`。
   - 编译器根据 evidence/part 参数选择 primitive。
   - 用 recess/contact metadata 降低粗 overlap warning。

3. **开始泛化**
   - 增加第二个产品样例。
   - 将 Switch-specific prior 收敛到 `object_profile`。
   - 抽象通用 part taxonomy。
   - 评估是否接入 VLM，只用于语义判断，不替代几何测量。
   - **已完成第一条第二产品样例：`examples/compact-remote` 能生成 model plan、DSL、review report 和 mock snapshot。**

历史 baseline 稳定工作已完成，并已执行第一轮 overlap reduction：

- `npm run test:image-structured` 的 Ajv import 卡住问题已修复，验证脚本改为项目内轻量 JSON Schema subset validator。
- 已新增 `image-structured:snapshot-switch`，默认生成 mock snapshot report。
- 当前 mock geometry warnings 已从 22 个降到 0 个，没有剩余未分类 warning。
- 已新增并验证 `image-structured:snapshot-switch:queue`，可生成真实 SketchUp `.skp` 和 queue snapshot report。
- 已新增并验证 `image-structured:diff-switch:queue`，复用 `src/snapshot-diff.mjs` 生成 mock/queue snapshot diff report；当前正式 queue diff artifact 已生成，结果 `pass`，0 diffs。
- 已新增 `examples/switch-controller/warning-budget.json`，`npm run test:image-structured` 会用它校验 warning budget。
- 已给当前 Switch 输出增加质量门槛：bbox、groups/instances/scenes、0 error warning，以及禁止回退到粗 `mesh` / `box` primitive。
- 已把当前 mock warning 分类推进到 DSL/runtime `qa.expected_contacts` 元数据；当前 mock snapshot report 中 geometry warning 为 0。
- SketchUp 插件文件已补 group/component instance 的 `qa` snapshot 支持；2026-05-20 已安装到 SketchUp 2026 Plugins 目录、重启 SketchUp、通过 Extensions 菜单启动 Bridge，并重新跑通 `npm run image-structured:snapshot-switch:queue` 和 `npm run image-structured:diff-switch:queue`。
- 当前 queue snapshot/diff 已验证：geometry warning 为 0，4 个 PBR warning 来自 `runtime_material_capability`，mock/queue diff 为 `pass` / `ok` / `0` diffs。
- 已把按钮/螺丝/摇杆从“穿插/贴面”改成 `button_on_panel`、`screw_hole`、`analog_stick` 这类产品 primitive，并同步收紧 `warning-budget.json`。
- 已把 rear grip attachment 从粗 bbox overlap 改成接触不穿插的几何。
- 已新增 `examples/switch-controller/manual-corrections.regression.json`，`npm run test:image-structured` 会断言人工修正能改变 part 参数、按钮数量和编译后的 DSL。
- 已新增 `examples/compact-remote` 第二产品样例与 `image-structured:build-remote`，当前 mock snapshot 为 11 groups / 529 faces / 1234 edges / 452 vertices / 2 scenes，warnings 0。

---

## 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Input: 3-6 张产品照片 / 三视图 / 尺寸标注图                    │
│  (Switch 手柄、Huggy Pro 帐篷、建筑三视图...)                  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1 │ analyze-image-set.mjs                             │
│  · 视角分类 (front/side/top/back/oblique)                      │
│  · 输入质量报告                                               │
│  · 关键轮廓线提取                                              │
│  · 对称轴检测                                                 │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2 │ make-review-overlay.mjs                           │
│  · 透视校正 → 近似正交 overlay                                │
│  · 部件边界框 + 关键点标注                                     │
│  · 不确定区域标红                                            │
│  · 输出 review artifact (SVG/PNG + JSON)                     │
└────────────────────────┬────────────────────────────────────┘
                         ▼ 人工确认 / 修正
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3 │ Model Plan 生成                                   │
│  · 部件语义树 (component tree)                                │
│  · 参数化 body/shell/button/stick/grip 描述                  │
│  · 尺寸约束 + 材质分配                                        │
│  · 输出符合 model-plan.schema.json                           │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4 │ compile-plan-to-sketchup-dsl.mjs                  │
│  · 将 model plan 编译为 SketchUp MCP JSON DSL                │
│  · 使用 component_definition/instance 复用重复部件              │
│  · 生成 scene (front/top/side/hero)                          │
│  · 分辨率控制 (resolution_hint)                               │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 5 │ 端到端验证 + QA 回路                               │
│  · 跑通 mock validation                                     │
│  · 真实 SketchUp queue 构建                                   │
│  · snapshot 质量摘要 (group/face/edge count, bbox, 体积)       │
│  · warning 分类 (预期接触 vs 真实碰撞 vs 退化面)                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 6 │ 文档 + 技术预览收口                                │
│  · 更新主 README 链接                                         │
│  · 写技术发布文章                                              │
│  · 新增 golden example (image-structured-modeler 专用)        │
└─────────────────────────────────────────────────────────────┘
```

---

以下 Sprint 0-3 是 2026-05-11 初始计划，保留用于追踪当时的目标和取舍；2026-05-25 之后的实际执行以“当前执行计划”为准。

## Sprint 0 (Day 1-2): 快速原型验证

> 在正式 Sprint 1 前，快速验证调研发现的关键技术点，降低 Sprint 2 风险。

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| P.1 Clone & 跑通 Free2CAD | 提取几何约束检测（对称轴、平行边、同心圆）思路 | 能跑通 demo，输出约束检测流程笔记 |
| P.2 读 Img2CAD 论文 Section 3 | 提取 VLM 辅助条件分解架构 | 写 1 页笔记，明确哪些模块可直接复用 |
| P.3 验证混合策略可行性 | 用 Switch 手柄照片，测试"传统 CV 轮廓 + VLM 语义判断"组合 | 输出可行性报告：精度/延迟/成本 |

**Sprint 0 产出：**
- `docs/research-notes.md` — Free2CAD + Img2CAD 技术笔记
- `docs/feasibility-report.md` — 混合策略验证报告
- 更新后的技术选型决策

---

## Sprint 1 (Week 1-2): 基础设施 + 图像分析管线

### Week 1: Schema & Tooling + 调研落地

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 1.1 完善 schema | 补全 image-observation.schema.json 字段；参考 PartNet 递归树结构设计 component tree | 通过 AJV 校验 |
| 1.2 补全 model-plan.schema.json | 增加 product 相关 primitive 定义；参考 CSGNet 的 CSG-like 中间表示 | 覆盖 rounded_box, beveled_panel, button_on_panel |
| 1.3 搭建 test harness | 在子项目内建 `npm test` | 能跑 schema validation + golden example diff |
| 1.4 目录结构 | 建 scripts/, examples/, test/ 目录 | `tree` 输出与 PLAN 一致 |
| 1.5 技术选型确定 | 基于 Sprint 0 验证，确定 CV 库 + VLM API + 检测框架 | 写 `docs/tech-stack.md` |

### Week 2: analyze-image-set.mjs（混合策略）

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 2.1 视角分类 | 基于 EXIF + 视觉特征判断 front/side/top/back/oblique | 对 Switch 手柄 6 张图分类正确 ≥4/6 |
| 2.2 轮廓提取 | 用 OpenCV / Canvas 找主轮廓、对称轴 | 输出轮廓坐标数组 |
| 2.3 **VLM 部件语义判断** | 用多模态大模型辅助判断"这是外壳/按钮/摇杆"；与传统 CV 结果融合 | 部件类型判断准确率 ≥70% |
| 2.4 质量报告 | 生成 JSON 质量报告 | 包含 views_detected, missing_views, risk_notes |
| 2.5 示例数据 | 补全 examples/switch-controller/observations.json | 与 schema 一致，基于真实手柄照片 |

**Sprint 1 产出：**
- `schema/*.json` 稳定版
- `scripts/analyze-image-set.mjs` 初版
- `examples/switch-controller/observations.json`
- `npm test` 通过

---

## Sprint 2 (Week 3-4): Overlay + Model Plan

### Week 3: make-review-overlay.mjs（参考 Free2CAD 约束检测）

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 3.1 透视校正 | 基于对称轴 + 长直边做局部透视反推 | 生成近似正交 overlay PNG |
| 3.2 **几何约束检测** | 检测对称轴、平行边、同心圆、等距线；参考 Free2CAD 的 stroke grouping → feature 流程 | 约束检测结果在 overlay 上高亮显示 |
| 3.3 部件标注 | 在 overlay 上画 bounding box + label | SVG 可交互，或 PNG 带图例 |
| 3.4 关键点标注 | 按钮中心、摇杆中心、螺丝位置 | 坐标精度 ±5px 以内 |
| 3.5 不确定区域 | 低置信度区域标红 + 标注原因 | 用户一眼看到风险点 |

### Week 4: Model Plan 生成（参考 PartNet 递归树 + 约束传播）

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 4.1 部件语义树 | 从 observations 生成 component tree；参考 PartNet 递归分解设计 | 覆盖 Switch 手柄所有可见部件 |
| 4.2 参数推断 + **约束传播** | 根据轮廓 + 已知尺寸推断厚度、半径、间距；参考 Free2CAD 约束传播：已知总宽自动推按钮间距 | 误差 < 10% |
| 4.3 材质映射 | 将颜色/材质描述映射到 SketchUp material | 输出 material 字段符合 SketchUp MCP 材质名 |
| 4.4 完整示例 | 补全 examples/switch-controller/model-plan.json | 通过 schema 校验，可直接进 Phase 4 |

**Sprint 2 产出：**
- `scripts/make-review-overlay.mjs`
- `scripts/generate-model-plan.mjs` (或合并到 analyze)
- `examples/switch-controller/model-plan.json` 完整版
- review overlay 样例图片

---

## Sprint 3 (Week 5-6): DSL 编译 + 验证 + 发布

### Week 5: compile-plan-to-sketchup-dsl.mjs

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 5.1 Primitive 映射 | model-plan primitive → SketchUp DSL command | rounded_box, beveled_panel, button_on_panel 可用 |
| 5.2 组件复用 | 自动识别重复部件 → component_definition/instance | 同类型按钮/螺丝复用，group count 合理 |
| 5.3 Scene 生成 | 自动建 front/top/side/hero scene | camera 角度正确，bounding box 可见 |
| 5.4 完整输出 | 补全 examples/switch-controller/output.json | `npm test` 校验通过 |

### Week 6: 端到端验证 + 发布

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 6.1 Mock validation | 跑通 mock snapshot + warning summary | 0 个非预期 warning |
| 6.2 真实 SketchUp | queue runtime 构建 .skp | group/face/edge count 合理，文件 < 15MB |
| 6.3 Warning 分类 | 改进 snapshot warning 输出 | 区分预期接触/真实碰撞/退化面 |
| 6.4 回归测试 | 跑 golden-architecture + golden-product | `npm test` 全绿 |
| 6.5 文档发布 | 更新 README、写技术文章、链接到主项目 | 主 README "下一步" 标记为 done |

**Sprint 3 产出：**
- `scripts/compile-plan-to-sketchup-dsl.mjs`
- `examples/switch-controller/output.json`
- 真实 `.skp` 文件
- 技术发布文章草稿

---

## 相关项目借鉴清单

| 项目 | 领域 | 可借鉴内容 | 借鉴阶段 |
|------|------|-----------|---------|
| **Free2CAD** (SIGGRAPH 2022) | 手绘→CAD | 几何约束检测、约束传播、笔画分组→特征 | Sprint 2 Week 3-4 |
| **Img2CAD** (ECCV 2024) | 照片→参数化CAD | VLM 辅助条件分解、"识别→分解→参数化"架构 | Sprint 1 Week 2 |
| **CSGNet** (CVPR 2018) | 图像→CSG程序 | CSG-like 中间表示、程序化可解释性 | Sprint 1 Week 1 (schema) |
| **PartNet** (CVPR 2019) | 3D 部件分解 | 递归部件树数据结构 | Sprint 2 Week 4 |
| **DeepCAD** (ICCV 2021) | CAD 命令序列 | 命令序列规范、180k 数据集先验 | Sprint 3 Week 5 |
| **PrimitivesFittingLib** | 点云基本体拟合 | RANSAC 分割、plane/sphere/cylinder/cone | 后续扩展（如需点云） |

## 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 图像分析精度不够 | Phase 1-2 产出差 | **混合策略**：传统 CV 负责几何，VLM 负责语义；先做半自动 |
| VLM 成本高/延迟大 | 实时性差 | 规则兜底：VLM 只用于部件类型判断，几何计算仍用传统 CV |
| Free2CAD 约束检测难以迁移 | Sprint 2 延期 | Sprint 0 先验证；若不行改用规则-based 约束检测 |
| SketchUp DSL 新 feature operation 覆盖仍有限 | Phase 4/阶段 7 阻塞 | 主线 `cut_*` / `add_*` 第一刀和 CAD boolean/manifold 已可用，子项目 compact remote 已接入真实映射；复杂曲面、文字贴合和更多产品样例复验仍显式保留为后续风险 |
| 文件体积过大 | 产品模型 > 20MB | 强制 component 复用 + resolution_hint |
| 时间不够 | 正式发布延期 | 保持技术预览口径，先完成真实特征编辑和图像侧语义融合，再扩样例 |

## 关键原则（不变）

1. **先结构，后几何** — 不直接出 mesh
2. **先 overlay，后 3D** — 必须有人工确认环节
3. **点云只做参考** — 不作为最终输出
4. **每个部件有来源证据** — 不确定标红
5. **SketchUp 输出可编辑** — component + 命名完整

## 当前状态

- [x] README.md
- [x] schema/model-plan.schema.json (初版)
- [x] schema/image-observation.schema.json (初版)
- [x] examples/switch-controller/model-plan.example.json (示例)
- [x] scripts/analyze-image-set.mjs (CV baseline)
- [x] scripts/make-review-overlay.mjs (PNG overlay baseline)
- [x] scripts/make-review-report.mjs (HTML review baseline)
- [x] examples/switch-controller/manual-corrections.json (manual correction baseline)
- [x] examples/switch-controller/manual-corrections.regression.json (correction-driven regression)
- [x] examples/compact-remote/* (second product generalization sample)
- [x] scripts/compile-plan-to-sketchup-dsl.mjs (existing DSL approximation)
- [x] examples/switch-controller/observations.json (Switch baseline)
- [x] examples/switch-controller/model-plan.json (半自动 baseline)
- [x] examples/switch-controller/output.json (mock-buildable baseline)
- [x] output/image-structured-switch-controller.skp (queue runtime baseline)
- [x] test harness (schema validation + correction regression + dual-sample output mock build + review report)

---

*计划创建于 2026-05-11。2026-05-27 已复盘并调整为技术预览收口；当前 semantic fusion、交互式 corrections 工作台和主线 CAD boolean/manifold 已完成，下次 review：更多产品样例复验后。*
