# Queue Runtime 验收与排障

更新时间：2026-07-15

本文是 SketchUp queue runtime 的手动验收清单和故障排查入口。自动化回归仍以 `npm test`、`npm run qa:mock`、`npm run qa:queue` 和单例 `compare_model` 报告为准；手动验收用于确认插件加载、版本漂移、视觉结果和 SketchUp 侧限制。

## 快速验收顺序

`npm run qa:mcp-capability-suite` 默认仅运行 mock，不发送 queue 请求。只有显式使用下列参数才能进入 live queue：

```bash
ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue \
ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1 \
ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION=1 \
  npm run qa:mcp-capability-suite -- --runtime queue --queue-required --timeout-ms 180000
```

该命令会在运行前警告，并会重置/修改当前 SketchUp 模型。未确认当前模型可被覆盖时不得运行。SIGINT/SIGTERM/异常退出会按进程 owner 清理仍未 claim 的 queue request 和 lock，不会删除其他 queue 进程的文件；已 claim processing 或未观测 response 作为执行证据保留。

上述第三个开关只用于用户直接运行的本地 expert/QA host。长驻 MCP/HTTP 服务默认不应开启它；只配置 Agent Gateway queue permission 时，Agent 仍无法用 handshake 直接调用 `reset_model` / `build_model` 等 expert mutation。Session Contract 只证明 freshness，不代表授权。

capability suite 的 operation showcase 含有有意分散摆放的独立几何，因此只关闭通用 `unanchored_detail` 启发式，不关闭碰撞检查。mock/live 的 `build_report` 和 `iterate_model` 都必须返回 `model_qa.verdict=pass` 且零 issue；末尾还会记录 `queue/processing/responses=0` 与 `lock.exists=false`，任一条不满足都不得产生顶层 pass。

1. 确认插件已加载：

```bash
node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000
```

通过标准：

- `runtime.name` 为 `queue`。
- `runtime.compatibility.ok` 为 `true`。
- `runtime.compatibility.issues` 为空。
- `runtime.supported_operations` 数量与 `src/capabilities.mjs` 的 registry 一致。
- `runtime.plugin_version` 是本次安装后的版本；如果仍是旧版本，需要完全退出并重新打开 SketchUp。

`get_capabilities` 只证明 live plugin 可应答，不再充当修改授权。任何 live mutating tool 之前必须显式创建短时 Session Contract：

```bash
node src/cli.mjs queue_diagnostics --include-files
node src/cli.mjs create_queue_handshake --timeout-ms 10000 --expires-in-ms 120000 --output-file output/session-contract.json
```

`create_queue_handshake` 只读取当前 plugin session、document/model identity、model revision、plugin/server/capability versions 和 queue state。它不会创建、打开、reset、adopt、选择、保存、capture 或修改当前 SketchUp 模型。queue 中存在 lock、stale lock、pending request、崩溃后的 claimed processing request 或 orphan response 时会 fail closed，不会自动清理并继续。

通过 Session Contract 的 live mutation 还会在 raw queue request 内携带 transport guard。Ruby plugin 会在 dispatch 前再次校验 session、document、plugin/capability/manifest/DSL version。起始 model revision 会保留到第一个真正的模型写入（例如 `build_model` / `reset_model` / `import_model` / 写入式 `adopt_open_model` / `run_ruby_expert`）；先行的 `set_selection` / `capture_view` / 普通 save / export 不会消耗它，因此这些 UI/制品操作与后续 geometry mutation 之间的手工漂移仍会 fail closed。`save_model` / `save_model_version` 使用 `keep_session=false` 时会在 Ruby 侧 reset 当前模型，因此该变体按真实模型写入处理。`open_model` 发出 document switch 后，旧 guard 在当前执行上下文中立即失效；后续操作必须 inspect 新 active model 并创建 fresh handshake。因此未 claim 的旧 request 即使跨 SketchUp 重启保留，也不得在新 plugin session 中执行。

