# 建模任务与通用几何 API 使用指南

本指南覆盖当前源码中的 Agent 任务入口和通用几何 API。正式安装版本以[发布验收](../RELEASE_ACCEPTANCE.md)为准；新源码入口必须同时由实际加载的服务和插件支持。离线检查、已保存文件和原生质量验收分别判断。

## 从一个任务开始

无需读取本地源码，先调用：

```json
{"tool":"start_agent_task","arguments":{"intent":"discover","instruction":"查看支持的建模任务和下一步","inputs":{"topic":"start"}}}
```

随后用 `topic=tasks` 发现全部创建种类；`topic=workflows,task_name=<种类>` 返回可调用模板，包括门窗、柜体、内置配方资产、固定古建和通用中式装配。已有对象的排列/对齐、参数修改、外观与保存也从 workflows 发现。

普通单根任务的流程是 `preflight_model(inputs.task)` → `discover/connect(runtime=queue)` → `create_model`。创建使用同一 task、新鲜 `connection_task_id` 和稳定 `idempotency_key`。保留返回的 `task_id`；响应不确定时 `resume_agent_task`，不换键重建。

多个独立中式装配根选择 `task_name=traditional_scene`，用 `inputs.scene_plan` 代替 `inputs.task`。创建后保留各根来源，局部修改后用 `verify_model(inputs.scene_id)` 重新冻结场景验证；它不承诺原子修改整个场景。详见[装配与场景边界](../traditional-timber/ASSEMBLY.md)。

通过必要质量检查后，重新连接，以已接受的创建或验证任务为 `source_task_id` 调用 `deliver_model`。保存成功后交付文件并结束。仅在用户明确要求关闭/重开专项时使用 `reopen_delivered_model`；日常保存不自动追加该验证。

## 排列、对齐与镜像副本

这些助手通过 `reviewed_existing_model_edit` 的 `inputs.layout_edit` 工作，不增加顶级工具。服务器只读当前完整原生索引，计算明确操作并冻结模型身份/修订，之后仍需原有审阅、连接与提交步骤。不要混入自写 `operations`、`targets`、快照或其他来源计划。

```json
{"version":1,"mode":"array","targets":[{"target_id":"实际根标识"}],"axis":"x","count":4,"spacing_mm":1200}
```

`count` 包含原件；`spacing_mm` 是沿世界 x/y/z 的有符号重复位移，不表示净距。服务器生成稳定的新标识并保留原件。最多生成 100 个操作。

```json
{"version":1,"mode":"align","targets":[{"target_id":"待移动根标识"}],"axis":"z","anchor":"min","reference":{"target":{"target_id":"固定参照根标识"},"anchor":"max"}}
```

对齐使用当前根对象在世界坐标中的真实包围盒；旋转对象仍按世界 min/center/max 计算。参照对象必须与移动目标分开，保持不动。包围盒对齐不等同于实体接触或无碰撞。

```json
{"version":1,"mode":"mirror_copy","targets":[{"entity_path":"pid:实际根组件路径"}],"axis":"x","plane_offset_mm":1500}
```

镜像平面为世界 `x=1500 mm`；始终保留原件，新组件共享定义几何并使用镜像后的完整世界矩阵，不继承原参数来源。本版仅支持具名定义的根 ComponentInstance；组、嵌套目标，以及无法保持的根级材质/标签/隐藏或自定义属性覆盖会明确拒绝。排列和对齐支持根 Group 与 ComponentInstance；所有助手拒绝嵌套目标，不自动扩散到共享定义。需要嵌套编辑时使用既有明确实例隔离的专家计划。

生成计划不是执行或质量通过。审阅批准后重新连接并向原任务补交 `connection_task_id`；发生未知结果时只恢复原任务。

## 四个工具

