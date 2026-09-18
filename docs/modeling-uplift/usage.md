# 通用建模 API 开发候选

开发分支以发布版 v0.2.0 为基线。运行状态和验收结论见 implementation-status.md；未验证项不等同于已支持。

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
