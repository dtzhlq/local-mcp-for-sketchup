# 普通模型首次使用验收报告

证据级别：offline_contract_only。报告只核验已有证据，本次 runner 未调用模型或 SketchUp。

此报告使用未填写的示例配置测试失败关闭行为；其中缺失访问/费用字段不代表用户当前授权状态或 Alma 实际可用模型。

固定集合：acceptance；要求 258 次运行，收到 0 次。跨模型验收：未通过。发布验收：未完成。

| 模型档位 | 路径 | 正例通过 / 固定总数 | 有效实机证据 | 负例通过 / 固定总数 | 每个成功任务模型成本 |
| --- | --- | --- | --- | --- | --- |
| low_cost | baseline | 0 / 30 | 0 | 0 / 13 | 无可核验成本 |
| low_cost | optimized | 0 / 30 | 0 | 0 / 13 | 无可核验成本 |
| midrange | baseline | 0 / 30 | 0 | 0 / 13 | 无可核验成本 |
| midrange | optimized | 0 / 30 | 0 | 0 / 13 | 无可核验成本 |
| strong_reference | baseline | 0 / 30 | 0 | 0 / 13 | 无可核验成本 |
| strong_reference | optimized | 0 / 30 | 0 | 0 / 13 | 无可核验成本 |

未采集运行的 0 / 固定总数表示缺少完成证据，不表示已观测到模型失败。负例不进入正例完成率；强模型不补足普通模型成绩。

## 阻塞项

- missing_source_revision
- missing_sketchup_version
- missing_plugin_version
- missing_source_sha256
- missing_runtime_capabilities_sha256
- missing_mcp_server_snapshot_sha256
- missing_fixture_snapshot:window.development
- missing_fixture_snapshot:window.acceptance_a
- missing_fixture_snapshot:window.acceptance_b
- missing_fixture_snapshot:window.release_holdout
- missing_fixture_snapshot:door.development
- missing_fixture_snapshot:door.acceptance_a
- missing_fixture_snapshot:door.acceptance_b
- missing_fixture_snapshot:door.release_holdout
- missing_fixture_snapshot:cabinet.development
- missing_fixture_snapshot:cabinet.acceptance_a
- missing_fixture_snapshot:cabinet.acceptance_b
- missing_fixture_snapshot:cabinet.release_holdout
- missing_fixture_snapshot:sink_counter.development
- missing_fixture_snapshot:sink_counter.acceptance_a
- missing_fixture_snapshot:sink_counter.acceptance_b
- missing_fixture_snapshot:sink_counter.release_holdout
- missing_fixture_snapshot:asset_query.development
- missing_fixture_snapshot:asset_query.acceptance_a
- missing_fixture_snapshot:asset_query.acceptance_b
- missing_fixture_snapshot:asset_query.release_holdout
- missing_fixture_snapshot:asset_place.development
- missing_fixture_snapshot:asset_place.acceptance_a
- missing_fixture_snapshot:asset_place.acceptance_b
- missing_fixture_snapshot:asset_place.release_holdout
- missing_fixture_snapshot:array_align.development
- missing_fixture_snapshot:array_align.acceptance_a
- missing_fixture_snapshot:array_align.acceptance_b
- missing_fixture_snapshot:array_align.release_holdout
- missing_fixture_snapshot:edit_single.development
- missing_fixture_snapshot:edit_single.acceptance_a
- missing_fixture_snapshot:edit_single.acceptance_b
- missing_fixture_snapshot:edit_single.release_holdout
- missing_fixture_snapshot:edit_linked.development
- missing_fixture_snapshot:edit_linked.acceptance_a
- missing_fixture_snapshot:edit_linked.acceptance_b
- missing_fixture_snapshot:edit_linked.release_holdout
- missing_fixture_snapshot:asset_replace.development
- missing_fixture_snapshot:asset_replace.acceptance_a
- missing_fixture_snapshot:asset_replace.acceptance_b
- missing_fixture_snapshot:asset_replace.release_holdout
- missing_fixture_snapshot:mirror_layout.development
- missing_fixture_snapshot:mirror_layout.acceptance_a
- missing_fixture_snapshot:mirror_layout.acceptance_b
- missing_fixture_snapshot:mirror_layout.release_holdout
- missing_fixture_snapshot:native_pbr.development
- missing_fixture_snapshot:native_pbr.acceptance_a
- missing_fixture_snapshot:native_pbr.acceptance_b
- missing_fixture_snapshot:native_pbr.release_holdout
- missing_fixture_snapshot:native_hdr.development
- missing_fixture_snapshot:native_hdr.acceptance_a
- missing_fixture_snapshot:native_hdr.acceptance_b
- missing_fixture_snapshot:native_hdr.release_holdout
- missing_fixture_snapshot:local_repair.development
- missing_fixture_snapshot:local_repair.acceptance_a
- missing_fixture_snapshot:local_repair.acceptance_b
- missing_fixture_snapshot:local_repair.release_holdout
- missing_fixture_snapshot:save_reopen_resume.development
- missing_fixture_snapshot:save_reopen_resume.acceptance_a
- missing_fixture_snapshot:save_reopen_resume.acceptance_b
- missing_fixture_snapshot:save_reopen_resume.release_holdout
- missing_fixture_snapshot:negative.missing_dimensions
- missing_fixture_snapshot:negative.invalid_dimensions
- missing_fixture_snapshot:negative.wrong_reference
- missing_fixture_snapshot:negative.unsupported_native_hdr
- missing_fixture_snapshot:negative.quality_failure
- missing_fixture_snapshot:negative.uncertain_response
- missing_fixture_snapshot:negative.frozen_requirement
- missing_fixture_snapshot:negative.manual_edit_guard
- missing_fixture_snapshot:negative.ambiguous_scope
- missing_fixture_snapshot:negative.name_conflict
- missing_fixture_snapshot:negative.unsupported_window_form
- missing_fixture_snapshot:negative.unsupported_door_handedness
- missing_fixture_snapshot:negative.unsupported_leaf_thickness
- missing_model_provider:low_cost
- missing_model_model_id:low_cost
- missing_model_model_version:low_cost
- missing_exact_model_configuration:low_cost
- missing_model_provider:midrange
- missing_model_model_id:midrange
- missing_model_model_version:midrange
- missing_exact_model_configuration:midrange
- missing_model_provider:strong_reference
- missing_model_model_id:strong_reference
- missing_model_model_version:strong_reference
- missing_exact_model_configuration:strong_reference
- three_distinct_attestable_models_required
- missing_public_mcp_description_snapshot:baseline
- missing_public_mcp_description_snapshot:optimized
- resources:currency
- resources:explicit_cost_cap
- resources:cost_not_authorized
- resources:live_window
- valid_pre_execution_freeze_required
- missing_live_run_evidence:258

完整 JSON 按模型、路径、任务类别列出缺失项、未通过项、人工介入、修正、调用、费用和实机时间；比较只在完整配对证据存在时计算。