正式 real-model reliability runner 对大模型使用 server-internal atomic fresh authorization：在同一 Node queue lock 内完成一次 `get_session_state` 全局 revision 扫描、签发并校验短时 Session Contract，然后立即发送带 transport guard 的目标操作。它消除了签发后在 Node 侧重复的第二次全局 revision 扫描；Ruby plugin 仍在 dispatch 前独立复算并校验 revision，因此 stale model、document switch、版本漂移和并发 queue client 仍会 fail closed。该优化只用于服务端已明确选择的单次 QA mutation，不改变公共 MCP 的显式 handshake 合同，也不把 Session Contract 当成用户审批。

macOS 多文档路由在每个 queue request 开始时以 `Sketchup.active_model` 为权威来源，`AppObserver` 只作为提示；同一 request 会锁定该 Model，保证 transport guard 与实际读写不会跨文档。`open_model` 返回 `pending_mdi_activation` 时，不要仅凭窗口看起来在前台就认为激活完成；在 SketchUp「窗口」菜单中显式选中 target，然后以只读 `get_model_info.source_path` 或 `get_session_state.model_identity.source_path` 核对。路径不匹配时不得创建 mutation handshake。

把返回文件传给下一次 live 修改：

```bash
node src/cli.mjs build_model --runtime queue --code-file examples/demo-room.json --session-contract-file output/session-contract.json --timeout-ms 60000
```

修改完成后 model revision 通常已经变化；下一次独立 live 修改应重新创建 handshake。单个 CLI 命令也可以显式使用 `--fresh-handshake`，它会在同一命令内先走相同的只读握手路径：

```bash
node src/cli.mjs compare_model --code-file examples/demo-room.json --expected-runtime mock --actual-runtime queue --fresh-handshake --timeout-ms 60000
```

显式 `--runtime queue` 的仓库 QA 脚本会在每个高层 live 修改前创建并传入 fresh Session Contract；默认 mock 测试不会创建 queue 目录或触碰 SketchUp。

### 可丢弃副本的范围化自动授权

S2-S4 默认仍需要本机真人审批页。若用户已经把一组模型明确作为可丢弃副本授权给本机服务，可在启动 Agent Gateway 进程前配置服务器侧策略：

```bash
ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue \
ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1 \
ALMA_SKETCHUP_TRUSTED_COPY_AUTO_APPROVAL=1 \
ALMA_SKETCHUP_TRUSTED_COPY_ROOTS='/absolute/disposable/root:/another/copy/root' \
ALMA_SKETCHUP_TRUSTED_COPY_AUTO_APPROVE_RISKS=S2,S3,S4 \
ALMA_SKETCHUP_TRUSTED_COPY_MAX_AFFECTED_INSTANCES=10 \
ALMA_SKETCHUP_TRUSTED_COPY_ALLOW_SAVE=0 \
  node src/mcp-server.mjs
```

macOS/Linux 的多个 root 使用平台 path delimiter `:` 分隔。策略只来自可信进程环境，不能放进 Agent task、client capabilities 或模型内容；公开 task 只显示 root 数量和 scope fingerprint，不回显实际路径。活动模型的 canonical source path 必须位于某个 root 内，risk、级联影响后的 affected count 和 save 行为也必须匹配。默认 `ALLOW_SAVE=0`，因此允许修改当前内存模型不代表允许覆盖磁盘副本。

即使该策略返回 `approval_status=server_policy_scoped_auto_approved`，仍必须遵守完整 plan hash、model revision、operation scope、fresh Session Contract、queue idle、idempotency 和 finalized receipt 门禁。删除等破坏操作必须把 SketchUp 可预见的级联清理纳入 `destructive_side_effects` 和 affected budget；未声明的额外消失对象不得验收。目录外模型或策略漂移自动回到 `request_user_approval`，不会降级为 Agent 自批。

受控 S4 验证器为 `scripts/run-controlled-s4-delete-live.mjs`。必须显式提供当前已打开副本的 `--model-path` 和独立 `--output-dir`，先运行 `prepare`，核对输出中的 exact target、expected empty-parent cleanup、policy summary 和 `live_mutation_performed=false`，再运行一次 `apply`。它固定 `save_model=false`，并要求结束时 target/parent 缺失、revision 改变、receipt finalized、queue `0/0/0` 且无 lock。严格单模型证据见 [`evidence/controlled-s4-delete-live-evidence-2026-07-22.json`](evidence/controlled-s4-delete-live-evidence-2026-07-22.json)；它不是通用 S4 或发布验收。

