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

发布级上传入口推荐统一走 `image-structured:real-world-building-upload-session`。它会串起 source-package preflight、structured intake、source gate、MCP brief 和 review workbench，并写出 `upload-session-summary.json` 给产品/API/队列消费；未显式传 `--view-hints-file` 时，会把 preflight 从文件名、上传包内 `view-hints.json` / `manifest.json` / `upload-manifest.json`、CAD 默认视图中识别到的 front/side/oblique/top 标签写成 `view-hints.generated.json` 再交给 intake，避免真实上传包绕回样例脚本。上传包 metadata 也可声明 `dimensions` / `known_dimensions` / `scale_hints` / `scale_anchors`；这些尺度线索会进入 preflight 的 `scale_package`、intake 的 `scale_calibration`、source-package 和 MCP brief，但仍是 review-gated evidence，不会绕过 source/semantic/compile gates。preflight 和 AssetSet 会记录 `content_sha256` 并生成 `source_content` 检查；同一文件内容被复制成多个 view label 时会触发 `duplicate_source_assets`，不能成为 release-source candidate，也不能通过 source input gate。upload manifest 解析状态会进入 `upload-session-summary.preflight.metadata_files`；无效 JSON、不符合契约、`views[].source_image` 或 `scale_anchors[].source_image` 未引用上传包真实文件的 manifest 会标记为 `invalid_json` / `invalid_contract`，preflight 顶层状态为 `blocked_source_metadata`，触发 `invalid_source_metadata`，且不会贡献 view/scale hints。底层的 `image-structured:preflight-real-world-building-source-package` 可单独做文件/视角标签/尺度线索层面的预检；preflight 只判断素材包能否进入 intake 或是否像 release-source 候选，不承诺建模成功。`intake` 只产出结构化资产、观察集、候选图、建模 brief、MCP brief、候选确认草稿和 review workbench；不会直接生成 SketchUp DSL。PDF / CAD 已能进入同一个 AssetSet / ModelingBrief contract 并 fail-closed；显式传 `--parse-documents` 时，当前最小解析器会读取 PDF metadata 和 DXF LWPOLYLINE outline，生成 review-gated ObservationSet。

建筑类 raster image 进入 intake / upload-session 时会默认生成 `VisionEvidenceSet v1`，并落盘 `vision-evidence-v1-report.json`、`vision-evidence-review-patch.json`、`vision-evidence-review-patch.md` 和 `vision-evidence-review/index.html`。这些 artifact 会进入 `intake-summary.json`、`upload-session-summary.json`、handoff 和 MCP brief 的权威 artifact 列表；凹进侧立面、矩形风管/方管、阴影/凹槽边界等只作为 `semantic_candidate_policy` review item 出现，允许人工确认语义策略，但 `apply_allowed=false`、`compile_allowed=false`、`geometry_promotion_allowed=false`，不能直接晋升为 SketchUp 几何。

图片分析在主 bbox 和候选生成前会先写入 `image.content_frame`。当前 `auto_screenshot_chrome_v1` 只处理大块近黑截图面板、黑边和截图 chrome；检测到时会把 `content_frame.bbox/source_bbox`、removed regions、raw/effective edge counts 和 `auto_content_frame` helper observation 写入 ObservationSet，并在 overlay 中画出 content frame。该步骤用于避免 UI 面板污染主体 bbox，不替代阴影/凹槽判断或人工 facade segmentation。

`vision-evidence-review-patch.json` 的每个 `semantic_candidate_policy` item 会携带 `current_value.evidence_instances[]`，逐条列出 evidence id、source id、source image、view、`bbox_px`、confidence、backend 和 review-required 状态。MCP brief 会在 `evidence_summary.vision_evidence.semantic_evidence_instances` 中携带同一类可定位实例，并在 `modeling_handoff[]` 中按角色合并主 bbox、建模决策、允许语义、禁止误读、确认项和 handoff 文本；`upload-session-handoff.json` 也会在 `vision_evidence.semantic_evidence_instances` 和 `vision_evidence.modeling_handoff[]` 中继承同一批结构化证据。Markdown 会输出实例表和建模 handoff 表。产品 review UI、API 和 MCP 因此可以定位凹进侧立面、矩形风管/方管、阴影/凹槽边界等候选所在区域，并直接看到这些证据该如何被 review-gated 使用，而不是只看到角色名和自由文本风险说明。

真实建筑 source-package 的 `view_package.view_evidence` 会按 required view 输出 asset ids、source paths、media types 和 content hashes；`semantic_package.role_evidence` 会按 required semantic role 输出候选 id、视角、source image、置信度范围、候选质量状态、review 标记和 `geometry_promotion_allowed=false`。`semantic_package.evidence_quality`、source-request 的 `semantic_evidence_quality` / `semantic_requirements.evidence_quality` / `upload_package_requirements.semantic_evidence.evidence_quality`、upload-session summary/handoff 的 `semantic_evidence_quality`、source-request-response 的 `summary.semantic_evidence.evidence_quality` 与 MCP brief `source_package_gate.semantic_evidence_quality` 会同步说明这些语义角色是 missing、weak review candidate 还是 review-required candidate。产品/API/MCP 因此能直接看到 front/left/oblique/top 由哪些源文件提供，以及凹进立面、矩形风管/方管、阴影/凹槽边界等角色的结构化来源和几何提升禁令，而不是只看到 view/role count。

release artifact workspace 也会继承同一份语义质量合同：`mcp_modeling_handoff.semantic_evidence_quality` 和每个 `task_packets[].mcp_constraints.semantic_evidence_quality` 必须保留 weak/review-required 状态、review roles、risk flags 和 `geometry_promotion_allowed=false`；task packet acceptance criteria 会包含 `preserve_semantic_evidence_quality`，独立 workspace validator 会检查 `semantic_evidence_quality_propagated`。这保证后续 PartGraph、compiled output、PhotoGradeReadiness authoring 阶段即使只读取 workspace，也不会把弱候选或 review-only 角色当作确认几何。

同一个 release artifact workspace 还会把 `vision-evidence-review-patch.json` 的 `semantic_evidence_instances` 和 MCP brief 的 `modeling_handoff` 下沉到 `mcp_modeling_handoff.vision_evidence` 以及每个 `task_packets[].mcp_constraints.vision_evidence`。每个 task packet 还会生成 `mcp_authoring_handoff`，把权威输入、VisionEvidence report、review patch、review workbench、VisionEvidence 角色、bbox/实例数量、建模 handoff 角色、blocked interpretations、required confirmations、direct DSL 阻断和 failed required checks 压成 MCP 可直接消费的 prompt/digest。task packet acceptance criteria 必须包含 `use_vision_evidence_instances` 和 `use_vision_evidence_modeling_handoff`，独立 workspace validator 会检查 `vision_evidence_instances_propagated`、`vision_evidence_modeling_handoff_propagated` 和 `task_packet_mcp_authoring_handoff_present`，确保 MCP/建模任务能读取带 source image、view、bbox、confidence、建模决策和禁止误读的凹进侧立面、矩形风管/方管、阴影/凹槽边界证据，而不是重新拼自由文本。

release work-order 只作为任务调度单使用，不作为几何证据源使用。`release-work-order.json/md` 会暴露 `artifact_authoring_policy`：`direct_sketchup_dsl_allowed=false`、review 后才能提升几何，并要求下游在 authoring PartGraph 前从 source request、MCP brief 或 `release-artifact-workspace.json` 读取具体 `semantic_evidence_quality`，不能把 work-order 任务标签直接当成可建模立面/风管/凹槽证据。

