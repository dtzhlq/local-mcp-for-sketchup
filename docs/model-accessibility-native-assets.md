# 四工具中的原生资产放置与替换

此路线使用 `start_agent_task` 的既有 `reviewed_existing_model_edit` intent。原生操作新增后，需要重新安装插件并重启 SketchUp，再获取新连接。离线检查不证明 SKP 几何、原生交付或跨模型验收通过。

宿主以 `bridge.options.assetCatalogPath` 配置包含真实 SKP 的目录 JSON。模型先从 `discover` 的 `topic=assets` 读取其中资产的精确 `id`、尺寸、轴向、原点、来源和许可。模型只提交资产 ID，不能传 `catalog_path`、源文件路径或任意 SHA。源文件不存在、不是 SKP、哈希不符或来源/许可未知时会阻止操作；参数配方源码不能当作 SKP，也不能用椅子替代验收题中的凳子。

`inputs.asset_edit` 的合法结构如下。示例中的资产 ID 和目标 ID 是占位说明，执行前必须使用当前目录、模型检查结果中的实际值；坐标和角度来自用户要求。

```json
{
  "intent": "reviewed_existing_model_edit",
  "instruction": "按已明确的资产和放置要求保留完整根组件。",
  "idempotency_key": "为这次请求保留的唯一标识",
  "inputs": {
    "runtime": "queue",
    "save_model": false,
    "asset_edit": {
      "version": 1,
      "mode": "place",
      "asset": { "id": "从服务端目录选择的精确ID" },
      "placement": { "origin_mm": [1000, 600, 0], "rotation_z_deg": 30 }
    }
  }
}
```

`place` 保持源尺寸，根原点为 `origin_mm`，绕世界 +Z 旋转。没有 scale 字段。新根身份由服务器生成；导入不爆炸，不写源文件，不改既有对象。

替换时将 `mode` 改为 `replace` 并增加 `target`，其内容为 `{"entity_path":"pid:实际根persistent ID"}` 或 `{"target_id":"实际唯一根ID"}`，二者只选一个。只支持根级、未锁定、未粘接的 ComponentInstance。放置字段是对现有根原点和刚体朝向的断言；它们不符、目标有缩放或目标是嵌套对象时会拒绝，不推测重新定位。加载新定义与原实例 `definition` 绑定变更在同一事务中完成，保留实例 persistent ID、精确矩阵及人工属性；其他实例继续引用旧定义。

返回的是既有受审计划和批准挑战。通过正常宿主批准及新鲜 `connection_task_id` 提交后才可执行；模型填写 `confirmed=true` 不构成批准。准备完成后，资产、源 SHA、目标和放置内容冻结，改变这些要求需另建计划。加载、放置或保护检查失败会让现有原子事务中止；响应不确定时恢复原任务，不换标识盲目重试。

源 SHA 匹配只绑定文件内容，目录尺寸仍是记录证据。事务完成后还要独立核对完整层级、实物尺寸、根轴向、与桌面的对齐、材质及人工修改，取得近景和独立 SKP 保存/重开证据。`save_model=false` 示例只执行资产操作；它没有完成文件交付，也不能借用其他创建任务的质量通过结论。