### `import_model` 的 replace 安全边界

`import_model(mode=replace)` 仅保留给 mock artifact 离线测试。queue runtime 会在 live policy、Session Contract 和 queue dispatch 之前返回 `OPERATION_NOT_ALLOWED`，不创建 request/lock，也不改动当前 SketchUp 模型。queue 中需保留当前模型时使用 `mode=append`；需要替换 active document 时，先保存/确认当前工作，然后改用 `open_model`。

2. 跑离线基线：

```bash
npm test
npm run qa:mock
```

通过标准：

- contract 输出 manifest / mock dispatch / Ruby dispatch 数量一致。
- mock QA index Verdict 为 `pass`。

3. 跑 queue golden set：

```bash
npm run qa:queue
```

`npm run qa:queue` 默认使用 180s queue timeout。不要和其他 queue 命令并行运行；当前插件通过单个 SketchUp timer 串行消费 file queue。

通过标准：

- `output/qa-reports/queue/index.md` 的 10 个样例均 `OK: true`；聚合 Verdict 可为 `review`，因为 boolean mock 近似与 SketchUp solid kernel 的已审阅差异会保留 warning。
- 默认允许 `--face-tolerance 1 --edge-tolerance 3`，用于吸收 SketchUp 真实拓扑和 mock 估算的轻微差异。

4. 对高风险 slice 单独出报告：

```bash
node src/cli.mjs compare_model --code-file examples/appearance-texture-slice.json --expected-runtime mock --actual-runtime queue --fresh-handshake --timeout-ms 60000 --face-tolerance 1 --edge-tolerance 3 --format markdown --output-file output/appearance-texture-queue-report.md
node src/cli.mjs compare_model --code-file examples/boolean-manifold-slice.json --expected-runtime mock --actual-runtime queue --fresh-handshake --timeout-ms 180000 --tolerance-mm 20 --face-tolerance 2 --edge-tolerance 4 --format markdown --output-file output/boolean-manifold-queue-report.md
node src/cli.mjs compare_model --code-file examples/golden-product.json --expected-runtime mock --actual-runtime queue --fresh-handshake --timeout-ms 180000 --face-tolerance 1 --edge-tolerance 3 --format markdown --output-file output/golden-product-queue-report.md
node src/cli.mjs build_model --runtime queue --fresh-handshake --timeout-ms 60000 --code-file examples/text-3d-slice.json
```

通过标准：

- Markdown 报告 Verdict 为 `pass`。
- Total diffs 为 `0`，或仅存在明确记录过的 topology tolerance 差异。
- Warnings 只包含预期 warning，例如旧 SketchUp 版本的 `material.pbr_unsupported` 或缺失贴图路径的 `material.missing_texture`。

## Queue 诊断与视口捕获

不确定 Bridge 是否在处理请求时，先跑本地诊断。它不会向 SketchUp 写请求，只检查 queue/response 目录和 lock 文件：

```bash
node src/cli.mjs queue_diagnostics --include-files
```

通过标准：

- `lock.exists=false`，或 lock 未 stale 且确实有另一个 queue 命令在运行。
- `queue.count=0`，否则说明有未处理请求。
- `processing.count=0`，否则说明有已被 plugin claim、但未正常返回的请求；这些文件不会自动重放。
- `responses.count=0`，否则说明有中断命令留下的孤儿 response。

### 精确恢复单个孤儿 response

只有在已经核对孤儿 response 的来源和预期结果类型后，才可使用 `recover_queue_response`。它要求提供完整 canonical request id、稳定的 `result.kind`，并建议同时提供 request id 中绑定的 client PID：

