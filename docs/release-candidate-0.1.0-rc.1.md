# 0.1.0-rc.1 候选构建说明

日期：2026-07-14

状态：**候选包已构建，RC 未签发**。原因是 fresh SketchUp queue handshake 超时；`plugin:check` 和安装后的 Ruby 语法检查不替代 live queue 证明。

## 本轮发布关键切片

- optional Python SDK `result` 兼容：未定义时省略，`None` 保留为 `null`，非法值 fail closed。
- 12 例官方风格 source compatibility corpus：11 例编译，1 例以稳定 unsupported reason 拒绝。
- 高频 facade API 第一刀：`Entities.erase_entities`、`Entities.transform_entities`、`Page.update(flags)` 和受限同脚本 Face UVHelper 查询。
- nested group/component instance 安全编辑：稳定 `entity_path`、显式 `definition_wide` / `make_unique` 策略；Face/Edge 不开放几何修改。
- 两个 image artifact MCP adapter：当前 `tools/list` 为 34；只消费路径化、schema-valid、review-cleared 制品，并默认生成 DSL preview，不调用 queue。

91 个 registered operations 仍只是 safe JSON DSL registry，不等于完整 SketchUp API。`ModificationIntent` 仍是可审计门控编排层，不是自主语义智能体。

## 离线证据

- `npm test`：pass；91 manifest/mock/Ruby operations，56 component-scope operations。
- `npm run test:image-structured`：pass；tier0=8、tier1=5、false promotion=0。
- `npm run plugin:check`：pass。
- Official API R3 mock：12 ops / 5 groups / 16 faces / warnings 0。
- high-value SDK mock：8 ops，7 assertions pass。
- nested edit mock：definition-wide 2 instances，make-unique 1 instance，Face/Edge editable=false。
- image adapter：88-op preview；缺 review 时不写 DSL；queue_called=false。
- Expert mock、4 项 performance budget、10 项 mock QA：pass。

## 制品

- RBZ：`out/releases/alma-sketchup-mcp-0.1.0-rc.1.rbz`
- size：67,008 bytes
- SHA-256：`85b09ed13c928fecc60319b9098d771c2057cbcedc9207e38f2c5dc131e37e73`
- manifest：`out/releases/release-manifest-0.1.0-rc.1.json`
- source HEAD：`346344ec41eacfb31a7ff36e8672034f591ae2e7`

## RC 解锁顺序

1. 解锁 Mac，完全退出并重新打开 SketchUp 2026，确认加载 `0.1.0-rc.1` 插件。
2. 运行 `node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000`；必须 compatibility ok 且无 issues。
3. 串行运行 `qa:queue`、`qa:budget:queue`、`qa:identity:queue`、`qa:expert:queue`、`qa:official-api-r3:queue`、`qa:python-sdk-high-value:queue`、`qa:nested-edit:queue`。
4. 保存新的 queue JSON/SKP，再以 `--live-status passed` 重建 release manifest；只有此时 `rc_signed` 才能为 true。

“真实发布级样本”不属于本两周或后续阶段承诺，按约定最后单独讨论。
