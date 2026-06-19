# Image Structured Modeler Memo

更新时间：2026-06-17

## 当前结论

子项目已经从“方向和 schema”推进到“Switch 手柄示例闭环 baseline + 第二产品泛化样例 + 统一图片 intake fail-closed 入口”。当前不能再把上传图片直接塞给某个样例脚本或凭空文字 prompt；所有新图片必须先落到 `AssetSet -> ObservationSet / VisionEvidenceSet -> CandidateGraph -> ModelingBrief -> Review/Promotion`，再决定是否生成可编译 PartGraph。

本轮建筑单体问题确认了一个发布级底线：图片结构化能力是项目核心，不是可选前处理。MCP 需要高质量、可解释、带证据状态的文本/结构化 brief；如果输入只有图片，系统必须先说明看到了什么、缺什么、哪些只是候选、哪些被 gate 阻断，而不是直接产出看似完整的 SketchUp 几何。

2026-06-16/17 已完成的修正：

- `image-structured:intake` 新增统一上传入口，默认输出 `intake-summary.json`、`asset-set.json`、`observations.json`、`candidate-graph.json`、`modeling-brief.json`、`mcp-modeling-brief.json`、`mcp-modeling-brief.md`、`candidate-promotion-review.draft.json`、`candidate-promotion-patch.blocked.json`、`review/index.html` 和 review overlays；`intake-summary.json` 是产品/API/队列/CI 的稳定机器摘要，记录 `ok`、profile、compile gate、source-package gate、release draft 状态和关键 artifact 路径；产品/API 推荐先走 `image-structured:real-world-building-upload-session`，一次命令串起 preflight、自动生成/显式传入的 view hints、intake、source gate、MCP brief、source request、source-request response、upload manifest template、可选 release draft/checklist/work-order、review workbench 和 `workflow`，并写 `upload-session-summary.json` / `.md`；`workflow.stage` 现在会稳定区分需要补素材、上一轮补素材仍失败、输入包已可继续 release artifact/人工 review 工作等阶段，并直接给出 refill upload-session、source-package 复评、prepare release sample、validate draft 和 release gate 命令；`workflow.release_work_order` 会指向 `release-work-order.json`，把 source assets、PartGraph、compiled output、PhotoGradeReadiness、human review、draft validation 和 formal manifest promotion 拆成机器任务；`upload-session-handoff.json/md` 会把这些阶段收敛成产品/API/MCP 可直接消费的 primary action、权威 artifact 列表和 release checklist required/failed/review required 摘要，避免真实上传包流程重新落回人工读多文件；未显式传 `--view-hints-file` 时，upload-session 会把 preflight 从文件名、上传包 `view-hints.json` / `manifest.json` / `upload-manifest.json`、CAD 默认视图里识别到的 front/side/oblique/top 标签写成 `view-hints.generated.json` 再交给 intake；上传包 metadata 也可声明 `dimensions` / `known_dimensions` / `scale_hints` / `scale_anchors`，并作为 review-gated scale evidence 进入 preflight `scale_package`、ObservationSet `scale_calibration`、source-package 和 MCP brief；preflight 和 AssetSet 会记录 `content_sha256`，同一文件内容复制成多个 view label 时会触发 `duplicate_source_assets`，阻断 `release_source_candidate` 和 source input gate；upload manifest 的 `views[].source_image` 和 `scale_anchors[].source_image` 必须引用上传包真实源文件，缺失引用会记录为 `invalid_contract` 并阻止贡献 view/scale hints；upload-session summary 会稳定记录 `preflight.metadata_files`，坏 metadata 会记录 `invalid_json` / `invalid_contract`，preflight 顶层状态为 `blocked_source_metadata`，触发 `invalid_source_metadata`，并且不会贡献 view/scale hints；上传包也可单独走 `image-structured:preflight-real-world-building-source-package`，在 intake 前输出 `real_world_building_source_package_preflight` JSON/Markdown，区分 `can_start_structured_intake` 和 `release_source_candidate`，检查媒体类型、生成/截图/脚手架路径标记、内容 hash 去重、视角标签、metadata 引用存在性和尺度线索；显式加 `--real-world-building-release-draft` 时会额外生成 fail-closed 的 `real-world-building-release/manifest.draft.json`、`manifest-contract-summary.json`、`release-checklist.json`、`release-checklist.md`、`release-work-order.json` 和 `release-work-order.md`，并在 review workbench 与 upload-session summary/handoff 的 release 状态块暴露，且直接给出 `checklist_required_check_ids`、`checklist_failed_required_check_ids`、`checklist_review_required_check_ids`；MCP brief 现在直接带 `source_package_gate`、`source_request`、scale strategy、source metadata scale hints、`agent_contract` 和 `modeling_constraint_summary`，让 MCP 能看到真实建筑输入包 readiness、blockers、next actions、需要补充哪些用户素材、唯一权威 artifact、允许输出、被阻断输出、证据规则、必需确认项、几何边界和按 role 去重的建模禁令；建筑类 intake 会额外落盘 `real-world-building-source-request.json/md` 和 `upload-manifest.template.json`，review workbench 暴露下载链接并嵌入 source-request JSON；按上一轮 source request 补交素材时，下一轮 upload-session 传 `--source-request-file` 会落盘 `source-request-response.json/md`，并在 summary 的 `source_request_response`、`artifacts.source_request_response` 和 `gates.source_request_response_ok` 中说明本次上传是否满足上一轮请求；上传/API/CI 可直接在 intake 上加 `--require-source-input-ready` 或 `--require-source-release-ready`，不满足时返回非零退出并写 `real-world-building-source-package.gate-result.json`，同时 `intake-summary.json` 保留失败语义和 gate artifact 路径；`image-structured:export-mcp-brief` 可从既有 intake 产物重建 MCP/建模 agent brief 或改写输出位置，并会自动重读 `real-world-building-source-package.json`。
- `upload-session-handoff.json/md` 现在会直接暴露 `primary_action.artifact_exists`、每个 authoritative artifact 的 `exists` 状态、`semantic_evidence_quality`、`vision_evidence.semantic_evidence_instances` 和 `vision_evidence.modeling_handoff`；产品/API/MCP 可以单读 handoff 判断当前动作指向的是已生成的 source request、manifest/checklist/work-order，还是下一步需要生成的 release artifact workspace，同时看到凹进立面、风管/方管、阴影边界等语义证据是否仍是 weak/review-required 且 `geometry_promotion_allowed=false`，以及每类候选的 bbox、source image、建模决策和禁止误读。
- `real-world-building-source-request.json/md` 现在直接带 `upload_package_requirements`，把下一轮上传包需要的 manifest 文件名、required view slots、missing required views、scale evidence、forbidden shortcuts 和 `next_upload_response_check_ids` 做成机器可读表单；同时 source request 根节点、`semantic_requirements` 和 `upload_package_requirements.semantic_evidence` 都会暴露同一份 `semantic_evidence_quality`，让产品上传页在显示“可进入 release artifact 工作”时仍能看到 weak/review-required 语义和 `geometry_promotion_allowed=false`。产品上传页不需要再从多个 request 子字段自行拼装补素材要求或语义质量 gate。
- `source-request-response.json/md` 现在会把上一轮 `upload_package_requirements.next_upload_response_check_ids` 回显为 `summary.expected_check_ids`，并暴露 `missing_expected_check_ids` / `unexpected_requested_check_ids`，防止补素材表单和实际验收逻辑分叉；`summary.view_evidence` 会把上一轮缺失视角、本轮 present/missing 状态、`view_source_diversity_status` 和 `requested_view_evidence` 结构化给产品/API/MCP；`summary.semantic_evidence` 会把上一轮缺失语义角色、本轮覆盖角色和仍未满足角色结构化给产品/API/MCP，并把本轮全部语义 role evidence、上一轮实际请求的 `requested_role_evidence` 和 `evidence_quality` 一起输出，避免视角来源、凹进立面、矩形风管/方管、阴影/凹槽边界这类缺口只藏在 check id 字符串或自由文本里；这些字段也同步进入 upload-session summary 和 MCP brief `source_request_response_gate`。
- `image-structured:prepare-real-world-building-source-refill-package` 已补到 source request 后续流程：输入 `real-world-building-source-request.json`，输出 `source-refill-package-guide.json/md`、README、`source-slots.md`、`upload-manifest.template.json` 和专用 `upload-package/` 真实上传目录，由 `schema/real-world-building-source-refill-package-guide.schema.json` 固定。guide 会列出 object type、required source slots、`views[].source_image` distinct 要求、scale evidence、forbidden shortcuts、`build_manifest_from_sources`、`run_source_refill_workflow`、`validate_refill_package` / `require_upload_ready` 和下一轮 `real-world-building-upload-session --source-request-file ... --require-source-input-ready` 命令；它保持 `direct_upload_ready=false` / `template_only=true`，只是补素材包指引，不会被当作真实上传包或 release-positive。新增 `image-structured:build-real-world-building-source-refill-manifest`，在用户把真实文件放进 `upload-package/sources/` 后按 front/left/oblique/top/plan/perspective 等明确文件名关键词生成 `upload-package/manifest.json`；缺视角时只输出 draft/pending，不按文件顺序硬猜。新增 `image-structured:run-real-world-building-source-refill-workflow` 和 `schema/real-world-building-source-refill-workflow-report.schema.json`，把 manifest build、upload-ready validation 和可选 `--run-upload-session` 收敛成单个产品/API report；默认只到 `ready_for_upload_session`，不自动触发 upload-session。新增 `image-structured:validate-real-world-building-source-refill-package` 和 `schema/real-world-building-source-refill-package-validation.schema.json`，在 upload-session 前区分 `template_package_pending`、`ready_for_upload_session` 和 `invalid_refill_package`，并阻断 helper artifact 混入、坏 manifest、manifest `kind` / `object_type` 错配、跨出 upload-package 的 source refs、缺 required views、重复路径和重复文件内容。upload-session workflow/handoff、demo candidate audit 的 `refill_workflow` / `release_preparation_workflow` 和 blocked release artifact workspace commands 会把 `prepare_source_refill_package`、`validate_source_refill_package_require_upload_ready` 和指向专用 `upload-package/` 的 refill upload-session 命令一起暴露给产品/API/MCP，避免补素材链路只靠 README 或自由文本说明。
- Source-package 的视角和语义覆盖现在不再只有 `present_views` / `role_counts`：`view_package.view_evidence` 会按 required view 列出 asset ids、source paths、media types 和 content hashes；`semantic_package.role_evidence` 会按 required role 列出候选 id、视角、source image、置信度范围、`evidence_quality_status`、`quality_flags` 和 `geometry_promotion_allowed=false`；`semantic_package.evidence_quality` 会汇总 missing/weak/review-required roles，明确 role covered 不等于可几何提升。source request、upload-session summary/handoff 的 `semantic_evidence_quality` 与 MCP brief `source_package_gate.view_evidence` / `semantic_role_evidence` / `semantic_evidence_quality` 会同步携带这块 provenance，供产品/API/MCP 直接展示证据来源和 review gate。
- 建筑类 raster image 默认接入 `VisionEvidenceSet v1`：intake/upload-session 会写 `vision-evidence-v1-report.json`、`vision-evidence-review-patch.json/md` 和 `vision-evidence-review/index.html`，并在 summary、handoff、review workbench、MCP `evidence_summary.vision_evidence` 和 `agent_contract.authoritative_artifacts` 中暴露。凹进侧立面、矩形风管/方管、HVAC、窗带、店面、阴影/凹槽边界等以 `semantic_candidate_policy` review item 进入 VisionEvidence review patch，保持 `apply_allowed=false`、`compile_allowed=false`、`geometry_promotion_allowed=false`。
- 未声明画像的图片现在进入 `unknown_object`，不会再静默套 Switch profile；unknown scale 是显式零尺寸、零置信度、review required。
- CandidateGraph 默认 fail-closed：unknown profile、低 scale confidence、review-required grounding、single-view depth ambiguity 等都会进入 promotion blockers。
- no-seed PartGraph skeleton 不再暴露 compileable `shape`；候选占位体进入 `candidate_shape`，并带 `compile.emit=false`。
- 只有 accepted proposal patch 才能把 `shape.parameters` 提升为 compileable `shape`，并写入 `promoted_geometry` / QA metadata。
- PartGraph compiler 对 `promoted_geometry_parts=0` 直接 fail closed。
- intake review workbench 已能导出 `candidate_promotion_review` JSON；该 JSON 不是 SketchUp compile input，只是后续 promotion patch 的审查输入。只要 blocker 未解除，导出结果保持 `verdict=blocked`、`promotion_allowed=false`、`compile_allowed=false`。
- `image-structured:promotion-patch` 已能把 review JSON 转成 `candidate_promotion_patch`。blocked review 只会产出 `actions=[]`、`apply_allowed=false`、`compile_allowed=false` 的 blocked patch，不能修改 PartGraph。
- `image-structured:apply-promotion-patch` 已能把 ready `candidate_promotion_patch` 应用成 PartGraph parts，并保留 `manual_confirmed` evidence、`promoted_geometry`、source candidate provenance 和 `part_graph_review_required` QA；blocked patch 会拒绝应用，不能修改 PartGraph。
- `test/建筑单体` 已用 intake 重跑：2 个 image assets、29 个 candidates、`compile_allowed=false`、`status=review_required`，缺 `scale_confidence_below_publish_gate`、`missing_oblique_view`、`missing_left_view`、`missing_top_view`。候选包括凹进侧立面、矩形风管/方管、HVAC、阴影/凹槽边界等 review-only 语义；默认 `candidate-promotion-review.draft.json` 为 `accepted_candidates=[]`、`held_candidates=29`，promotion patch 为 `actions=[]`。MCP brief 现在会用 `modeling_constraint_summary` 把这些角色去重为建模约束摘要，避免下游只读重复候选表。对这个 blocked patch 运行 apply 会按预期失败：`Candidate promotion patch is not applyable`。输出位置为 `output/image-structured-modeler/building-single-intake-test/`。
- 同一建筑单体 smoke 现在还会产出 VisionEvidence：review patch 中保留 `semantic_candidate:recessed_side_facade_plane`、`semantic_candidate:rectangular_utility_ducts`、`semantic_candidate:shadow_or_recess_boundary` 等项，解决了之前“凹进立面/风管/光影只在自由文本里说，没进入结构化 artifact”的问题。
- PDF/CAD 已接入 `image-structured:intake` 的 AssetSet fail-closed 路径；当前最小 PDF/DXF fixture 会生成完整 AssetSet/ObservationSet/ModelingBrief/PromotionReview/blocked patch，并带 `pdf_extractor_required` / `cad_extractor_required`，不会进入 PartGraph。显式传 `--parse-documents` 时，当前最小 parser 会解析 PDF metadata 和 DXF LWPOLYLINE outline，输出 `document-parse-report.json`、CAD top-view outline、document scale anchor 和 missing-view blockers；这仍是 review evidence，不是可编译许可。
- `image-structured:release-gate` 已新增发布门禁报告，当前覆盖二十一个 hard cases：unknown negative fail-closed、source-package preflight、blocked upload session、generated-view-hints upload session、PDF/CAD AssetSet fail-closed、PDF/CAD parser positive review gate、PDF/CAD parser release matrix、document review patch roundtrip、building-single semantic matrix、建筑单体 blocked demo、MCP modeling brief export、synthetic ready promotion、human review roundtrip、human review UI、accepted positive building-group、real-world Switch product photo、formal manifest write guard、real-world building manifest contract、Rhino factory visual gap guard、demo candidate audit、artifact integrity；demo candidate audit 现在还要求每个候选带 source-request artifact、upload manifest template、blocked `release_stage`、`release_candidate_assessment`、下一轮 refill upload-session 命令，以及 `release_preparation_workflow` 中的 upload-session、release artifact workspace、workspace validation、manifest draft validation 和 guarded formal manifest write 命令；summary 会分开 `best_structure_review_candidate` 与 `best_release_work_candidate`，本地截图/生成图候选必须保持 `release_selectable_candidates=0`。release draft 相关 case 还会验证 `release-work-order.json/md`、`upload-session-handoff.json/md`、`release-artifact-workspace.json/md`、review workbench 嵌入数据和 upload-session workflow 指针，确保真实上传包到 release artifact 工作之间不会再断在人工说明文档。artifact integrity report 由 `schema/release-gate-artifact-integrity-report.schema.json` 固定；artifact integrity 还会检查 workspace 生成/验证脚本、schema、npm scripts、upload-session/handoff command schema、README/PLAN/MEMO 和主 validation 是否同步，防止 release contract 漂移。
- release gate 现在也复验 VisionEvidence 默认接入：blocked upload-session、generated-view-hints、建筑单体 blocked demo、MCP brief export 和 accepted positive building-group case 都必须暴露 VisionEvidence report/review patch/workbench；MCP brief 必须带 `evidence_summary.vision_evidence.available=true`、semantic review roles 和 `vision_evidence_review_patch` authoritative artifact；review decision / policy correction 仍只能更新 evidence metadata，不能打开 direct DSL 或 geometry promotion。
- VisionEvidence review patch 的语义项现在带可定位实例：每个 `semantic_candidate_policy.current_value.evidence_instances[]` 会列出 source id/image、view、`bbox_px`、confidence、backend 和 review-required 状态。release gate 会检查凹进侧立面、矩形风管/方管、阴影/凹槽边界这些关键 item 都带 bbox 证据，避免 review UI/MCP 只拿到角色名和禁令。
- Upload-session handoff 和 release artifact workspace 现在会继续传播这些 `semantic_evidence_instances` 和 MCP brief `modeling_handoff`：handoff 的 `vision_evidence`、workspace 的 `mcp_modeling_handoff.vision_evidence`、每个 `task_packets[].mcp_constraints.vision_evidence` 和 `task_packets[].mcp_authoring_handoff` 都必须带 source image、view、bbox、confidence、建模决策、禁止误读、确认项，以及 VisionEvidence report/review patch/review workbench 路径；task packet acceptance criteria 包含 `use_vision_evidence_instances` / `use_vision_evidence_modeling_handoff`，独立 validator 检查 `vision_evidence_instances_propagated` / `vision_evidence_modeling_handoff_propagated` / `task_packet_mcp_authoring_handoff_present`，避免 artifact authoring 阶段又退回自由文本。
- Upload-session release gate 现在分成两条：`real_world_building_upload_session_fixture` 验证 blocked 输入必须写出 preflight、view hints、intake summary、review workbench、MCP brief、source-package、source-request、upload manifest template 和 gate-result 路径，并保持 `can_generate_sketchup_dsl=false`；summary 的 `intake.source_package` 必须直接暴露 failed requirements、source/view/scale blockers 和 next actions；同一 case 还覆盖 invalid upload manifest，要求 summary 直接暴露 `blocked_source_metadata`、`invalid_contract`、`invalid_source_metadata`，且不得从坏 manifest 写出 `view-hints.generated.json`；release artifact workspace 必须保持 `blocked_needs_source_refill`，其独立 validation report 必须是 `blocked_needs_source_refill_validated` 且无 failed required checks。`real_world_building_source_package_preflight_fixture` 额外覆盖重复源文件和缺失 metadata source reference，要求 `source_content.status=fail`、`duplicate_source_assets` blocker、`views[].source_image` / `scale_anchors[].source_image` 缺失引用报 `invalid_contract`，并保持 `release_source_candidate=false`。`real_world_building_upload_session_generated_view_hints_fixture` 验证未传 `--view-hints-file` 的上传包会从内置 `manifest.json` 自动写出 `view-hints.generated.json`、传给 intake，并解除 front/left/oblique/top missing-view blockers，同时把 manifest known dimensions 写入 observations/source-package/MCP brief 的 scale evidence；该正向 fixture 必须使用不同 `content_sha256` 的有效图片，不能靠同图复制通过。该 case 还会把 blocked fixture 的 `real-world-building-source-request.json` 作为 `--source-request-file` 传入，要求写出 `source-request-response.json/md`，summary 暴露 `source_request_response.status=satisfied_for_release_work`、`gates.source_request_response_ok=true` 和 source-request-response artifact。该 case 同时要求 source input gate 通过并写出 gate-result artifact、summary 中没有 source-package failed requirements、`source_request_status=input_ready_for_release_work`、source-request artifact 和 upload manifest template artifact；也会请求 release draft，要求 upload-session summary 直接暴露 manifest/checklist/work-order artifact、parsed metadata status、`manifest_invalid_release_gap_recorded`、release draft blockers、checklist check statuses、workspace 命令和 `release-artifact-workspace.json/md`，workspace 状态为 `ready_for_artifact_authoring` 且列出 PartGraph、compiled output、PhotoGradeReadiness 三类缺失 artifact；workspace 的 `mcp_modeling_handoff` 还必须保留 `direct_sketchup_dsl` 阻断、VisionEvidence review patch/semantic roles 和 `merged_front_facade_plane`、`decorative_facade_trim`、`cut_recess_from_shadow_only` 等候选误读拦截；workspace 的 `task_packets` 还要为三类 artifact 暴露权威输入、`mcp_authoring_handoff` prompt/digest、验收条件、完成证据、验证命令、继承的 MCP 禁令和 `use_vision_evidence_review_patch` 验收项，独立 validator 必须输出 `ready_to_author_validated`，避免 release artifact 阶段靠自由文本交接；但仍不得生成 SketchUp DSL 或声称 release-ready。
- Source-package preflight / upload-session / source-request 新增 `view_source_diversity` / `view_source_requirements`：同一路径被 manifest 标成多个 required view 会触发 `view_sources_not_distinct`，即使标签层面的 `missing_hinted_views=[]` 也不得成为 `release_source_candidate`；upload-session 不得把这类冲突标签写成 `view-hints.generated.json`。`real-world-building-source-request.json`、`upload-manifest.template.json` 和 `examples/real-world-building-positive/upload-manifest.example.json` 会明确 required views 必须引用不同 `views[].source_image`。release gate 的 `real_world_building_source_package_preflight_fixture` 和 `real_world_building_upload_session_fixture` 已覆盖该负例，并要求 summary/report 在 `view_source_diversity` 暴露复用路径和视角。
- Source-request response 现在会把上一轮 `view_source_requirements` 单独验收到 `view_source_diversity` check：upload-session 会把当前 preflight report 传入 response builder，`source-request-response.json/md` 直接说明 required views 是否使用了不同 `source_image` 路径，而不是只靠最终 `input_ready_for_release_work` 间接表达。response artifact 和 upload-session summary 会暴露 `requested_check_ids`、`satisfied_check_ids`、`unsatisfied_check_ids` 和 `unsatisfied_check_details`，让产品/API/MCP 可以直接展示失败项。补交轮次还会把 response gate 回写进 `mcp-modeling-brief.json/md` 的 `source_request_response_gate`，并同步重写 review workbench 的内嵌 `mcp-modeling-brief-data` 和可见 MCP Brief 区块；失败时 `compile_permission.reasons` / `agent_contract.output_policy.blockers` 包含 `source_request_response_failed`，required confirmations 会列出需要解决的 failed response checks。release gate 还覆盖了错误补交负例：上一轮 source request 存在时，若新 manifest 仍把同一张图标成 front/left/oblique/top，summary 必须 `gates.source_request_response_ok=false`，response artifact、MCP brief 和 review workbench 必须记录 `view_source_diversity` requested/failed/current_status=`fail`。
- MCP brief 新增 `grounding_risk_register` 和 `candidate_disambiguation`：在 `agent_contract` 的长文规则之外，用稳定风险 ID 暴露 direct DSL 阻断、source authenticity、missing view、scale、release readiness、凹进立面 separate-plane、矩形方管/风管语义、阴影/凹槽歧义等风险；`candidate_disambiguation` 会逐候选输出 allowed semantics、blocked interpretations、required confirmations 和 handoff text，固定拦截“凹进立面并入正立面”、“方管/风管当装饰线”、“阴影直接转凹槽几何”等误读。主 validation 和 release gate 已要求 blocked 建筑单体 brief 同时保留这些风险 ID 和逐候选歧义表；generated-view-hints 正向上传包会清掉 missing-view/scale 风险，但仍保留 direct DSL、release checklist 和候选歧义信息。MCP brief source-package gate 和 agent_contract.output_policy 现在直接暴露 release checklist required/failed/review required ids，避免 MCP/建模 agent 只看到泛化 release blocker。
- MCP brief 同时新增 `evidence_summary.vision_evidence`：它把 VisionEvidence availability、review_required、semantic review roles、top-view/ground-plane policy、`default_heavy_model_required=false`、review patch artifact、`semantic_evidence_instances` 和 `modeling_handoff` 交给 MCP；Markdown 会列出 role、view、source id、bbox、confidence，以及每个角色的建模决策、禁止误读和确认项，使 MCP 的文本输入来自结构化图片证据，而不是自由口述。
- 图片分析新增 `auto_screenshot_chrome_v1` content frame：主 bbox / component candidate 生成前会检测大块近黑截图面板、黑边和 screenshot chrome，并在 ObservationSet 写入 `image.content_frame`、`metrics.content_frame_bbox`、raw/effective edge counts 与 `auto_content_frame` helper observation；review overlay 会画出该 frame。`test/建筑单体` 原始截图下半部黑面板现在会被排除，手工裁剪图不会被二次裁剪。该能力只解决截图 UI 污染，不关闭 shadow-aware classifier 或 facade plane segmentation 缺口。
- 上传 manifest contract 已固化为 `schema/real-world-building-upload-manifest.schema.json`，示例为 `examples/real-world-building-positive/upload-manifest.example.json`；它只服务 upload/intake 阶段，用来声明普通文件名照片的 view labels、known dimensions 和 scale anchors，不是最终 `examples/real-world-building-positive/manifest.json` release manifest。主 validation 会校验示例、动态生成的 upload manifest fixture、缺失 source reference 负例、`upload-manifest.template.json`，以及 invalid/template-only manifest 不得贡献 view/scale hints 的回归；template 原样改名为 `manifest.json` 或 manifest 引用不存在的源文件，都会被 preflight 作为 `invalid_contract` 拒绝。
- Release gate 仍保持克制：最新 `output/image-structured-modeler/release-gate/release-gate-report.json` 为 `ok=true`、`release_ready=false`、`verdict=technical_baseline`，并显式列出 `real_world_building_positive_release_sample_missing`；旧的 `real_world_positive_release_sample_missing`、`building_single_semantic_release_matrix_missing`、`pdf_cad_parser_release_matrix_missing` 和 `human_review_ui_release_matrix_missing` 已移除。

