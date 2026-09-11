# 普通模型易用性：15 类任务支持范围

日期：2026-09-11。以下区分接口实现、离线检查与实际使用证据。三模型完整量化已按用户要求移为可选专项，不阻塞本轮接口交付，也未被改报通过。四个公开工具名称及完整 JSON 见[接入指南](model-accessibility-quickstart.md)。

表内 intent 通过 `start_agent_task` 使用；`inputs` 字段须保持嵌套，示例标识须替换为服务端实际返回值。

| 任务 | 实际入口 | 已有证据与限制 |
| --- | --- | --- |
| 1. 参数窗 | `discover` 选 `task_name=window`，然后 `preflight_model → create_model` | GLM-5.3-Flash 已实际创建、通过原生 QA 并保存；原运行随后额外验证超预算，未改报完整成功。 |
| 2. 门 | 同上，`task_name=door` | 输入/配方与缺参检查已实现；仅支持声明的构造和尺寸，未完成本专项完整实机验收。 |
| 3. 柜体 | 同上，`task_name=cabinet` | 配方和参数源已实现；保留质量门禁，不能用预检代替模型质量。 |
| 4. 台面与水槽 | 同上，`task_name=sink_counter` | 真实开孔配方与输入约束已实现；不是任意造型生成器，完整实机专项待验。 |
| 5. 资产查询 | `discover`，`inputs.topic=assets` | 第九轮完成只读查询和 JSON；尺寸、轴向、来源与许可均可读，目录记录不等于新导入测量。 |
| 6. 整根资产放置 | `reviewed_existing_model_edit`，`inputs.asset_edit.mode=place` | 已批准并原生导入椅子，14 项层级补证据通过；使用服务端资产 ID 和明确放置变换。 |
| 7. 排列/对齐 | `understand_model` 后准备 `reviewed_existing_model_edit` 的复制/变换操作 | 专家路径，需自行计算锚点、间距与明确目标；没有通用自动 array/align intent。 |
| 8. 单实例参数修改 | `discover` 的 `inputs.topic=parameter_sources`；`modify_design_parameters` 的 `inputs.parameter_edit.scope=single` | 参数执行/复核已实现，已有离线分根链路；缺来源、过期或人工改动基线拒绝，完整实机待验。 |
| 9. 全部关联实例修改 | 同上，`inputs.parameter_edit.scope=all` | 与 single 共用可信参数源；已有30项离线链路记录，须显式列全共享定义实例，不能混入独立对象。 |
| 10. 单实例资产替换 | `reviewed_existing_model_edit`，`inputs.asset_edit.mode=replace` | 原生替换路径及保护约束已实现，完整实机待验；只接受服务端目录和明确根目标。 |
| 11. 镜像布局 | `understand_model` 后准备 `reviewed_existing_model_edit` 的 `transform_object` | 专家路径，需明确世界镜像轴/pivot及是否保留原件；镜像原件不等于创建副本。 |
| 12. PBR | `apply_native_appearance`，`inputs.appearance.kind=native_pbr` | 原生材质/UV/样式回读通过，已由宿主界面另存 SKP；截图参数已修复，随后共用正式代码的自动截图与保存实机验收通过；完整 Gateway 新任务链路未重跑。 |
| 13. HDR 场景 | `apply_native_appearance`，`inputs.appearance.kind=native_hdr` | 输入/原生路径和定向离线检查已完成，本专项完整实机待验；需真实目录/风格、能力与本人批准。 |
| 14. 局部修正 | 先 `resume_agent_task`；原创建任务可 `submit_agent_task_input` 补 `refinement_code/refinement_part_ids`，已有对象编辑另走受审路径 | 保留冻结要求与每部件三轮上限；这些 refinement 字段不属于受审编辑输入，响应不确定不得重建。 |
| 15. 保存与按需恢复 | `deliver_model`；仅明确要求时另用 `reopen_delivered_model` 与 `saved_delivery_task_id` | 保存后默认交付结束；显式重开功能已实现，但冷重开一致性及参数回绑的完整实机专项仍未证明。 |

资产编辑、参数修改和原生外观的本人批准、新鲜连接及对象保护均保留。参数 `geometry_applied` 不等于质量通过，需以 `verify_model` 冻结复核；外观近景仍需审查。执行状态、质量状态、文件证据和发布声明互不替代。

已有记录：[开发运行补充](model-accessibility-development-results-supplement-2026-09-08.md)、[参数集成](../benchmarks/model-accessibility/parameter-edit-integration.md)、[原生资产与取景](model-accessibility-native-progress-2026-09-08.md)、[PBR宿主辅助交付](model-accessibility-delivery-status-2026-09-11.md)。本表不宣称90%成功率、跨模型增益、完整实机或跨平台发布通过。

后续有限验收：[PBR 自动截图与保存](model-accessibility-capture-save-acceptance-2026-09-11.md)。
