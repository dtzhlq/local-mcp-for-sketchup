# 中式古建正式 MCP 入口

使用现有 `start_agent_task`，无需客户端编写 DSL 或运行研究脚本。每个新任务使用新的稳定 `idempotency_key`；响应不确定时用返回的 `task_id` 调用 `resume_agent_task`，不要重复创建。

1. `intent: "discover"`，`inputs: {"topic":"tasks","kind":"traditional_timber","detail":"parameters"}`：读取固定预设、有效参数、范围和来源边界。
2. `intent: "preflight_model"`，`inputs.task` 使用下方对象：仅编译并检查依赖，不写模型。
3. `intent: "discover"`，`inputs: {"topic":"connect","runtime":"queue"}`：取得当前模型的新鲜 `connection_task_id`。
4. `intent: "create_model"`，`inputs` 包含 `task`、`runtime: "queue"`、连接任务 ID 和 `timeout_ms: 300000`。只增加自己的根实例，保留模板人物及其他已有对象。

```json
{
  "version": 1,
  "kind": "traditional_timber",
  "id": "yf-hall",
  "units": "mm",
  "parameters": {"chi_mm": 300, "tile_detail": "light"},
  "placement": {"origin_mm": [0, 0, 0]}
}
```

`chi_mm` 必填；其他默认值及历史解释见 [规则说明](RULES.md)。创建记录固定解析参数、规则版本及内容哈希。不要把相同规则名下的不同内容默认为兼容升级。

## 修改一个实例

用 `discover` 的 `topic: "parameter_sources"`、`runtime: "queue"` 找到实际根实例和 `creation_task_id`。随后创建 `modify_design_parameters` 任务：

```json
{
  "runtime": "queue",
  "timeout_ms": 300000,
  "parameter_edit": {
    "creation_task_id": "返回的原创建任务 ID",
    "scope": "single",
    "targets": [{"entity_path": "返回的实际根路径"}],
    "changes": {"middle_bay_chi": 28}
  }
}
```

瓦面精度可用 `changes: {"tile_detail":"light"}` 显式修改，或与尺寸变更放在同一次指定实例更新中。旧记录不自动切换表示版本。

按任务返回的下一步获取新连接、准备替换及完成本地审阅。仅替换选中根实例，复用未改变的组件定义；其他共享实例保持原样。全局尺度变更允许全量重编译。模型有手工修改、修订变化或规则不匹配时拒绝静默覆盖。

完成后按返回的 `verify_model` 指引查看更新后的同一个整屋。主要装配摘要给出原生边界与指纹；规则预期尺寸单独列出。摘要不是逐面碰撞检查，接头的可见关系仍需看图。

## 交付与恢复

通过 `deliver_model` 使用已接受的源任务和新连接保存交付模型。保存不是重开验收，不要求关闭或重新打开模型。

原生修改已提交但后处理失败时，继续同一个任务完成收尾。未取得可信提交回执时保留未知状态，先检查原模型与请求，不自动再写一次，也不自动删除队列保护锁。