当前结论需要保持克制：这次修复解决了错误直通和默认模板污染的问题，补上了产品入口、候选确认草稿、blocked/ready promotion patch、PartGraph 应用脚本和发布门禁，并把真实产品图片样本纳入自动回归；但这不等于建筑单体语义识别已经发布级。建筑单体要发布，还需要真实建筑正向样本证明人工确认或多视角证据解除 blockers 后能稳定进入 PartGraph、通过 compiler/QA，并继续补强空调外机、阳台/雨棚、门窗 rhythm、光影误导排除等候选语义。

- 建筑单体 blocked demo 的 release-positive 准备出口已锁进 release gate：`building_single_blocked_demo` 现在必须从 intake 写出 `real-world-building-release/manifest.draft.json`、`manifest-contract-summary.json`、`release-checklist.json`、`release-work-order.json/md` 和 review workbench 链接；在真实 source assets、release artifacts、PhotoGradeReadiness、VisionEvidence accepted review decision / policy correction patch 和人工验收未齐之前，该 bundle 必须保持 fail-closed，work-order 状态保持 `blocked_needs_source_assets`，不能关闭 `real_world_building_positive_release_sample_missing`。
- 真实建筑 release manifest 验证已补 PartGraph source provenance alignment 和 VisionEvidence policy-review gate：正式 manifest 通过前，验证器会递归收集 PartGraph evidence 里的 `source_image/source_images`，要求它们全部出现在 `manifest.source_images`，并要求 manifest artifacts 同时包含 VisionEvidence report、review patch、accepted review decision 和 policy correction patch；这些 VisionEvidence artifact 必须保持 `compile_allowed=false`、`geometry_promotion_allowed=false`，并在 summary/metrics 写入 `source_images_align_with_part_graph=true` 和 `vision_evidence_review=pass`。主 validation 增加了对齐通过、漏列源图失败和 release draft VisionEvidence blocker 回归。当前状态仍是 `technical_baseline`，正式真实建筑正样本缺失。
- Release artifact workspace 已补 `review_requirements` 和 release checklist 摘要：`task_packets` 继续只覆盖 MCP/建模侧 PartGraph、compiled output、PhotoGradeReadiness 三类产物；`review_requirements` 覆盖 `vision_evidence_review`、human review、draft validation 和 formal promotion，并直接列出 VisionEvidence report、review patch、accepted decision、policy correction patch 的路径和存在状态。upload-session handoff、workspace 根节点、source-package release package、MCP brief `source_package_gate`、`agent_contract.output_policy`、workspace `mcp_modeling_handoff`、每个 `task_packets[].mcp_constraints` 和 `task_packets[].mcp_authoring_handoff` 现在都暴露 `release_checklist_required_check_ids`、`release_checklist_failed_required_check_ids`、`release_checklist_review_required_check_ids` 或对应 digest。独立 validator 现在检查 review requirements 覆盖 work-order review tasks、VisionEvidence review requirement 暴露四个 artifact role、release checklist required 摘要完整、release checklist 摘要传播到 MCP handoff/task packets、MCP authoring handoff 覆盖，以及 release_ready 不能在 review requirements 未 pass 时为 true。
- Upload-session handoff 和 release artifact workspace 现在都继承语义证据质量合同和 VisionEvidence handoff：`upload-session-handoff.semantic_evidence_quality`、`upload-session-handoff.vision_evidence`、`mcp_modeling_handoff.semantic_evidence_quality` 和每个 `task_packets[].mcp_constraints.semantic_evidence_quality` 会保留 weak/review-required 状态、review roles、risk flags、bbox/source provenance、候选建模决策、blocked interpretations 和 `geometry_promotion_allowed=false`；task packet acceptance criteria 新增 `preserve_semantic_evidence_quality`，独立 validator 新增 `semantic_evidence_quality_propagated`。这把“凹进立面/方管风管/阴影边界只是弱候选或 review-only 候选”从 upload-session/MCP brief 继续带到 PartGraph、compiled output、PhotoGradeReadiness authoring 阶段，避免 handoff 或 release artifact workspace 被当作可直接几何提升的自由文本说明。
- VisionEvidence policy review 的命令级交接已补齐：upload-session workflow、handoff commands、release artifact workspace commands 和 `review_requirements[].command` 都会暴露 `make-vision-evidence-review-workbench.mjs` / `build-vision-evidence-policy-correction-patch.mjs` 路径，要求先有人审导出 `vision-evidence-review.accepted.json`，再生成 `vision-evidence-policy-correction-patch.json/md` 和 `vision-evidence-v1.reviewed.json`；workspace validator 现在会硬检查这些命令包含 review patch、accepted decision、policy patch、VisionEvidence report 和 reviewed set 参数。该命令仍保持 evidence-policy-only，不打开 compile 或 geometry promotion。
- Release work-order 现在也带 `artifact_authoring_policy`：直接 SketchUp DSL authoring 必须为 false，几何提升必须经过 review，语义证据质量的权威来源固定为 source request、MCP brief 或 release artifact workspace。work-order 只列任务，不允许下游把任务名、自由文本说明或 checklist 缺口误用成 PartGraph 几何证据。
- Release work-order schema 已加条件校验：当 task id 为 `vision_evidence_review` 时，schema 要求 `command` 为非空字符串，并要求 `artifacts` 同时包含 `vision_evidence_report`、`vision_evidence_review_patch`、`vision_evidence_review_decision`、`vision_evidence_policy_correction_patch`。主 validation 和 release gate 也断言 generated-view-hints work-order 暴露 review decision / policy correction artifact role 与 policy correction command。
- Release checklist schema 已加 required-check 覆盖校验：`checks` 必须包含 required 的 `source_assets`、`source_authenticity`、`artifacts`、`photo_grade_readiness`、`vision_evidence_review` 和 `human_review`。主 validation 现在有缺 `vision_evidence_review` checklist 的负例，release gate generated-view-hints case 也会暴露 `release_checklist_required_check_ids`；artifact integrity 的 release contract drift checks 会反查 checklist schema、主验证负例和文档描述，防止 required-check contract 静默脱钩。
- 真实建筑 release checklist 也会对 `manifest.source_images` 做内容 hash 去重：重复源文件会在 source_assets check 里标成 `duplicate_content_blocker`，并让正式 manifest validator 报错，防止绕过上传入口直接手写重复源图 manifest。
- 真实建筑 source-package 评估已补到上传入口：`image-structured:intake` 对建筑类 profile 会写 `real-world-building-source-package.json/md`、`real-world-building-source-request.json/md` 和 `upload-manifest.template.json`，review workbench 暴露下载链接并嵌入 `real-world-building-source-package-data` / `real-world-building-source-request-data`；报告现在包含 `source_request`，用于机器可读地说明需要替换哪些源素材、缺哪些视角、需要什么尺度证据、允许哪些 image/PDF/CAD 类型，以及满足前禁止哪些输出；`image-structured:audit-real-world-building-candidates` 会汇总 `source_package_status`、`input_ready_for_release_work`、`input_ready_source_packages`、`release_stage`、`release_candidate_assessment`、source-request artifact、upload manifest template、可直接复用的 `refill_workflow` upload-session 命令和 `release_preparation_workflow`。`best_structure_review_candidate` 只代表结构审查素材，`best_release_work_candidate` 只有真实源图包过 source gate 后才会出现；当前本地建筑单体与 canonical crop 都保持 `blocked_source_assets`、`release_selectable_candidates=0`，可做结构化审查 demo，但不是 release input package；新 demo 素材应沿同一条 upload-session -> release workspace -> manifest draft -> guarded formal manifest 流程推进。
- Source-request response 已补到上传入口：`source_request` 不是静态说明文，而是下一轮上传的验收合同。补素材后传 `--source-request-file output/.../real-world-building-source-request.json`，系统会对比上一轮缺失的 source assets、视角、尺度证据和语义角色，输出 `not_satisfied` / `partially_satisfied` / `satisfied_for_release_work` / `release_ready`。其中 `satisfied_for_release_work` 只说明输入包可进入人工 review/建模工作，不代表可写正式 release manifest。
- Source-package 当前有正向与假阳性双向回归：完整四视角、非生成源图、尺度过线、语义角色齐全时会得到 `input_ready_for_release_work=true`；但只要 source gate 失败，即使 checklist 被误填为 ready，`release_ready` 仍必须为 false。
- Source-package 已有独立复评 CLI：`npm run image-structured:assess-real-world-building-source-package -- --intake-dir output/...` 会从已有 intake 目录重读 AssetSet/ObservationSet/CandidateGraph/可选 release checklist 并重写 JSON/Markdown；默认模式用于审计复评，不因 blocked source-package 返回失败；上传/CI 流程可加 `--require-input-ready`，正式发布验收可加 `--require-release-ready`，让不满足门禁的输入包返回非零退出并在 stdout 暴露 `failed_requirements`。硬门禁模式会自动写 `*.gate-result.json`，由 `schema/real-world-building-source-package-gate-result.schema.json` 固定 `ok`、`required_gates`、`failed_requirements` 和 source-package artifact 路径，产品上传/API/CI 不需要只依赖 stdout。release gate 会对 `building-single-blocked` 产物生成 `real-world-building-source-package.revalidated.json/md`，并额外验证 require-input-ready 模式必须失败且写出 gate-result artifact，防止该能力只停留在 intake 副产物里。

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
- R7/R10 建筑群当前边界：`image-structured:build-building-group` 会读取 `test/建筑群/` 的 3 张 GPT Image 合成航拍图，使用 `building_group` observation profile 和 `building_group_industrial_campus` ProductProfile，生成 `observations.json`、review overlays、`part-graph.massing.json` 和 `output.massing.json`。scale calibration 使用停车位、车道和人行横道 known-element anchors，估算厂区约 `130m x 98m`；所有 massing shape proposal 仍是 `review_required: true`。`image-structured:qa-building-group` 和 `image-structured:qa-building-group:queue` 已分别生成 mock/live layout/reference QA 报告并通过，queue 版保存 `output/image-structured-building-group-massing.skp`。建筑细节已保留主厂房 accepted subset 回归，并新增 R7 final accepted-all fixture：`image-structured:proposal-review-chain-building-group-all` / `:queue` 会接受 5 个当前 roofline/facade/opening detail proposal target，生成 `part-graph.r7-final.json`、`output.r7-final.json`、`proposal-qa-r7-final/*` 和 `proposal-qa-r7-final-queue/*`，通过 mock/live queue compile/layout/feature Reference Visual QA/physical QA，并保存 `output/image-structured-building-group-r7-final.skp`。R9 Grounding v3 已覆盖 ScaleAnchorGraph、GroundPlan、line/grid、TopViewOverlay 和 promotion decisions；R9.5 PhotoGradeReadiness 进一步输出三个 `photo-grade-readiness-report.json`：building-group candidate 与 second sample 当前为 `technical_baseline`，real-photo smoke scaffold 为 `review_required`。R10 AutoGroundPlan 已新增 `structured-plan/structured-plan-qa-report.json`、`structured-plan/index.html` 和 `part-graph.r10-groundplan.json`：当前 structured hard gates 为 road/building overlap 0、raw contour leakage 0、parent/child double occupancy 0、canonical overlap 0；`internal_roads`、raw `parking_lot` contour 和 `warehouse_row_*` parent occupancy 只保留为 diagnostic/rejected evidence，不进入 R10 structured output。gap ratio 仍为 0.543，因此这是当前 GPT Image 建筑群样例的 technical baseline，不是测绘级建筑重建。
- R11 BirdEyeLandCover 已把鸟瞰图作为独立 land-cover 品类处理：默认使用 local classical CV，不依赖 VLM/SAM，先输出 building exclusion、paved surface、road/parking surface candidates、road/parking markings、vegetation、bare soil、shadow/unknown，再交给 AutoGroundPlan。当前 building-group `land-cover-v1-report.json` 为 pass：unknown land-cover ratio 0.013，paved surface ratio 0.195，vegetation ratio 0.207，boundary confidence 0.791；`structured-plan/bird-eye-segmentation.png` 提供 original / raw land-cover mask / source edge overlay / final planar subdivision 四联 QA 图，`structured-plan/site-boundary-check.png` 单独显示 site boundary overlay。R11.1 已修正为 source-image edge-first：AutoGroundPlan site surface 优先来自 source boundary graph，当前 bbox 为 `[81,31,738,558]`。R11.2 已纠偏为真实 OpenCV backend + JS fallback：`opencv-edge-v1-report.json` 当前使用 `backend=opencv_clahe_canny_hough_lsd_v1`、`opencv_version=4.13.0`，accepted edges 112、rejected edges 148、site perimeter confidence 0.778、road boundary confidence 0.727、building outline confidence 0.848、roof seam rejection count 77；`edge-v1-report.json` 仍保留 HighContrastEdge fallback，accepted edges 86、rejected edges 134。`boundary-graph-v1-report.json` 当前融合 source-image、OpenCV 和 HighContrastEdge，OpenCV boundary edge count 112，road corridor count 7；`boundary-groundplan-ablation-report.json` 显示 fused path `fused_opencv_boundary_edges=112`、`fused_high_contrast_boundary_edges=86`、remaining unknown gap 0.198。`segmentation-backend-compare-report.json` 中 INSID3 仍是 optional contract，当前 `insid3_status=skipped_unavailable`，没有 Python/DINOv3/INSID3 环境时不声称实际使用。StructuredPlan QA 仍为 review：gap ratio 0.474、gap completion ratio 0.557、remaining unknown gap ratio 0.198、road candidate review count 0，hard gates 仍为 0 road/building overlap、0 raw contour leakage、0 parent/child double occupancy、0 canonical overlap。最终仍是 review/technical baseline，不是 photo-grade candidate；R11.2 的纠偏成功点是把真实 OpenCV 边线接进结构化链路并保留拒绝原因，而不是强行把 gap 压低。
- R12 已把多条轻量视觉链路收敛到 `VisionEvidenceSet v1`，作为 `Images -> VisionEvidenceSet -> EvidenceGraph -> BoundaryGraph/GroundPlan/VisualRelationGraph -> PartGraph -> DSL -> QA` 的默认证据入口。当前 building-group `structured-plan/vision-evidence-v1-report.json` 为 pass：masks 91、edges 810、accepted edges 528、rejected edges 309、lines 166、keypoints 15、regions 961、scale anchors 5、relations 1384，`planar_groundplan_allowed=true`，top-view ground-plane confidence 0.94，3 张图都有 per-image ground-plane estimate；top 图为 `usage_policy=planar_groundplan_candidate`，两张 oblique 图保持 `review_only_oblique_context` 并带 `oblique_view_not_planar_groundplan` 风险，`default_heavy_model_required=false`。`VisionEvidenceReviewPatch` 第一版已落地，当前生成 `vision-evidence-review-patch.json/md`，状态为 `needs_review`，包含 5 个待确认项：3 个 ground-plane policy、2 个 edge-class policy，并保持 `apply_allowed=false`、`compile_allowed=false`。`VisionEvidenceReviewWorkbench` 第一版已落地，当前生成 `vision-evidence-review/index.html`，release gate 会用 headless Chrome CDP 导出 `vision-evidence-review.browser-exported.json`。`VisionEvidencePolicyCorrectionPatch` 第一版也已落地：review decision 会生成 `vision-evidence-policy-correction-patch.json/md` 和 `vision-evidence-v1.reviewed.json`，当前 5 个 action 只更新 `VisionEvidenceSet` policy/review metadata，保持 `compile_allowed=false`、`geometry_promotion_allowed=false`。R12 现在已经接入普通建筑 intake/upload-session/MCP brief：建筑单体会额外产生 semantic candidate review items，把凹进侧立面、风管/方管、阴影/凹槽边界变成机器可读的 review policy，而不是自由文本。BoundaryGraph summary 现在记录 `vision_evidence_boundary_edge_count=198`，StructuredPlan 默认 HTML 会显示 R12 path、ground-plane review metrics 和 Vision review items，并继续输出 `verdict=review`、gap ratio 0.474、remaining unknown gap ratio 0.198 和四个 hard gate 0。INSID3/SAM/Grounded-SAM 只保留 optional backend status，不作为默认依赖或成功门；R12 的成功点是稳定“看见了什么、证据来自哪里、哪张图可作为 top-view planar candidate、哪些必须 review/helper、哪些确认会影响后续建模”，不是 photo-grade 晋级。

