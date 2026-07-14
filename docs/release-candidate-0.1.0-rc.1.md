# 0.1.0-rc.1 候选构建说明

日期：2026-07-14

状态：**RC live gate 已验证并签发**。fresh SketchUp queue handshake 和串行发布门禁于 2026-07-14 通过；`plugin:check` 仍只是静态包检查，不单独作为 live 证明。

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
- MCP capability suite：34/34 tools 在 mock 模式下被使用或明确 skip；91 registered operations 单独统计。

## Fresh live queue 证据

- `get_capabilities --runtime queue`：SketchUp `26.2.242`，runtime/plugin `0.1.0-rc.1`，91 registered operations，compatibility `ok=true`，issues 为空。
- `qa:mcp-capability-suite -- --runtime queue --queue-required`：34/34 MCP tools 使用，0 missing / 0 skipped；live build/report/capture/iterate 通过并保存 SKP、PNG 和 manifest。图片 adapter 负例确认 blocked / preview-only / `queue_called=false`。
- `qa:queue`：10/10 用例执行成功；其中 9 例为零差异 pass，`boolean-manifold-slice` 保留 14 个已审阅 warning，来自 mock 近似布尔几何与 SketchUp 实体内核的 face/edge/bbox 差异，0 error。
- `qa:identity:queue`：1/1 pass，零差异。`features` 的 absent 与 empty-array 已按可选空集合归一，不再产生虚假 warning。
- `qa:expert:queue`：1/1 pass；`qa:budget:queue`：4/4 pass。
- `qa:official-api-r3:queue`：12 operations，5 groups，10 faces，warnings 0，selection/page/followme/UV 断言通过，保存 SKP。
- `qa:python-sdk-high-value:queue`：8 operations；erase/transform/Page flags/UVQ 全部断言通过，warnings 0，保存 SKP。
- `qa:nested-edit:queue`：definition-wide 影响 2 instances，`make_unique` 只影响 1 instance，Face/Edge editable=false，保存 before/after index、diff、manifest 和 SKP。

## 制品

- RBZ：`out/releases/alma-sketchup-mcp-0.1.0-rc.1.rbz`
- size：67,008 bytes
- SHA-256：`85b09ed13c928fecc60319b9098d771c2057cbcedc9207e38f2c5dc131e37e73`
- manifest：`out/releases/release-manifest-0.1.0-rc.1.json`
- RBZ 功能基线：`346344ec41eacfb31a7ff36e8672034f591ae2e7`
- release manifest 会在最终证据文档提交后以 `--live-status passed` 重建，其 `git.head` 为实际签发 HEAD。

## 签发结论

`0.1.0-rc.1` 满足 fresh handshake 硬门禁和已审阅的发布验收，可将 release manifest 设为 `release_status=rc_candidate_verified` / `rc_signed=true`。唯一非零差异项是上述 boolean mock-vs-kernel warning，已单独列出，不将其改写为完全 parity。

“真实发布级样本”不属于本两周或后续阶段承诺，按约定最后单独讨论。