补充约束：同一个上传源路径不能在 manifest 中同时声明多个 required view。preflight 会在 `view_package.view_source_diversity` 中列出 required view 对应的源路径；如果同一路径复用成 front/left/oblique/top 等多个必需视角，会触发 `view_sources_not_distinct`，即使视角标签本身齐全也不得成为 release-source candidate；upload-session 也不会把这类冲突标签写成 `view-hints.generated.json`。

```bash
npm run image-structured:intake -- --input test/建筑单体 --object-type building_single --object-name "Anime Building Single Demo" --output-dir output/image-structured-modeler/building-single-intake-test
npm run image-structured:real-world-building-upload-session -- --input test/真实建筑上传包 --object-type building_single --object-name "Real Building Upload" --output-dir output/image-structured-modeler/real-building-upload-session --require-preflight-release-source-candidate --require-source-input-ready
npm run image-structured:prepare-real-world-building-release-artifact-workspace -- --upload-session-summary output/image-structured-modeler/real-building-upload-session/upload-session-summary.json --output output/image-structured-modeler/real-building-upload-session/release-artifact-workspace.json
npm run image-structured:validate-real-world-building-release-artifact-workspace -- --workspace output/image-structured-modeler/real-building-upload-session/release-artifact-workspace.json --require-ready-to-author
npm run image-structured:preflight-real-world-building-source-package -- --input test/真实建筑上传包 --object-type building_single --output output/image-structured-modeler/real-building-preflight/preflight.json --require-release-source-candidate
npm run image-structured:intake -- --input test/建筑单体 --object-type building_single --object-name "Anime Building Single Demo" --output-dir output/image-structured-modeler/building-single-intake-test --require-source-input-ready
npm run image-structured:intake -- --input test/建筑单体 --object-type building_single --object-name "Anime Building Single Demo" --output-dir output/image-structured-modeler/building-single-intake-test --real-world-building-release-draft --release-reviewer reviewer-name --release-accepted-at 2026-06-16 --release-notes "Draft from intake; fill real release artifacts before promotion."
npm run image-structured:intake -- --input projects/image-structured-modeler/examples/multimodal-intake --object-type building_single --object-name "PDF CAD Fixture" --output-dir output/image-structured-modeler/pdf-cad-parser-test --parse-documents --no-overlays
npm run image-structured:export-mcp-brief -- --input-dir output/image-structured-modeler/building-single-intake-test # 可选：重建/自定义 MCP brief
npm run image-structured:promotion-patch -- --input-dir output/image-structured-modeler/building-single-intake-test
# 只有 candidate-promotion-patch.status=ready_for_part_graph_patch 时运行：
npm run image-structured:apply-promotion-patch -- --input-dir output/image-structured-modeler/building-single-intake-test --profile examples/product-profiles/building_single_urban_oblique.json
npm run image-structured:release-gate -- --output-dir output/image-structured-modeler/release-gate
npm run image-structured:audit-real-world-building-candidates -- --input test/建筑单体 --input projects/image-structured-modeler/examples/building-single-anime-yellow/input-visible-crop.png --output-dir output/image-structured-modeler/real-world-building-demo-candidate-audit
npm run image-structured:prepare-real-world-building -- --intake-dir output/image-structured-modeler/building-single-intake-test --manifest-output output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json --reviewer reviewer-name --accepted-at 2026-06-16 --notes "Draft from intake; fill real release artifacts before promotion."
npm run image-structured:prepare-real-world-building -- --sample-id real-building-demo --source-image test/real-building-demo/top-view.jpg --source-image test/real-building-demo/oblique-view.jpg --profile examples/product-profiles/building_group_industrial_campus.json --part-graph projects/image-structured-modeler/examples/real-world-building-positive/part-graph.json --compiled-output projects/image-structured-modeler/examples/real-world-building-positive/output.json --photo-grade-readiness-report projects/image-structured-modeler/examples/real-world-building-positive/photo-grade-readiness-report.json
npm run image-structured:validate-real-world-building -- --manifest output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json --output-dir output/image-structured-modeler/real-world-building-positive-manifest/draft-validation --require-present
npm run image-structured:validate-real-world-building
npm run image-structured:validate-real-world-building -- --require-present
npm run image-structured:analyze-switch
npm run image-structured:generate-switch
npm run image-structured:compile-switch
npm run image-structured:review-switch
npm run image-structured:visual-relation-switch
npm run image-structured:visual-relation-building-group
npm run image-structured:geometry-fit-building-group-candidates
npm run image-structured:photo-grade-readiness-building-group
npm run image-structured:vision-evidence-building-group
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

上传包内可放一个 `manifest.json`，用于普通文件名照片的视角和尺度声明：

```json
{
  "version": 1,
  "kind": "real_world_building_upload_manifest",
  "dimensions": {
    "units": "mm",
    "width": 9000,
    "depth": 12000,
    "height": 10500,
    "confidence": 0.84,
    "basis": ["User-provided measured building dimensions."]
  },
  "views": [
    { "source_image": "photo-a.jpg", "kind": "front" },
    { "source_image": "photo-b.jpg", "kind": "left" },
    { "source_image": "photo-c.jpg", "kind": "oblique" },
    { "source_image": "photo-d.jpg", "kind": "top" }
  ]
}
```

`image-structured:real-world-building-upload-session` 会生成：

- `upload-session-summary.json` / `.md`：一次上传会话的稳定机器摘要；汇总 preflight、`preflight.metadata_files`、intake、source-package gate、source-request response gate、MCP brief、review workbench、可选 release draft/checklist/work order、`workflow` 和 next actions。`intake.source_package` 会直接暴露 gate ok、required/failed requirements、source/view/scale/semantic status、blockers、missing views、missing semantic roles、`source_request` 和 source-package next actions。`source_request` 是产品上传页可直接展示/消费的补素材请求，会列出需要替换的源素材、缺失视角、尺度证据目标、允许的 image/PDF/CAD 类型，以及在满足前被阻断的 `direct_sketchup_dsl` / promoted PartGraph / formal release manifest；summary 的 `artifacts.source_request`、`artifacts.source_request_markdown` 和 `artifacts.upload_manifest_template` 会直接指向对应文件，产品/API 不需要解析 source-package 内嵌字段。补交素材时传 `--source-request-file` 指向上一轮 `real-world-building-source-request.json`，summary 会写 `source_request_response` 和 `artifacts.source_request_response` / `.md`，并把本次上传是否满足上一轮请求纳入 `ok`；`source_request_response.unsatisfied_check_ids` 和 `unsatisfied_check_details` 会直接列出还没满足的检查项，上传页/API 不必再解析完整 checks 表。请求 release draft 时，`real_world_building_release_draft` 会直接暴露 `validation_status`、`can_promote_to_release_manifest`、`blockers`、`checklist_required_check_ids`、`checklist_failed_required_check_ids`、`checklist_review_required_check_ids`、`checklist_checks`、`work_order_status`、`work_order_blocked_required_tasks` 和 `next_actions`，产品/API 不必解析 source-package、checklist 或 work-order artifact 才能展示阻断原因。`workflow.stage` 是上传会话下一步机器状态：`source_refill_required` / `source_response_refill_required` 表示需要按 `workflow.source_request_file` 和 `workflow.upload_manifest_template` 补素材；`source_input_ready_needs_release_artifacts` 表示本轮输入包已可继续人工 review、PartGraph/QA/release artifact 工作但还不能发布；`workflow.release_work_order` / `.release_work_order_markdown` 指向机器任务清单，列出 PartGraph、compiled output、PhotoGradeReadiness、人审和正式 manifest 推进任务；`workflow.commands` 会给出 refill upload-session、source-package 复评、prepare release sample、validate draft 和 release gate 命令。`ok=false` 只表示请求的门禁失败，不表示没有产物；blocked 时仍会尽量保留 review/demo artifact。
- `upload-session-handoff.json` / `.md`：产品/API/MCP 的单文件交接入口；把 `workflow.stage` 转成 `needs_source_refill`、`needs_source_request_response_refill`、`ready_for_release_artifact_work` 或 `ready_for_formal_release_validation`，并给出 primary action、`primary_action.artifact_exists`、带 `exists` 状态的权威 artifact 列表、语义证据质量、`vision_evidence.semantic_evidence_instances`、`vision_evidence.modeling_handoff`、release checklist required/failed/review required 摘要和可执行命令。blocked 截图/demo 会指向 source request，并在 `commands` 中给出 `prepare_source_refill_package`、`validate_source_refill_package_require_upload_ready` 和 `run_refill_upload_session_require_input_ready` 的顺序；真实上传包已满足 source request 但缺 PartGraph/output/PhotoGradeReadiness 时会指向 release work order。
- `real-world-building-source-package-preflight/preflight.json` / `.md`：可选的上传包预检产物；由 `image-structured:preflight-real-world-building-source-package` 生成，区分 `can_start_structured_intake` 和 `release_source_candidate`，检查支持的媒体类型、生成/截图/脚手架路径标记、source content hash 去重、front/side/oblique/top 视角标签、required view 源路径唯一性和 `scale_package` 尺度线索；上传包内的 `view-hints.json`、`manifest.json`、`upload-manifest.json` 会作为 metadata 读取，不会被当作 unsupported source asset；坏 upload manifest 会记录 `invalid_contract`、顶层状态 `blocked_source_metadata`，并阻断 release-source candidate。manifest 引用缺失源文件时不会贡献 view/scale hints；重复文件内容会进入 `source_content.duplicate_groups` 并触发 `duplicate_source_assets`；同一路径被标成多个必需视角会进入 `view_package.view_source_diversity.reused_source_paths` 并触发 `view_sources_not_distinct`。
- `view-hints.generated.json`：未显式传 `--view-hints-file` 且 preflight 识别出视角标签时生成；来源可以是文件名、上传包 metadata 或 CAD 默认视图，作为 intake 的视角提示输入，仍只是 review evidence，不会绕过 source/scale/semantic/compile gates。
- `intake-summary.json`：产品/API/队列/CI 的稳定机器摘要，记录 `ok`、profile、compile gate、source-package gate、关键 artifact 路径和 release draft 状态。
- `real-world-building-source-request.json` / `.md`：独立补素材请求 contract；从 source-package 的 `source_request` 落盘，供上传页、API、MCP 或用户直接读取。它由 `projects/image-structured-modeler/schema/real-world-building-source-request.schema.json` 锁定。`view_source_requirements` 会明确 required views 必须引用不同 `views[].source_image`，违反时对应 `view_sources_not_distinct`；`upload_package_requirements` 会把下一轮上传包的 manifest 文件名、必需视角槽位、缺失 required views、scale evidence、禁止捷径和 `next_upload_response_check_ids` 收敛成机器可渲染表单。
- `source-refill-package-guide.json` / `.md`：可由 `npm run image-structured:prepare-real-world-building-source-refill-package -- --source-request output/.../real-world-building-source-request.json --output-dir output/.../source-refill-package` 生成，把上一轮 source request 变成用户可执行的补素材包目录。guide 会写 `upload-manifest.template.json`、README、`source-slots.md`、required source slots、scale evidence、禁止捷径、`build_manifest_from_sources`、`run_source_refill_workflow` 和下一轮 `real-world-building-upload-session --source-request-file ... --require-source-input-ready` 命令；它保持 `direct_upload_ready=false` 和 `template_only=true`，并把真正可传给 upload-session 的目录固定为 `upload-package/`，避免 README/guide/template 辅助文件被误当作上传源资产。
- `source-refill-package-validation.json` / `.md`：可由 `npm run image-structured:validate-real-world-building-source-refill-package -- --package-dir output/.../source-refill-package` 生成，独立判断补素材包当前是 `template_package_pending`、`ready_for_upload_session` 还是 `invalid_refill_package`。validator 会检查 guide/source request、`upload-package/` 目录、helper artifacts 分离、真实 manifest、JSON 可解析性、manifest `kind` / `object_type`、required views、source refs 存在且不越过 upload package、路径和文件内容去重；报告会暴露 `commands.build_manifest_from_sources`、`commands.run_source_refill_workflow` 和 `commands.require_upload_ready`，只有 `ready_for_upload_session` 才能继续跑下一轮 upload-session。
- `source-request-response.json` / `.md`：补交素材响应验收；仅在 upload-session 传 `--source-request-file` 时生成，对比上一轮 request、本次 source-package 和 preflight，报告 source assets、缺失视角、`view_source_diversity`、尺度证据和语义角色是否已满足。`summary.expected_check_ids` 来自上一轮 `upload_package_requirements.next_upload_response_check_ids`，`missing_expected_check_ids` / `unexpected_requested_check_ids` 会暴露补素材表单和实际验收逻辑是否脱钩；`summary.view_evidence` 会列出上一轮缺失视角、本轮 present/missing 状态、`view_source_diversity_status` 和 `requested_view_evidence`，让产品/API/MCP 直接看到补上的 left/oblique/top 来自哪些源文件；`summary.semantic_evidence` 会稳定列出上一轮要求的语义角色、本轮覆盖角色和仍未满足角色，并携带 `role_evidence` / `requested_role_evidence` 候选 provenance，避免产品/API/MCP 从 `semantic_*` 字符串反解析凹进立面、风管或阴影歧义缺口；`requested_check_ids` / `satisfied_check_ids` / `unsatisfied_check_ids` 和 `unsatisfied_check_details` 是稳定的产品/API 摘要。完整 `checks` 表仍保留逐项状态和说明。即使用户把上一轮要求的 front/left/oblique/top 标签补齐，只要 manifest 仍用同一个 `source_image` 路径冒充多个必需视角，response 也必须把 `view_source_diversity` 标成 requested/failed，summary 的 `gates.source_request_response_ok=false`。`satisfied_for_release_work` 只表示补素材请求已满足到可进入 review/modeling work，不代表 release-ready。
- `upload-manifest.template.json`：根据 source request 生成的上传 manifest 模板；它包含 front/side/oblique/top 或建筑群所需视角槽位、`view_source_requirements` 和尺度证据建议，但带 `template_only=true`。用户把真实源文件放入 `upload-package/sources/` 后可运行 `image-structured:build-real-world-building-source-refill-manifest` 生成 `upload-package/manifest.json` 和 `source-refill-manifest-build-report.json/md`；builder report 由 `projects/image-structured-modeler/schema/real-world-building-source-refill-manifest-build-report.schema.json` 固定，状态为 `manifest_draft_needs_sources` 或 `manifest_ready_for_package_validation`。该 builder 只按明确文件名关键词匹配视角，缺视角时保持 draft/pending。如果模板被原样改名成 `manifest.json` 进入上传包，preflight 会返回 `blocked_source_metadata` / `invalid_contract`，要求先替换为真实 manifest；如果多个 required views 指向同一 `source_image`，preflight 会返回 `view_sources_not_distinct`。
- `source-refill-workflow-report.json` / `.md`：可由 `npm run image-structured:run-real-world-building-source-refill-workflow -- --package-dir output/.../source-refill-package` 生成，串起 manifest builder 和 `--require-upload-ready` validator；状态由 `projects/image-structured-modeler/schema/real-world-building-source-refill-workflow-report.schema.json` 固定为 `manifest_draft_needs_sources`、`refill_package_invalid`、`ready_for_upload_session`、`upload_session_completed` 或 `upload_session_blocked`。默认不跑 upload-session；只有显式加 `--run-upload-session` 才会继续触发下一轮 upload-session。
- `asset-set.json`：记录上传资产、媒体类型、视角、`content_sha256`、画像路由和 geometry gate。
- `observations.json`：记录图像观察、evidence graph、视觉关系、scale calibration 和质量风险；当上传 manifest 提供 known dimensions 时，scale strategy 会记录为 `source_metadata_known_dimensions_with_view_bbox` 并保留 `source_metadata_hints`。
- `vision-evidence-v1-report.json`、`vision-evidence-review-patch.json`、`vision-evidence-review-patch.md`、`vision-evidence-review/index.html`：建筑类 raster image 的轻量图片结构化证据和人工策略 review 入口；review patch 会列出 ground-plane、edge-class 和 semantic candidate policy 项，供产品/API/MCP 读取，但不允许直接 apply、compile 或 geometry promotion。
- `candidate-graph.json`：记录可审查候选；默认没有任何候选自动 `eligible`。
- `modeling-brief.json`：给建模 agent / MCP compiler 的唯一上游 brief，`compile_allowed=false` 时不得生成 DSL。
- `mcp-modeling-brief.json` / `mcp-modeling-brief.md`：默认由 `image-structured:intake` 生成的 MCP/建模 agent 消费入口；它合并 gates、候选、证据、真实建筑 source-package gate、scale strategy、source metadata scale hints、`source_request`、`agent_contract`、`grounding_risk_register`、`candidate_disambiguation`、`modeling_constraint_summary` 和禁止事项。upload-session 在传入 `--source-request-file` 后会把本轮 `source-request-response` 回写到 `source_request_response_gate`，并在失败时把 `source_request_response_failed` 和具体 `unsatisfied_check_ids` 写入 `compile_permission.reasons` / `agent_contract`；同一轮也会重写 `review/index.html`，让页面内嵌的 `mcp-modeling-brief-data`、可见 MCP Brief 区块、`modeling-constraint-summary-table` 和 `candidate-disambiguation-table` 同步显示 response gate、role-level 建模约束与逐候选歧义表。MCP 或前端只读 brief/workbench 也能知道这一轮补交还差什么。`agent_contract` 会列出唯一权威 artifact、允许输出、被阻断输出、证据规则、必需确认项和几何边界；`grounding_risk_register` 用稳定 ID 暴露 source authenticity、missing view、scale、release readiness、direct DSL、凹进立面、方管/风管、阴影/凹槽歧义等风险；`candidate_disambiguation` 则逐候选写出可接受语义、禁止误读和需要确认的问题，`modeling_constraint_summary` 会按 role 去重汇总关键建模禁令、必须确认项和可/不可提升策略，例如凹进立面不能并入正立面、矩形风管不能当装饰线、阴影边界不能直接切成凹槽。blocked 状态下会明确写出 `can_generate_sketchup_dsl=false` / `direct_sketchup_dsl` blocked。`image-structured:export-mcp-brief` 会从既有 intake 产物自动重读 `real-world-building-source-package.json`，避免重建 brief 时丢失源图包 readiness/blockers。
- MCP brief 的 `evidence_summary.vision_evidence` 会暴露 VisionEvidence 是否可用、review 是否必需、semantic review roles、`default_heavy_model_required`、top-view ground-plane 使用策略、`semantic_evidence_instances`、`modeling_handoff` 和关键 artifact；`agent_contract.authoritative_artifacts` 必须包含 `vision_evidence_review_patch`，让 MCP 不再凭自由文本猜凹进立面、风管或阴影边界。
- `real-world-building-release/manifest.draft.json`、`manifest-contract-summary.json`、`release-checklist.json` / `.md`、`release-work-order.json` / `.md`：传 `--real-world-building-release-draft` 时生成，并直接出现在 upload-session summary 的 `artifacts` 和 `real_world_building_release_draft` 状态块里；缺 release artifact、PhotoGradeReadiness、VisionEvidence accepted review decision / policy correction patch 或人工验收时必须保持 fail-closed。`release-work-order.json` 是 checklist 之后的机器任务清单，状态会区分 `blocked_needs_source_assets`、`needs_release_artifacts`、`needs_human_review` 和 `ready_for_formal_manifest`，用于产品/API/队列决定下一步补素材、补 PartGraph/output/PhotoGradeReadiness、补 VisionEvidence policy review，还是进入正式 manifest 验证。
- `candidate-promotion-review.draft.json`：候选确认草稿；默认 `accepted_candidates=[]`、`promotion_allowed=false`、`compile_allowed=false`。
- `candidate-promotion-patch.blocked.json`：从草稿生成的 fail-closed promotion patch；有 blocker 时 `actions=[]`、`apply_allowed=false`。
- `part-graph.candidate-promoted.json`：只有 ready promotion patch 才会生成；它把已确认候选写成 PartGraph parts，但仍带 `review_required` / QA provenance，后续必须继续通过 PartGraph compiler gate。
- `review/index.html`：显示 gates、缺失输入、候选 blockers、intake summary / MCP brief 链接和 overlay 链接，并可导出 `candidate_promotion_review` JSON。
- `review-overlays/*.png`：用于人工核对的标注图。
- 可选 `--real-world-building-release-draft`：额外生成 `real-world-building-release/manifest.draft.json`、`manifest-contract-summary.json`、`release-checklist.json`、`release-checklist.md`、`release-work-order.json` 和 `release-work-order.md`，并在 `review/index.html` 暴露下载链接；这只是 release-positive 样本准备草稿，checklist/work-order 未通过前仍不得写入正式 `examples/real-world-building-positive/manifest.json`。即使误把 prepare 输出指向正式路径，脚本也会先写 staging draft，验证未通过时返回 `formal_release_manifest_write_blocked` 并保持正式 manifest 不变。
- 可选 `--require-source-input-ready` / `--require-source-release-ready`：让上传入口本身成为 source-package 硬门禁；不满足时命令返回非零退出，并写出 `real-world-building-source-package.gate-result.json`。可用 `--source-package-gate-output` 指定输出路径。

当前 `test/建筑单体` 经过该入口得到 2 个 image asset、29 个 candidate、`compile_allowed=false`，缺口为 `scale_confidence_below_publish_gate`、`missing_oblique_view`、`missing_left_view`、`missing_top_view`。候选里会显式列出凹进侧立面、矩形风管/方管、HVAC、阴影/凹槽边界等 review-only 语义；`candidate-promotion-review.draft.json` 保持 `verdict=blocked`、`accepted_candidates=[]`、`held_candidates=29`，promotion patch 保持 `actions=[]`。MCP brief 还会写出 role-level `modeling_constraint_summary`，避免下游只从重复候选行里反推这些建模禁令。对这个 blocked patch 运行 `image-structured:apply-promotion-patch` 会拒绝执行并报 `Candidate promotion patch is not applyable`。这意味着它可以作为结构化审查 demo，但不能再被当作可直接编译到 SketchUp 的几何输入。

`image-structured:audit-real-world-building-candidates` 会对一个或多个候选输入运行同一套 intake + release draft/checklist，输出 `candidate-audit-report.json` 和 Markdown；JSON 由 `projects/image-structured-modeler/schema/real-world-building-demo-candidate-audit.schema.json` 锁定，列出结构化语义覆盖、release blockers、缺失视角/尺度、`release_stage` 和下一步动作。summary 会区分 `best_structure_review_candidate` 和 `best_release_work_candidate`：前者可以是结构审查素材，后者只有 source package 已经 `input_ready_for_release_work` 或 release checklist 已通过时才会出现。每个 candidate 还会直接暴露 `release_candidate_assessment`、`source_request`、`artifacts.source_request`、`artifacts.upload_manifest_template`、`refill_workflow.commands.prepare_source_refill_package`、`refill_workflow.commands.validate_source_refill_package_require_upload_ready`、`refill_workflow.commands.run_refill_upload_session` 和 `release_preparation_workflow`；后者把选中候选后的 source-refill package、upload-session、release artifact workspace、workspace validation、manifest draft validation 和 guarded formal manifest write 命令串成机器可读工作流。它用于挑选真实建筑 demo，不会把本地截图、canonical crop、生成图或网页来源样本升级成 release-positive 或 release-work candidate。

`image-structured:release-gate` 会生成 `release-gate-report.json`，把当前发布硬门禁汇总成 21 个用例：

- `unknown_negative_fail_closed`：未声明画像必须路由到 `unknown_object`，不能应用 promotion patch。
- `real_world_building_source_package_preflight_fixture`：上传包预检必须拒绝生成/裁剪截图作为 release-source，同时允许它们进入 review/demo intake；带 front/side/oblique/top 标签的真实上传包形态可以成为 release-source 候选，但仍需后续 intake/source-package/QA 证明；同一文件内容复制成多个 view label 必须触发 `duplicate_source_assets` 并保持 `release_source_candidate=false`；同一源路径在 manifest 中被标成多个必需视角必须触发 `view_sources_not_distinct`，即使 `missing_hinted_views=[]` 也不得成为 release-source candidate；manifest 中 `views[].source_image` 或 `scale_anchors[].source_image` 指向缺失文件时必须作为 `invalid_contract` 被拒绝；`template_only=true` 的 manifest 模板即使视角齐全也必须作为 `invalid_contract` 被拒绝。
- `real_world_building_upload_session_fixture`：一次上传会话必须在 blocked 输入上写出 preflight、intake summary、review workbench、MCP brief、source-package、source-request、upload manifest template 和 gate-result 路径，并保持 `can_generate_sketchup_dsl=false`；summary 还必须暴露 parsed/invalid metadata 状态、source-package failed requirements 和 blockers，坏 manifest 必须保留 `invalid_source_metadata` blocker。同一 fixture 覆盖“按上一轮 source request 补交但仍用同一张图冒充多视角”的失败响应：upload-session 必须同时保留 preflight 的 `view_sources_not_distinct` blocker、写出 `source-request-response.json/md`，并把 `view_source_diversity.current_status=fail` 纳入 response gate。该 case 还会生成 `release-artifact-workspace.json/md`，blocked 输入必须得到 `blocked_needs_source_refill`，并在 workspace commands 中继续暴露 prepare source-refill package、require upload-ready validation 和 refill upload-session 三步命令。
- `real_world_building_upload_session_generated_view_hints_fixture`：上传包未显式传 `--view-hints-file` 时，必须从上传包 `manifest.json` 经 preflight 生成 `view-hints.generated.json` 并传给 intake，解除 front/left/oblique/top missing-view blockers；manifest 中的 known dimensions 必须进入 observations/source-package/MCP brief 的 scale evidence；source input gate 必须写出 gate-result artifact，并在 summary 中显示 input gate 无 failed requirements；该 case 还会把 blocked fixture 生成的 `real-world-building-source-request.json` 作为 `--source-request-file` 传入，要求 summary 暴露 `source_request_response.status=satisfied_for_release_work`、source-request-response artifact、`source_request_status=input_ready_for_release_work`、source-request artifact 和 upload manifest template；请求 release draft 时必须在 upload-session summary 暴露 manifest/checklist/work-order artifact、parsed metadata 状态、source-package release blockers、release draft blockers、checklist check statuses、`work_order_status=needs_release_artifacts`、`handoff.status=ready_for_release_artifact_work` 和 `release-artifact-workspace.json/md`，workspace 必须进入 `ready_for_artifact_authoring`，列出 PartGraph、compiled output、PhotoGradeReadiness 三类缺失 artifact，并为每类 artifact 输出 `task_packets`：绑定权威输入、MCP direct DSL/候选误读禁令、`mcp_authoring_handoff` prompt/digest、验收条件、完成证据和验证命令，但仍保持 `can_generate_sketchup_dsl=false`、`release_ready=false`。
- upload-session 相关 case 还会复验 VisionEvidence artifact：summary/artifacts 必须暴露 `vision_evidence_report`、`vision_evidence_review_patch`、`vision_evidence_review_patch_markdown` 和 `vision_evidence_review_workbench`，review patch 至少保留凹进侧立面、矩形风管/方管、阴影/凹槽边界等 semantic candidate policy 项，MCP brief 必须把 `vision_evidence_review_patch` 列为 authoritative artifact，upload-session handoff 必须同步暴露 `vision_evidence.semantic_evidence_instances` 和 `vision_evidence.modeling_handoff`。
- `pdf_cad_assetset_fail_closed`：PDF/CAD 必须进入 AssetSet/ModelingBrief，但在 extractor 缺失时保持 blocked。
- `pdf_cad_parser_positive_review_gate`：显式解析 PDF/DXF 后必须提取 CAD outline 和比例，但仍保持 review/missing-view gate。
- `pdf_cad_parser_release_matrix_fixture`：覆盖正向 PDF+DXF、多页 PDF+DXF、米制 DXF 单位缩放、图层过滤、多 outline 选择、坏 PDF、无 outline DXF、unsupported CAD，要求失败样本保留 extractor gate 而不是生成几何。
- `document_review_patch_roundtrip_fixture`：基于解析出的 CAD outline 生成 accepted review、ready promotion patch 和 PartGraph，验证人工确认闭环能落盘，同时 compiler gate 仍阻止证据不足的 SketchUp 输出。
- `building_single_semantic_matrix_fixture`：至少覆盖 canonical oblique/front 两种入口，要求凹进侧立面、矩形风管/方管、HVAC、阴影/凹槽边界等语义候选出现，并保持 review-gated。
- `building_single_blocked_demo`：当前建筑单体 demo 必须保留凹进侧立面、矩形风管/方管和阴影/凹槽边界候选，同时保持 blocked；还必须写出 fail-closed 的 `real-world-building-release/` 草稿、summary/checklist/work-order，并在 review workbench 暴露下载链接和 checklist/work-order 行；work-order 必须保持 `blocked_needs_source_assets`，不能把截图/生成源误判成可继续 release artifacts。
- `mcp_modeling_brief_export_fixture`：复验 blocked 建筑单体 intake 默认 MCP brief 和 review workbench 链接，再从产物重建 MCP brief；必须保留候选证据、缺失输入、直接建模禁令、`grounding_risk_register` 风险 ID、`candidate_disambiguation` 逐候选歧义表，以及凹进面/风管/阴影歧义的专用禁止事项。MCP brief source-package gate and agent contract now expose release checklist required/failed/review required ids, so downstream MCP/agent code can display exact required checklist blockers without parsing release checklist prose.
- `building_single_blocked_demo` 和 `mcp_modeling_brief_export_fixture` 还要求默认 intake/review workbench 链接 VisionEvidence report/workbench、内嵌 review patch JSON，并在 MCP `evidence_summary.vision_evidence.semantic_review_roles` 中保留 `recessed_side_facade_plane` / `rectangular_utility_ducts` / `shadow_or_recess_boundary` 等角色。
- `synthetic_ready_promotion_path`：人工清 blocker 后的 synthetic ready patch 可以写入 PartGraph，但 compiler gate 仍会阻止证据不足的 SketchUp 输出。
- `human_review_roundtrip_matrix_fixture`：覆盖 document accepted、image accepted、image blocked selection 三条 review JSON -> patch -> PartGraph/reject 路径。
- `human_review_ui_release_matrix_fixture`：用 headless Chrome 打开真实 `review/index.html`，覆盖 document accepted、image accepted、image blocked selection 三条 UI 导出路径；ready 路径进入 patch/PartGraph，blocked 路径拒绝应用。
- `accepted_positive_release_sample_fixture`：复验 building-group R7 final accepted 样本，要求 PartGraph 重新编译后与 output 完全一致，layout/reference/proposal/physical/queue QA 全部通过。
- `real_world_positive_switch_product_fixture`：复验 `test/手柄` 六张真实照片的 Switch 结构化链路，要求 observation/model-plan/output 重新编译一致，mock/queue snapshot、queue diff warning gate、VisualRelation QA 和 GeometryFit QA 全部通过；该用例只关闭“真实产品图片正样本”缺口，不抵消建筑发布样本缺口。
- `real_world_building_formal_manifest_write_guard`：故意把无效建筑 release draft 输出指到正式 `examples/real-world-building-positive/manifest.json`，要求 prepare 返回 blocked、只写 staging draft，并证明正式 manifest 未被创建或覆盖。
- `real_world_building_positive_manifest_contract`：自动寻找 `projects/image-structured-modeler/examples/real-world-building-positive/manifest.json`。缺失时记录 `real_world_building_positive_release_sample_missing`；存在时会验证真实用户建筑资产、人工 review 字段、PartGraph 重新编译、output freshness、physical QA、PhotoGradeReadiness，以及 VisionEvidence report / review patch / accepted review decision / policy correction patch，并输出 release checklist。
- `building_single_rhino_factory_visual_gap_guard`：记录 Rhino factory 建筑单体样本 layout QA 通过但人工视觉失败，防止把该旧样本误当 release-positive。
- `real_world_building_demo_candidate_audit_fixture`：对本地建筑候选运行 candidate audit，要求候选可用于结构化审查但保持 release blocked，并明确 source/assets/PhotoGradeReadiness 等缺口；同时要求每个候选输出 source-request artifact、upload manifest template、blocked `release_stage`、`release_candidate_assessment.selectable_for_release_work=false`、source-refill package prepare/validate/upload 命令链，以及 `release_preparation_workflow` 中的 source-refill package、upload-session、release artifact workspace、workspace validation、manifest draft validation 和 guarded formal manifest write 命令，保证 demo 选型不需要改样例脚本，也不会把结构审查最佳误报成发布候选。
- `release_gate_artifact_integrity`：扫描前面所有 case 的 `artifacts` 声明；普通 artifact 路径必须真实存在，正式建筑 manifest 这类当前预期缺失的路径必须显式标成 `expected_missing`，报告不得宣称不存在的 checklist、compiled output 或 QA 文件。生成的 `artifact-integrity-report.json` 由 `schema/release-gate-artifact-integrity-report.schema.json` 固定，并反查 workspace 生成/验证脚本、schema、npm scripts、upload-session/handoff command schema、release checklist required-check schema、README/PLAN/MEMO 和主 validation 入口是否同步。

当前报告是 `ok=true`、`release_ready=false`、`verdict=technical_baseline`。剩余发布缺口是：真实世界建筑正向发布样本（`real_world_building_positive_release_sample_missing`）。

真实建筑正样本的接入模板在 `projects/image-structured-modeler/examples/real-world-building-positive/manifest.example.json`，schema 在 `projects/image-structured-modeler/schema/real-world-building-release-sample-manifest.schema.json`；上传阶段 metadata 模板在 `projects/image-structured-modeler/examples/real-world-building-positive/upload-manifest.example.json`，schema 在 `projects/image-structured-modeler/schema/real-world-building-upload-manifest.schema.json`。upload-session schema 在 `projects/image-structured-modeler/schema/real-world-building-upload-session.schema.json`，handoff schema 在 `projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json`，release artifact workspace schema 在 `projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace.schema.json`，workspace validation schema 在 `projects/image-structured-modeler/schema/real-world-building-release-artifact-workspace-validation.schema.json`，source-package preflight schema 在 `projects/image-structured-modeler/schema/real-world-building-source-package-preflight.schema.json`，source-package schema 在 `projects/image-structured-modeler/schema/real-world-building-source-package.schema.json`，source-request schema 在 `projects/image-structured-modeler/schema/real-world-building-source-request.schema.json`，source-refill package guide schema 在 `projects/image-structured-modeler/schema/real-world-building-source-refill-package-guide.schema.json`，source-refill manifest builder report schema 在 `projects/image-structured-modeler/schema/real-world-building-source-refill-manifest-build-report.schema.json`，source-refill workflow report schema 在 `projects/image-structured-modeler/schema/real-world-building-source-refill-workflow-report.schema.json`，source-refill package validation schema 在 `projects/image-structured-modeler/schema/real-world-building-source-refill-package-validation.schema.json`，source-request-response schema 在 `projects/image-structured-modeler/schema/real-world-building-source-request-response.schema.json`，source-package gate-result schema 在 `projects/image-structured-modeler/schema/real-world-building-source-package-gate-result.schema.json`，release checklist schema 在 `projects/image-structured-modeler/schema/real-world-building-release-checklist.schema.json`，release work-order schema 在 `projects/image-structured-modeler/schema/real-world-building-release-work-order.schema.json`，demo 候选审计 schema 在 `projects/image-structured-modeler/schema/real-world-building-demo-candidate-audit.schema.json`。推荐先对上传包运行 `npm run image-structured:real-world-building-upload-session -- --input ... --object-type building_single`，它会生成 upload-session summary 和 intake 目录；未显式传 `--view-hints-file` 时，它还会把 preflight 从文件名或上传包 metadata 识别到的视角标签写入 `view-hints.generated.json` 并传给 intake。建筑类 profile 会额外写出 `real-world-building-source-package.json/md`、`real-world-building-source-request.json/md` 和 `upload-manifest.template.json`，判断源图包是否已经 `input_ready_for_release_work`，并明确 source、view、scale、semantic、semantic evidence quality、release checklist blockers。用户按 source request 补交前，可先运行 `npm run image-structured:prepare-real-world-building-source-refill-package -- --source-request output/.../real-world-building-source-request.json --output-dir output/.../source-refill-package` 生成补素材包 guide；guide 只生成 template/README/slots，并把真正上传目录放在 `upload-package/`，不代表真实素材已满足。用户补交后，可先运行 `npm run image-structured:run-real-world-building-source-refill-workflow -- --package-dir output/.../source-refill-package` 生成/验证 manifest 并读取单个 workflow report；只有 workflow 或 validator 到 `ready_for_upload_session` 才进入下一轮 upload-session。也可单独运行 `npm run image-structured:validate-real-world-building-source-refill-package -- --package-dir output/.../source-refill-package --require-upload-ready`；再传 `--source-request-file output/.../real-world-building-source-request.json`，即可写出 `source-request-response.json/md` 并让 summary/gate 显示补交是否满足上一轮请求。这个判断只代表输入包是否值得进入发布样本建模，不代表发布完成；当前回归要求完整四视角、manifest 引用真实存在的源文件、非生成源图、非重复源图、尺度过线、建筑语义齐全时可得到 input-ready，但 source gate 未过时即使 checklist 被误填 ready，source-package 也不能显示 release-ready。input-ready 后运行 `npm run image-structured:prepare-real-world-building-release-artifact-workspace -- --upload-session-summary output/.../upload-session-summary.json --output output/.../release-artifact-workspace.json`，会把 upload-session、handoff、MCP brief、manifest draft、checklist 和 work-order 收敛成单个 `release-artifact-workspace.json/md`；blocked 输入得到 `blocked_needs_source_refill`，input-ready 但缺发布 artifact 时得到 `ready_for_artifact_authoring`，并列出 PartGraph、compiled output、PhotoGradeReadiness、human review 和 formal validation 的下一步。workspace 的 `task_packets` 会为 PartGraph、compiled output、PhotoGradeReadiness 分别列出权威输入 artifact、MCP 约束、`mcp_authoring_handoff` prompt/digest、验收条件、完成证据、验证命令和下一步动作，并把 VisionEvidence review patch、semantic review roles、semantic evidence instances、modeling handoff 和 `use_vision_evidence_review_patch` 验收项传给每个任务包，避免产品/API/MCP 下游再靠自由文本猜任务；随后可运行 `npm run image-structured:validate-real-world-building-release-artifact-workspace -- --workspace output/.../release-artifact-workspace.json --require-ready-to-author`，独立验证 workspace contract 和 fail-closed 约束，不需要绕回完整 release gate。已有 intake 目录可单独运行 `npm run image-structured:assess-real-world-building-source-package -- --intake-dir output/...` 重新评估，不必重跑图片 intake；默认复评只写报告，上传/CI 流程需要阻断时加 `--require-input-ready`，正式发布验收需要阻断时加 `--require-release-ready`。硬门禁模式会自动写 `*.gate-result.json`，稳定记录 `ok`、`required_gates`、`failed_requirements` 和 source-package artifact 路径；也可用 `--gate-output` 自定义输出位置。再用 `npm run image-structured:prepare-real-world-building -- --intake-dir output/...` 从 `asset-set.json` 自动提取 source assets、sample id、profile hint 和默认 release artifact 路径；已经有独立 PartGraph/output/QA 的样本也可以继续显式传 `--source-image`、`--part-graph`、`--compiled-output` 和 `--photo-grade-readiness-report`。命令会生成 `manifest.draft.json`、`manifest-contract-summary.json`、`release-checklist.json`、`release-checklist.md`、`release-work-order.json` 和 `release-work-order.md`；checklist 会检查真实资产存在、禁止生成/脚手架/截图、重复源文件和网页来源路径、必需 QA artifact、PhotoGradeReadiness、人工 reviewer/accepted_at/notes，work-order 会把剩余缺口拆成 source assets、PartGraph、compiled output、PhotoGradeReadiness、human review、draft validation 和 formal manifest promotion 任务。正式 manifest 验证还会递归检查 PartGraph evidence 中的 `source_image/source_images`，要求这些源图全部被 `manifest.source_images` 覆盖，避免 manifest 指向真实图但 PartGraph 实际来自旧截图、生成图或无关样例。只有候选 draft 验证通过、`closes_release_gap=true` 且 checklist/work-order 的 `can_promote_to_release_manifest=true` 后，`--manifest-output projects/image-structured-modeler/examples/real-world-building-positive/manifest.json` 才会真正写入正式 manifest；如果提前传正式路径，prepare 会写到 staging draft，返回 `ok=false` / `formal_release_manifest_write_blocked`，并保持正式 manifest 不变。发布时只需要写入 `manifest.json`，不需要改 release gate 脚本；可以先对 draft 运行 `npm run image-structured:validate-real-world-building -- --manifest output/image-structured-modeler/real-world-building-positive-manifest/manifest.draft.json --output-dir output/image-structured-modeler/real-world-building-positive-manifest/draft-validation --require-present`。无效 draft 会返回 `ok=false`，但仍会写出 `manifest-contract-summary.json`、`release-checklist.json` 和 `release-checklist.md`；正式验收时运行 `npm run image-structured:validate-real-world-building -- --require-present`。

正式真实建筑 release manifest 的 `artifacts` 必须同时包含 PartGraph、compiled output、PhotoGradeReadiness report、VisionEvidence report、VisionEvidence review patch、accepted VisionEvidence review decision 和 VisionEvidence policy correction patch。`vision_evidence_review` 是 required checklist/work-order blocker：缺 decision/policy correction，或这些 artifact 允许 compile / geometry promotion 时，draft 必须保持 `manifest_invalid_release_gap_recorded`，不得写入正式 manifest。`real-world-building-release-checklist.schema.json` 也会强制 checklist 包含 required 的 `source_assets`、`source_authenticity`、`artifacts`、`photo_grade_readiness`、`vision_evidence_review` 和 `human_review`，防止手写缺项 checklist 绕过发布门禁。

`release-artifact-workspace.json` 现在同时有两层交接：`task_packets` 只覆盖 MCP/建模侧需要产出的 PartGraph、compiled output、PhotoGradeReadiness；`review_requirements` 覆盖发布审查侧的 `vision_evidence_review`、human review、draft validation 和 formal promotion。workspace 根节点也会继承 `release_checklist_required_check_ids`、`release_checklist_failed_required_check_ids` 和 `release_checklist_review_required_check_ids`，产品/API 可以直接读取这些列表和 `review_requirements[].artifacts`，看到哪些 required checklist 仍失败、`vision_evidence_review_decision` 和 `vision_evidence_policy_correction_patch` 是否已经导出，不需要从 release work-order 或 checklist 的自由文本里猜。MCP brief 的 `source_package_gate` 和 `agent_contract.output_policy` 也继承同一组 release checklist 摘要，保证建模文本出口和 workspace/handoff 使用同一份 required-check contract。workspace 的 `mcp_modeling_handoff`、每个 `task_packets[].mcp_constraints` 和 `task_packets[].mcp_authoring_handoff` 也会继续携带这三组 checklist id、VisionEvidence digest 和 forbidden actions，避免 artifact authoring 子任务只继承 direct DSL/候选消歧，却丢失具体 failed required check 或重新靠自由文本拼 prompt；每个 task packet 还必须包含 `address_failed_required_release_checks` 验收项，要求下游在声明任务完成前处理这些 failed required checks。

上传会话的 `workflow.commands` 和 handoff/workspace 的 `commands` 会给出 VisionEvidence 后续命令：`prepare_vision_evidence_review_workbench` 可重建 review workbench，`build_vision_evidence_policy_correction_patch` 会在人工导出 `vision-evidence-review.accepted.json` 后生成 `vision-evidence-policy-correction-patch.json/md` 和 `vision-evidence-v1.reviewed.json`。该命令仍只更新 evidence metadata，不允许 compile 或 geometry promotion。

`release-work-order.json` 的 schema 也会对 `vision_evidence_review` task 做条件校验：该 task 必须带 policy correction command，并且 `artifacts` 必须列出 VisionEvidence report、review patch、accepted decision、policy correction patch 四个 role。这样即使不打开 workspace，产品/API 也能从 work-order 合同中判断 VisionEvidence review 是否完整。

补充：`upload-session-handoff.json` 由 `projects/image-structured-modeler/schema/real-world-building-upload-session-handoff.schema.json` 锁定，并直接继承 release checklist required/failed 摘要、`semantic_evidence_quality`、VisionEvidence semantic instances 和 `modeling_handoff`。prepare 生成的无效 draft 也会保留 `release-work-order.json` / `.md`，`release-artifact-workspace.json/md` 则把这些任务、权威 artifact、release checklist required/failed 摘要、`mcp_modeling_handoff` 和逐 artifact 的 `task_packets` / `mcp_authoring_handoff` 收敛成产品/API/MCP 可读的下一步工作包；`validate-real-world-building-release-artifact-workspace` 会单独输出 `release-artifact-workspace-validation.json/md`，用于 CI 或产品侧验收该工作包的 schema、task packet 覆盖、release checklist required 摘要、direct DSL 阻断、候选消歧传播、VisionEvidence review patch 传播和 MCP authoring handoff 覆盖。这不改变 `ok=false` / fail-closed 语义。

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

`image-structured:vision-evidence-building-group` 是 R12 轻量图片结构化入口：它把 BirdEyeLandCover、HighContrastEdge、OpenCvEdge、VisualRelationGraph、scale anchors、view/ground-plane estimate 和 optional backend status 汇总成 `ObservationSet.vision_evidence_set_v1`，并输出 `structured-plan/vision-evidence-v1-report.json`、`vision-evidence-review-patch.json` 和 `vision-evidence-review-patch.md`。当前 building-group report 为 `verdict=pass`：masks 91、edges 810、accepted edges 528、rejected edges 309、lines 166、regions 961、relations 1384，`planar_groundplan_allowed=true`，top-view ground-plane confidence `0.94`，3 张图都有 per-image ground-plane estimate；top view 的 `usage_policy=planar_groundplan_candidate`，两张 oblique 图保持 `review_only_oblique_context` 并带 `oblique_view_not_planar_groundplan` 风险，`default_heavy_model_required=false`。Review patch 当前为 `status=needs_review`，包含 5 个待确认项，其中 ground-plane 3 个、edge-class policy 2 个，明确 `apply_allowed=false`、`compile_allowed=false`；`image-structured:vision-evidence-review-patch-building-group` 可单独重建该补丁。`image-structured:vision-evidence-review-workbench-building-group` 会生成 `vision-evidence-review/index.html`，页面内嵌 review patch 并导出 `vision_evidence_review_decision`；release gate 会用 headless Chrome CDP 跑该页面导出 `vision-evidence-review.browser-exported.json`。`image-structured:vision-evidence-policy-correction-building-group` 会用 accepted review fixture 生成 `vision-evidence-review.accepted.json`、`vision-evidence-policy-correction-patch.json/md` 和 `vision-evidence-v1.reviewed.json`；该 patch 只允许 `apply_scope=vision_evidence_set_policy_only`，当前 5 个 action 都保持 `compile_allowed=false`、`geometry_promotion_allowed=false`。INSID3/SAM/Grounded-SAM 只记录 optional status，不进入默认成功门；缺 source/confidence/review state、ground-plane 使用策略或人工确认的 evidence 不能进入 promoted geometry。

R12 现在也接入普通建筑 intake / upload-session：`building_single` 的真实图片或 demo crop 会在 `observations.json` 内带 `vision_evidence_set_v1`，并在 intake 根目录写出 VisionEvidence report、review patch、Markdown 和独立 review workbench。建筑单体语义项会以 `semantic_candidate_policy` 出现在 patch 中，例如凹进侧立面、矩形风管/方管、HVAC、上层窗带、首层店面、阴影/凹槽边界；这些项只允许记录人工 policy review，不能把阴影当凹槽、不能把风管当装饰线、也不能把凹进侧立面并入正立面后直接生成几何。

`image-structured:auto-groundplan-building-group` / `image-structured:structured-plan-building-group` 是 R10/R11/R11.2/R12 AutoGroundPlan hardening 门：它在 Grounding v3 前增加 `GroundEvidenceResolver`、`ParkingGridCanonicalizer`、`RoadCorridorBuilder`、rectilinear `PlanarSubdivisionBuilder`、R10.5 `GapCompletionSolver`、R11 `BirdEyeLandCover`、R11.1 `BoundaryGraph`、R11.2 `HighContrastEdge` / `OpenCvEdge`、R12 `VisionEvidenceSet v1`、`VisionEvidenceReviewPatch`、`VisionEvidenceReviewWorkbench`、`VisionEvidencePolicyCorrectionPatch` 和 `StructuredPlan QA`。当前 `structured-plan/structured-plan-qa-report.json` 为 `verdict=review`，但 hard gates 已收紧到 `road_building_overlap_ratio=0`、`raw_contour_leakage=0`、`parent_child_double_occupancy=0`、`canonical_region_overlap_ratio=0`；source-edge + OpenCV + high-contrast fused path 后 site surface 来自 boundary graph `[81,31,738,558]`，`gap_ratio=0.474`、`gap_completion_ratio=0.557`、`remaining_unknown_gap_ratio=0.198`、`road_candidate_review_count=0`、`boundary_road_corridor_count=7`。这个 gap 仍会阻止 photo-grade candidate；R12 的成功点是把所有轻量视觉证据收敛到统一 contract，并继续暴露可解释边线、rejected alternatives、per-image ground-plane 使用策略、optional backend status、review patch、browser-exported review decision、policy correction patch 和 downgrade reason，而不是把 unknown gap 强行压低。默认 HTML 先显示 Bird-eye QA 四联图、R12 path 指示和 Vision review items，structured view 画 canonical subdivision 和带样式的 inferred/review surfaces，raw evidence、layout prior 和 rejected conflicts 只在 diagnostic view 出现。`image-structured:part-graph-building-group-r10-groundplan` 会生成 `part-graph.r10-groundplan.json`，证明 R10/R11/R12 PartGraph path 不再 emit `internal_roads`、`parking_lot` 或 `warehouse_row_*` parent occupancy。

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

当前实现是确定性的 CV baseline：缩放图片、Sobel 边缘检测、主 bbox、coarse contour/polyline、bbox keypoints、垂直对称轴候选、视角启发式分类。Switch 示例会额外读取 `model-plan.example.json` 里的 `views[]` 作为人工视角 hint；ambulance 示例读取 `ProductProfile.reference_images` 作为 view hints；compact remote 示例使用固定 observation fixture 验证第二产品路径。通用 `image-structured:intake` 不传 `--view-hints-file` 时仍走纯 CV 模式；真实建筑 upload-session 会先用 preflight 生成 `view-hints.generated.json` 再调用 intake。它只负责给人工 review、PartGraph 更新和后续 VLM/语义识别提供第一版证据，不直接声称完成照片级 3D 重建。

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