```bash
node src/cli.mjs recover_queue_response \
  --request-id 45590-1784548982275-97afa5c7-10e3-4781-bb9a-8f8f6f21db49 \
  --expected-result-kind queue_session_state \
  --expected-client-pid 45590
```

恢复前先运行 `queue_diagnostics --include-files`，并确认：

- `queue.count=0`、`processing.count=0`，且不存在其他正在执行或等待执行的请求；
- `lock.exists=false`；恢复命令遇到现有 lock 会直接失败，不等待或越过 owner；
- `responses/` 中恰好只有一个 JSON 文件，而且文件名精确等于 `<request-id>.json`；
- `--expected-client-pid` 与 request id 第一段 PID 一致，`--expected-result-kind` 与 response 内稳定的 `result.kind` 一致。

该命令不会向 `queue/` 写入请求，也不会调用 SketchUp 或修改当前模型。它只在本地读取并验证目标 response；完整 envelope、文件类型与身份、request id、PID、result kind 或 idle 条件任一不匹配时均 fail closed，保留 response 并返回稳定错误。只有所有检查通过后才删除这一个已观测 response，并返回 `queue-response-recovery.v1` 结果；其他 response、processing、request 和 lock 均不会被顺手清理。它不能用于猜测性清理，也不能把 mutation 的 outcome-unknown 自动判为成功。

SketchUp Bridge 可用后，可以保存当前或标准视角截图作为可见证据：

```bash
node src/cli.mjs capture_view --runtime queue --fresh-handshake --view iso --width 1280 --height 720 --path output/queue-capture.png --timeout-ms 60000
```

`capture_view` 会返回图片路径、文件大小、相机参数和模型摘要。它是 live queue 证据辅助工具，不替代 snapshot、layout QA 或 reference visual QA。

## Gated Ruby Expert 调试入口

`run_ruby_expert` 只用于本地调试和 SketchUp Ruby API 能力探测，不是建模验收路径，也不能替代 JSON DSL、operation registry、snapshot compare 或 QA gates。默认调用会返回 `blocked:true`，不会向 SketchUp 发送执行请求。

要启用它，Node 命令和 SketchUp 插件进程都必须设置同一个环境变量。macOS 上通常需要从带 env 的终端启动 SketchUp，不能只在 CLI 命令前加 env：

```bash
ALMA_SKETCHUP_ENABLE_RUBY_EXPERT=1 node src/cli.mjs run_ruby_expert --runtime queue --fresh-handshake --code 'Sketchup.active_model.title' --audit-path output/ruby-expert-audit.json --timeout-ms 60000
```

通过标准：

- 未设置 env 时返回 `enabled=false`、`blocked=true`。
- 真正执行时返回 `ok`、`stdout`、`stderr`、`result` 或 `error`。
- 每次插件侧调用都会写入 `audit_path`，默认在 `~/.sketchup-mcp-replica/audit/`。

## 手动视觉检查项

| 能力组 | 样例 | 检查点 |
|---|---|---|
| 身份与编辑 | `examples/editing-identity.json` | `id` / `target_id` 编辑链可执行；rename 后仍能继续 set material / transform / visibility / delete；隐藏对象不计入 totals 和 bbox |
| Transform | `examples/transform-chain-regression.json`、`examples/component-transform-composition.json`、`examples/transform-local-matrix.json` | group 与 component instance 的 center pivot、本地轴、模型轴、平移、matrix/local_matrix 叠加方向正确；matrix decomposition metadata 回传 translation、basis axes、scale、shear、determinant 和 mirrored |
| Profile | `examples/profile-edge-cases.json` | 凹多边形、多洞、`xz` 竖向 profile 和 component_definition 内嵌 profile 成功；洞外、洞重叠等失败样例返回结构化 error |
| 组织元数据 | `examples/metadata-organization-slice.json` | Tags/Layers、attributes、classification snapshot 字段回传；SketchUp attribute dictionary 中有镜像数据 |
| Appearance | `examples/appearance-texture-slice.json` | `texture_transform`、planar/box UV metadata、image plane 和 component_definition 内嵌 image plane 均回传；贴图缺失只 warning 不失败 |
| Text 3D | `examples/text-3d-slice.json` | queue 中应生成真实字体轮廓 3D text；snapshot kind 为 `text_3d`，`Text3D` attribute metadata 回传；mock bbox 是估算值，最终以视觉检查为准 |
| 产品/建筑 golden | `examples/golden-product.json`、`examples/golden-architecture.json` | 组件复用、曲面 helper、建筑 helper、scene/style/shadow 保存稳定；bbox 和主要 group/instance 数量与报告一致 |

