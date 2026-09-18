# 48 工具合同与验证状态

注册表为 src/tool-definitions.mjs，经 src/tool-registry.mjs 导出；运行时、输入验证、文档生成共用。全部 input schema 已与真实参数验证器核对，声明 output schema 并在 MCP 返回时验证。旧工具 output schema 保留扩展字段，尚未穷举所有可选嵌套结构。

表中原生通过仅代表报告中的指定场景；不宣称 48 工具所有分支均经过本轮原生验收。完整 schema 与 annotations 可从 tools/list 获取。

| 工具 | 合同 | 行为验收 |
|---|---|---|
| query_model_geometry | 已校验 | 选定原生场景通过 |
| measure_model_geometry | 已校验 | 选定原生场景通过 |
| edit_model_geometry | 已校验 | 选定原生场景通过 |
| run_model_program | 已校验 | 选定原生场景通过 |
| inspect_detail_regions | 已校验 | 未逐项重跑 |
| query_assets | 已校验 | 未逐项重跑 |
| capture_detail_views | 已校验 | 未逐项重跑 |
| get_docs | 已校验 | 未逐项重跑 |
| get_workflow_bundle | 已校验 | 未逐项重跑 |
| get_capabilities | 已校验 | 选定原生场景通过 |
| create_queue_handshake | 已校验 | 选定原生场景通过 |
| queue_diagnostics | 已校验 | 未逐项重跑 |
| prepare_image_modeling_brief | 已校验 | 未逐项重跑 |
| compile_reviewed_part_graph | 已校验 | 未逐项重跑 |
| prepare_existing_model_edit | 已校验 | 未逐项重跑 |
| apply_reviewed_model_edit | 已校验 | 未逐项重跑 |
| start_agent_task | 已校验 | 选定原生场景通过 |
| resume_agent_task | 已校验 | 未逐项重跑 |
| submit_agent_task_input | 已校验 | 选定原生场景通过 |
| read_agent_artifact | 已校验 | 未逐项重跑 |
| build_model | 已校验 | 选定原生场景通过 |
| compile_expert | 已校验 | 未逐项重跑 |
| compile_python_sdk | 已校验 | 未逐项重跑 |
| build_expert_model | 已校验 | 未逐项重跑 |
| reset_model | 已校验 | 未逐项重跑 |
| save_model | 已校验 | 选定原生场景通过 |
| save_model_version | 已校验 | 未逐项重跑 |
| open_model | 已校验 | 选定原生场景通过 |
| import_model | 已校验 | 未逐项重跑 |
| export_model | 已校验 | 未逐项重跑 |
| get_model_info | 已校验 | 选定原生场景通过 |
| list_entities | 已校验 | 未逐项重跑 |
| inspect_model | 已校验 | 未逐项重跑 |
| adopt_open_model | 已校验 | 未逐项重跑 |
| resolve_model_targets | 已校验 | 未逐项重跑 |
| get_selection | 已校验 | 未逐项重跑 |
| analyze_selection_geometry | 已校验 | 未逐项重跑 |
| plan_modification_intent | 已校验 | 未逐项重跑 |
| set_selection | 已校验 | 未逐项重跑 |
| capture_view | 已校验 | 选定原生场景通过 |
| run_ruby_expert | 已校验 | 未逐项重跑 |
| evaluate_py | 已校验 | 未逐项重跑 |
| build_report | 已校验 | 未逐项重跑 |
| iterate_model | 已校验 | 未逐项重跑 |
| compare_snapshots | 已校验 | 未逐项重跑 |
| compare_model | 已校验 | 未逐项重跑 |
| validate_model | 已校验 | 未逐项重跑 |
| validate_reference_model | 已校验 | 未逐项重跑 |