当前完成度判断：

- Switch-only 技术预览闭环：约 95%。
- 通用“图片 -> 结构化 SketchUp 模型”技术预览 MVP：约 88%。
- 当前优先级：semantic fusion、corrections workbench 和主线 CAD boolean/manifold 已补齐；R1/R2 已把救护车验收迁移到 `ProductProfile + PartGraph -> JSON DSL`；R3 Reference Visual QA 已能对救护车做 silhouette/keypoint/area/relative-placement/orientation gate；R4 已完成 image evidence -> PartGraph -> DSL -> Reference Visual QA -> CorrectionPatch -> QualityGate 的 ambulance 闭环；R5 三产品样本 gate 已由主线完成；R6 已补 no-seed parameter proposals、proposal-to-patch authoring、proposal review UI、proposal-applied mock/queue QA 链路，并在主线把 physical consistency QA 扩到 ambulance/Switch/Fuji 三样例。R7 已完成当前建筑群 evidence/known-scale/massing PartGraph 输入链、mock/live queue layout/reference QA、accepted-all roofline/facade/opening detail proposal -> patch -> feature Reference Visual QA -> mock/live queue QA。2026-06-01 的 Visual Grounding / VisualRelationGraph 第一刀已把 Switch 人工视觉检查变成代码闭环，并把建筑群四栋仓库、停车线/车道、树列候选从 image-only evidence 推进到 accepted promotion、pixel footprint QA、mock/live queue artifact；Grounding v2 现在把 observation/evidence/PartGraph provenance、GeometryFit v2 residual、R8 dense helper exclusion 和第二建筑群 mock gate 都纳入测试。R8 证明 no-texture editable geometry boundary：dense details helper ratio `1`、photo-grade eligible ratio `0`。R9 第一版把 ScaleAnchorGraph、GroundPlan subdivision、line/grid residual、TopViewOverlay QA 和 promotion decision 接入 observation/evidence/PartGraph/report/test；R9.5 把 photo-grade 前置判断固化为六 gate `PhotoGradeReadiness`，并在当前 building-group、第二生成样本和真实照片 scaffold 三个样本中进入 `npm run test:image-structured`。当前没有样本被标成 `photo_grade_readiness=candidate`；阻塞项已经转成 correction targets。
- R11/R11.2/R12 已把 bird-eye land-cover、source-image BoundaryGraph v1、HighContrastEdge v1、真实 OpenCV Edge v1、VisionEvidenceSet v1、VisionEvidenceReviewPatch、VisionEvidenceReviewWorkbench、VisionEvidencePolicyCorrectionPatch、INSID3 optional compare contract、R11/R12-aware AutoGroundPlan、aggressive completion、四联/边线/消融 QA artifact 和 synthetic bird-eye/boundary fixture 加入 `npm run test:image-structured`；当前没有样本被标成 `photo_grade_readiness=candidate`，阻塞项继续通过 review patch、browser-exported review decision、policy correction patch、readiness 和 correction targets 暴露。