## Queue 常见故障

| 现象 | 常见原因 | 处理 |
|---|---|---|
| `HANDSHAKE_REQUIRED` / `HANDSHAKE_INVALID` | live mutating tool 没有收到签名 Session Contract，或字段/签名被改动 | 重新运行 `create_queue_handshake`，把完整 `session_contract` 传入修改调用 |
| `HANDSHAKE_EXPIRED` | 超过短时 `expires_at` | 在执行前立即重新创建 handshake |
| `HANDSHAKE_SERVER_RESTARTED` / `HANDSHAKE_SESSION_MISMATCH` | MCP server 或 SketchUp Bridge/plugin session 在握手后重启 | 重新确认版本与 active model，再创建 handshake |
| `HANDSHAKE_DOCUMENT_MISMATCH` / `HANDSHAKE_MODEL_IDENTITY_MISMATCH` | 用户切换或重新打开了模型 | 检查当前模型，重新 plan/review，并创建 handshake |
| `HANDSHAKE_MODEL_REVISION_MISMATCH` | 模型在握手后被手工或其他工具修改 | 重新 inspect/prepare plan，再创建 handshake；不要复用 stale approval/plan |
| `HANDSHAKE_PLUGIN_VERSION_MISMATCH` / `HANDSHAKE_CAPABILITIES_MISMATCH` | plugin、manifest、capability 或 DSL contract 发生漂移 | 完全重启 SketchUp，重新 `get_capabilities` 和 handshake |
| `QUEUE_LOCK_PRESENT` / `QUEUE_STALE_LOCK` | 另一个命令持锁，或存在残留 lock | 先确认 owner；stale lock 仅在确认无运行命令后人工清理 |
| `QUEUE_REQUESTS_PENDING` / `QUEUE_RESPONSES_PENDING` | 残留 queue request、崩溃后 processing request 或 orphan response | 用 `queue_diagnostics --include-files` 审计；processing 不会自动重放；确认 owner/状态后再清理，不自动越过 |
| `get_capabilities` 超时 | SketchUp 未打开、Bridge 未启动、插件 timer 停止、SketchUp 正在处理大模型 | 打开 SketchUp，执行 `Extensions/Plugins -> Alma SketchUp MCP -> Start Bridge`，再用 `--timeout-ms 10000` 重试 |
| 点击 `Start Bridge` 后出现 `stopped` / `is running` 两个阻塞提示 | 安装目录仍是旧的 modal lifecycle 实现；第一个提示关闭前尚未重建 timer，第二个提示关闭前 timer 也不能处理 queue | 先关闭两个提示再诊断；随后安装当前插件并完全重启 SketchUp。当前源码的 Start 是幂等的，重复点击保留 timer/session，Start/Stop 成功反馈均为非模态状态栏信息；`test/sketchup-plugin-bridge-lifecycle-contract.mjs` 固定该行为 |
| 插件版本仍是旧值 | Ruby 文件已复制但 SketchUp 没有重载 | 完全退出 SketchUp 后重新打开；菜单 stop/start bridge 不能重载 Ruby 源文件 |
| `runtime.compatibility.issues` 有缺失 operation | 安装目录缺少主文件或拆分后的子文件 | 重新复制 `alma_sketchup_mcp.rb` 和 `alma_sketchup_mcp/` 子目录，再重启 SketchUp |
| SketchUp 启动时报 `LoadError` | `require_relative` 指向的拆分文件未复制 | 确认 Plugins 目录存在 `alma_sketchup_mcp/` 子目录里的 operation registry、object/material/geometry/primitive/product/profile/surface/demo/architecture/component/view/snapshot 文件 |
| queue 请求卡住 | 上一个请求还在执行、队列/已 claim 文件残留、响应目录不可写 | 先确认 SketchUp 不在处理模型，再检查 `~/.sketchup-mcp-replica/queue/`、`processing/` 和 `responses/`；不要在请求运行中删除文件 |
| queue lock 超时 | 另一个 Node 进程正在持有 `queue-runtime.lock` 跑 queue 命令，或上次进程异常退出留下未过期 lock | 等当前命令结束后重试；确认没有 queue 命令运行时，可删除 `~/.sketchup-mcp-replica/queue-runtime.lock` |
| `material.missing_texture` warning | 贴图路径不存在或相对路径不是预期工作目录 | 用绝对路径，或接受 warning；缺失贴图不会中断建模 |
| PBR 字段被跳过 | SketchUp 版本缺少对应 Ruby Material API | 检查 warning 是否为 `material.pbr_unsupported`；在不支持版本中只验证 base color/alpha/texture |
| golden product 超时 | 曲面、组件和保存耗时超过默认 timeout | 用 `--timeout-ms 180000` 单独跑高成本样例 |
| OneDrive 偶发 `ETIMEDOUT` | 云盘同步干扰文件读取 | 重跑当前命令；看变更时优先用 `git diff --name-only` 过滤 mode-bit 噪声 |