| 工具 | 用法 | 返回 |
|---|---|---|
| query_model_geometry | 指定 runtime、targets（完整 pid 路径）、recursive 和 max_vertices；detail 默认 summary | model_revision、完整性、上下文概要、snapshot_handle、geometry:// 资源 |
| measure_model_geometry | 传 snapshot_handle 和 queries；kind 为 length/area/volume/distance/angle | 每项 available/unavailable、单位、方法、原因和版本 |
| edit_model_geometry | 传快照、一个 entity_path、edits、稳定 idempotency_key | 复用既有审查任务；需审查时按 next_action 继续 |
| run_model_program | 传最多三个 stages 或使用 task_id 恢复 | 阶段任务、冻结程序摘要、执行后快照句柄 |

显式使用 runtime: queue 访问 SketchUp；默认 mock 便于离线计算。原生写操作仍受服务端策略、Session Contract 和既有审批机制约束。客户端不能传 approved 布尔值绕过审批。

快照是不可变 artifact。读取旧句柄不会伪装成当前模型状态；修改时比较当前版本和文档身份。完整数据通过 MCP resources/read 读取 resource_uri，或显式 detail: full 获取。截断快照不能用于修改或精确测量，应缩小 targets 或提高预算。

长度单位 mm，面积 mm2，体积 mm3，角度 degrees。测量使用世界坐标的边、面和原生三角化；非封闭体返回 unavailable，不返回包围盒体积。距离受 max_pairs 约束。

## 编辑操作与坐标

操作：add_edges、add_face、move_vertices、transform_entities、pushpull_face、reverse_face、erase_entities、set_face_material、set_edge_properties。实际 JSON 合同由 48 工具注册表生成，见 ../tool-registry.md 和 src/model-geometry-contract.mjs。

每批只修改一个实体上下文；coordinate_space 可选 local/world。矩阵是列优先 16 数字，平移单位 mm。点、方向、法线分别计算，奇异矩阵拒绝。共享路径按需 make_unique；回执提供执行后的路径和实体对应，不以序号猜测身份。

编辑提交返回 task_id 后，用同一幂等键查询原任务，不能在 outcome_unknown 后换键盲目重放。需要审查时完成子任务，再恢复父程序。

## 程序 SDK

Expert JavaScript 及受限 Python SDK 可读取 snapshot、previous、parameters、stage。快照只读；阶段间只传 JSON。每阶段经过计划、策略检查、执行和真实回读，下一阶段重新读取。最多三阶段，单阶段最多 100 操作、10,000 循环、20,000 语句、1 MB 结果。此入口不提供任意进程或完整 CPython。

创建阶段返回 `{operations:[...],result:{...}}`；编辑阶段返回 `{entity_path,edits:[...],result:{...}}`。Python SDK 创建阶段通过已有 model 方法生成操作，编辑阶段通过 result 返回上述结构。

三个可复用请求：examples/modeling-uplift/generate.json、local-edit.json、readback.json。按该顺序在专用 mock 会话运行；编辑示例按默认策略可能暂停待审查。改用 queue 时先建立真实连接并确认目标对象范围。不得对未知模型直接运行示例。

## 公共生成操作

sweep_profile：二维无孔简单闭合 profile、三维 path、initial_up、scale_stations/twist_stations、caps。站点 t 在 0..1，扭转值为度。闭合路径需首尾缩放和扭转兼容。

loft_profiles_v2：有序共面 profiles；各截面点数可不同。采用弧长对应、保留角点，seam_indices 显式选择起点，简单凹轮廓端盖三角化。两操作先由公共 JS 层生成 mesh，mock 与 queue 落地相同生成结果。

不支持孔环、分支拓扑、完整 NURBS、任意曲面倒角。检测到退化和自交时拒绝，数值容差和计算预算仍适用。

## 协议

Legacy initialize 支持 2025-06-18、2025-11-25，随后 notifications/initialized。Modern 2026-07-28 请求携带 `_meta` 中的 `io.modelcontextprotocol/protocolVersion` 和 `io.modelcontextprotocol/clientCapabilities`，支持 server/discover；完整结果使用 resultType: complete。