下一轮建议：

- Reference Visual QA 已能反向给出 `update_part_graph` correction suggestion，目标是修改 part graph 字段，而不是直接改 DSL 坐标；`part_graph_correction_patch` 已可生成和应用。
- 下一步：基于 `VisionEvidenceSet v1` 继续做语义融合和 agent-first review。view/ground-plane estimate、不可 apply 的 review patch、浏览器可导出的 review workbench、只作用于 evidence-policy metadata 的 correction patch，以及普通建筑 intake/upload-session/MCP brief 接入已完成；接下来应扩更多真实上传样本，并继续把 OpenCV/HighContrast 边线从“候选线段”推进到稳定边界类别。重点降低右侧/底部边界、道路边线和铺装/绿化分界在遮挡情况下的 width/snap residual，而不是再靠 layout prior 补洞。同时把 `building-real-photo-smoke` 的 placeholder 输入替换成真实 top/oblique 建筑照片，或继续优化现有 building-group/second-sample 的 oblique facade height cues。在 ScaleAnchorGraph、GroundPlan、line/grid residual、TopViewOverlay、oblique/facade 和 promotion gate 同时成立前，cars、trees、roof vents、facade openings 等 dense helper classes 不能晋级为看似完整的真实几何。

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
  - R9.5 `photo-grade-readiness-report.json` 当前在三个样本上生成：`building-group/proposal-qa-candidates/` 为 `technical_baseline`（2/6 gates candidate-ready，8 个 blockers），`building-group-second/` 为 `technical_baseline`，`building-real-photo-smoke/` 为 `review_required`（缺真实建筑照片资产）。`npm run test:image-structured` 会验证六类 gate、错误 scale/parking-only、bbox-only parking、top-view overlay 负例和 oblique/facade/promotion 降级逻辑。
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
  - 可选读取 `model-plan.example.json`、显式 `view-hints.json`，或 upload-session 生成的 `view-hints.generated.json` 作为 view hints。
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