Agent Gateway 对“尚未进入授权执行回调”的 `HANDSHAKE_*`、`QUEUE_*` 和 `POLICY_DENIED` 不再把 task 置为 terminal `failed`：create/verify 会进入 `awaiting_input`，reviewed edit 会保留 `awaiting_review`，而 document/model/revision/version drift 会要求回到 `awaiting_input` 重新规划。`resume_agent_task` 和相同 idempotency key 的 replay 会保留原 `ok=false`/error envelope；按 `next_action` 提供新的 handshake、plan 或 policy 后，应使用新的 idempotency key 继续同一 `task_id`。一旦已进入 `executing`/`verifying`，后续错误仍 fail closed，避免模型可能已修改时自动重复执行。

大模型 Group proposal→reviewed-plan 的只读现场命令为 `npm run qa:current-source-reviewed-plan-readonly:queue`。它固定要求 `--runtime queue --queue-required --disposable-copy-confirmed`、hash-bound `.disposable.skp`、allowed-root 与 clean queue；命令只创建 proposal 和隔离 state dir 中的 pending challenge，不运行本机审批页、不写 decision/token、不 submit apply、不 save/capture/switch model。非拓扑 Group property edit 可以用 `existing-edit-target-validation.v1` 做第二次 exact Group probe；plan `.3` 将该记录与批准后的 `existing-edit-execution-target-validation.v1` policy 同时绑定进 plan/review hash。只有 server-bound、exact、`definition_wide` Group property edit 可在实际执行各阶段保留 bounded structural observation；`make_unique`、破坏/拓扑/Face/Edge 仍 full recursive。这个只读命令不会验证 mutation path。结束时必须再次验证 signed handshake、model bytes/revision/document/modified state 和 queue `0/0/0`、无 lock。

## Transaction 与 queue response 持久化边界