输入错误为 JSON-RPC 错误；工具执行失败为 isError 内容。预览返回原生 image 内容，文件保留旧路径并提供资源链接。内部任务服务不声明为 MCP 可选扩展。

参考：[工具规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)、[Modern discover](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)。

CLI 接受同一 JSON 合同，例如：

```sh
node src/cli.mjs run_model_program --input-file examples/modeling-uplift/generate.json
```

`budget` 可进一步限制 max_operations、max_loop_iterations、max_statements、max_output_bytes，不能超过上述服务端上限。

## 补齐的根级编辑与分页

`edit_model_geometry.entity_path` 现在接受 `model`，仅作用于模型根级散线散面，不递归修改子组或组件。仍须提供查询快照、幂等键，并通过既有审查及原子事务。空根级上下文也可添加面/边。

大对象使用 `query_model_geometry({targets:["pid:123"],page_size:1000,detail:"full"})`。返回的 `page.next_cursor` 非空时，以 `{cursor:next_cursor,detail:"full"}` 继续。页内每条记录是一个顶点、边或面；同一上下文可横跨多页，因此邻接引用可能指向其他页。按 entity_path 和 handle 合并，不按数组序号拼接。

所有页面绑定同一份不可变 snapshot_handle/model_revision。`page.snapshot_complete` 表示服务端捕获是否完整，`page.has_more` 表示是否还有页面；末页不等于一次返回了整份快照。模型改变后仍能读旧页，但旧版本不能继续编辑。完整拓扑保存在 geometry 资源中。捕获有两百万顶点、两千上下文及原有完整版本计算预算的上限；超过捕获预算必须缩小范围，不会把截断快照伪装为完整数据。

## 返回合同

旧工具各自的合同集中于 `src/tool-output-contracts.mjs`，由唯一工具注册表引用。模型快照、实体、文件回执、编译结果、任务信封、QA 和审批计划使用共享字段定义；成功、阻塞及可选返回字段保留兼容。任意程序 result/data、SketchUp 自定义属性与版本化能力扩展使用明确的 JSON 扩展映射。MCP 对实际序列化后的 JSON 进行校验，出错会给出工具名和字段路径。

## 既有警告与程序恢复

创建回执中的 `qa.background_issues` 保留服务端证明未受影响的既有局部警告，`scope_evidence` 说明依据。它不替代模型整体健康检查；没有完整执行前证据的旧任务不会自动放行。

程序绑定为 `snapshot.contexts`，不存在裸 `contexts` 变量。Expert 支持只读 `string.indexOf(search, position?)`，search 为字符串，position 为有限数值。它仍是受限解释器，不代表支持全部 JavaScript API。

程序已提交前序阶段后发生编译失败时，先检查任务日志的 committed_stages 和真实模型。失败任务不会自动复活；可对已确认的模型状态提交剩余阶段的新请求。不得重新提交包含创建阶段的整份程序造成重复对象。

## 开发诊断与离线回归

`queue_diagnostics` 的 `timing` 提供当前服务进程中有界的 `recent_calls` / `recent_task_requests`，可比较 `lock_wait_ms`、`native_dispatch_ms`、`queue_wait_estimate_ms` 与 `response_return_estimate_ms`。这些是阶段时长及墙钟估计，不是性能验收或已提速的证据；旧插件未返回的字段为 `null`。

`npm run regression:check` 运行扩展离线行为回归，`npm run core:check` 保留较快的检查子集。离线回归不代替实机或发布验收；本轮未运行关闭重开专项。

2026-10-15 本地执行 `npm run regression:check`，55 个检查组全部通过（离线、mock 与隔离 Ruby fixtures）。已接入 CI 配置，但本记录不代表远程 CI、已安装插件或原生模型验收。

随后完成本机安装与定向实测，并修复原生默认属性识别和参数预算继承问题。最终离线回归为 56/56，实机六组布局、三步开间修改及四轮抽样接头间距验证通过。安装、文件与明确边界见[本机验证记录](native-validation-2026-10-15.md)。