- Ruby `reset_model`、`build_model`、写入式 `adopt_open_model` 和 queue `import_model(mode=append)` 在同一 SketchUp transaction 内完成修改、snapshot/readback 和 JSON 可序列化检查，然后才调用 `commit_operation`。commit 成功才返回 `mutation_receipt.v1`；只有 commit 调用之前的异常才会 abort。一旦开始 commit attempt，`false` 或异常都是 `outcome_unknown`，不再调用 abort，也不宣称 rollback。
- `save_model` 先完成只读 snapshot/JSON 检查，再调用 SketchUp save；必须同时收到 `true` 且目标是实际文件才返回成功。save 自身不再预先写 document sidecar，避免 save 失败时留下未声明的模型属性变更；sidecar 由真正的修改 transaction 负责持久化。
- response 使用 `responses/` 同目录私有 temp，完成 flush/fsync 后 atomic rename 到 `<request-id>.json`。只有 final response 可靠落盘后 plugin 才删除 `processing/` claim；写入失败会保留 claim、停止后续 queue 执行并禁止自动重放。
- Node timeout/SIGINT/SIGTERM 只清理仍在 `queue/` 的未 claim 自有 request 和 owner lock。已 claim 的 `processing/` 以及尚未被 call loop 成功解析的 atomic response 都保留；它们可能是“SketchUp 已执行，task 尚未持久化”的唯一证据。只有正常 call loop 已观测并解析完整 response 后才清理该 pair。任一残留都会让 fresh handshake 以 `QUEUE_REQUESTS_PENDING` 或 `QUEUE_RESPONSES_PENDING` fail closed，需要人工核对 active model、request 与 response 后才能清理。
- 正式 real-model reliability runner 对中断清理再做一层窄化分类：只有 `get_capabilities`、`get_session_state`、`get_active_model_identity`、`inspect_model`、`list_entities`、`get_model_info`、`get_selection` 这七种纯只读、且 owner 为当前进程的已 claim 请求可以移除。`get_active_model_identity` 只读取当前文档身份并在路径精确匹配时清除 pending-open，不计算全局 revision、不做 snapshot；用于避免大模型 MDI 激活轮询反复触发全量扫描。若 response 尚未来到，会写入私有 `read-only-cancellations/` marker；下一次 QueueRuntime 调用在创建新请求前及等待期间清除该 request id 的迟到 response。`build_model`、open/save/import/export、capture、adopt、Ruby 及未知 method 仍全部按 outcome-unknown 保留，不能借这一机制自动越过。
- Agent Gateway reviewed edit 必须携带 submit idempotency key。queue apply 返回 confirmed native receipt 后，Gateway 仍在同一 authorized/exclusive scope 做一次只读 adoption，绑定完整 canonical after revision，再在 task 进入 `verifying` 之前持久化 HMAC-protected task receipt。
- 该 task receipt 存在且与原 response-free submit claim、plan/model/before-after revision 完全匹配时，restart 只能 resume server finalizer，不能再调用 SketchUp mutation。receipt 缺失时仍是 `MUTATION_EXECUTION_FAILED` outcome-unknown；receipt 损坏或脱离 claim 时是 `MUTATION_RECEIPT_INVALID`。

这些保证不等于 `iterate_model` 等多步 task 全局原子，也不能证明 native crash 后可自动恢复。尤其是 SketchUp commit 已返回、但 Node 在 post-apply adoption 或 task receipt 持久化之前退出的狭窄窗口，仍必须当作 outcome-unknown；当前 mock crash-point 证据不是 live queue 证据。

## Native crash 处置

如果 SketchUp 在 live queue 期间退出或出现 Problem Report：

1. 立即中断当前 Node/QA 进程，不要立即重启并重跑。
2. 用 `queue_diagnostics --include-files` 核对本次 owner 的 queue/processing/response 和 lock；未 claim queue/lock 应已清理。正式 reliability runner 的六种纯只读 claim 可按上述 marker 机制收敛；任何修改类、写文件类或未知 method 的 processing/response 都必须保留为 outcome-unknown 证据并阻断 fresh handshake。不删除不确定 owner 的文件。
3. 保留 `~/Library/Logs/DiagnosticReports/SketchUp-*.ips`，记录 request id/method 和时间线。
4. 该次 live gate 直接判为失败；plugin 重启、模型 recovery 或手动继续都不能补作同一次 live proof。
5. `reset_model` 在 active group/component edit path 或存在 locked top-level entity 时必须 fail closed。清理顺序为 scenes 先于 geometry，避免 scene 保留已删除 entity 引用。

## 安装检查

当前 Ruby 插件由主文件和子目录组成，安装时必须一起复制：

```bash
npm run plugin:install
```

复制后需要完全重启 SketchUp，随后用 `get_capabilities` 确认 `plugin_version`。如果需要生成 SketchUp Extension Manager 可导入的 `.rbz` 包，运行 `npm run plugin:package`。
