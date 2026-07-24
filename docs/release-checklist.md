# Release Checklist

更新时间：2026-07-24

本清单用于把当前本地 replica 收成可安装、可回归、可打包的技术预览 slice。

发布边界调整：2026-05-25 验收复盘后，当前版本不再把 `projects/image-structured-modeler` 的照片级/多图产品建模能力与主线 MCP runtime 发布 gate 混写。下面的检查用于验证主线 MCP 的基础 runtime、Expert Mode、queue 回归、仓库内部 restricted facade expression R3 和 RBZ 打包是否健康；子项目正式发布仍需独立的产品样本/照片级验收。这里的 R3 不是 SketchUp 官方 API 版本。

### 当前架构分支边界（尚未签名为 RC）

`codex/agent-contract-v1` 当前从共享 registry 导出 41 MCP tools（36 expert + 4 Gateway + 1 Session Contract），DSL contract 为 101 operations / 57 component-definition scope。历史 manifest/sidecar 定义的 `0.1.0-rc.2` 身份仍是 36-tool surface，但当前同名 RBZ 的 bytes/size 已不匹配，状态为 `invalid_for_signed_rc`。三个现存文件不得覆盖、删除或自动修复。本清单的新项是架构分支的下一个候选门禁，不会自动恢复历史 RC 或签名当前分支。

- 2026-07-24 rc.3 集成：当前源码版本为产品 `0.1.0-rc.3` / capability `0.1.0-rc.3-capabilities.1` / manifest `2026-07-agent-contract-rc3.1`，current-source core 为 `39 / 39`。版本合同和 Copy Fast v2 runner 已提交为 `70be58f`；插件尚未安装并完整重启，rc.3 v2 live evidence、最终离线门禁和签名制品均待完成，因此 `release_acceptance=false`。

当前证据必须保持以下限定：

- 离线回归与不可变证据 freshness 必须分层运行：`npm run test:current-source-core` 验证当前源码的 mock/offline 行为，`npm run test:capture-bound-evidence` 严格验证捕获证据的 source/artifact bindings。后者因源码漂移失败时必须记为 stale 并重新采集，不能改写旧证据。完整说明见 [`docs/test-evidence-layers.md`](test-evidence-layers.md)。两条入口均 `queue_allowed=false`，不替代显式 live queue 验收。
- Copy Fast 当前已有 `copy-fast-session.v1` 的 current-source mock/offline acceptance、默认零 queue 的单进程 live 验收器，以及 2026-07-24 的 current-source live replacement：S1/S4、跨 task/revision reuse、零逐任务 challenge、幂等、目录/save target 越界、restart/expiry/revoke fail-closed 均通过；live S4 的 finalized receipt、target/empty-parent postcondition、disk bytes unchanged 与 queue cleanup 已由严格 schema 和独立 current-source validator 固定。7 月 22 日旧授权模式的历史 S4 capture 保持不可变，不被新证据改写。新证据仍是 scoped milestone，`release_acceptance=false`。配置和证据见 [`docs/copy-fast-mode-v1.md`](copy-fast-mode-v1.md)。
- 2026-07-24 pre-version 盘点：版本提升前 `current-source-core` 为 `38 / 38`；加入 rc.2 Copy Fast live successor 后，`capture-bound-evidence` 为 `14 / 23`，其余 9 项因绑定源码已演进而明确 stale。正式 `release:offline-gates` 当时以 18 / 18 通过。当前 rc.3 core 已为 `39 / 39`；必须在 rc.3 v2 live evidence 固化并接入后重新运行 18 项门禁，旧报告不得充当 rc.3 签名依据。stale 是正确的 fail-closed 结果，不得把旧 JSON 的 hash 改成当前值。

- 2026-07-21 rc.2 历史边界：当时的 22-file workspace 插件在 SketchUp 2026 完整重启后完成 fresh capability `.7` / manifest `2026-07-agent-contract-v1.4` / `definition-merkle.v2` 只读验收。loaded Boolean/Model Revision SHA 与当时 workspace 精确匹配；一个 byte-exact disposable model 在签名 handshake -> `5859 / 5859` recursive adoption -> 第二次签名 handshake 前后 revision 和 `model_modified=false` 均不变，queue 前后全清。该记录只作为 rc.2 immutable lineage，不能替代 rc.3 live。公共脱敏证据见 `docs/evidence/current-source-live-readonly-evidence-2026-07-21.json`。

- P1 已有当前 `.7/v1.4/v2` 的单模型 scoped live read-only Agent Gateway 证据：完整重启、22-file installed/workspace manifest 匹配、`5859 / 5859` revision、guided 弱能力调用者完成 understand；歧义提案返回 5 candidates / 0 selected / 0 operations / `awaiting_input`，并通过公共 artifact 分页恢复持久 ModelGraph。前后 model bytes/revision/modified/queue 不变。未执行 mutation，也未证明多模型 target quality，因此 `release_acceptance=false`。
- P2 已有建筑/产品/室内三域 mock reviewed rebuild/reconciliation，以及一个 current-source 小型 SKP 的 live save/full-restart lineage + unsaved manual-divergence fail-closed 证据：原 `task_id`/graph/binding/history 恢复，偏差后的参数计划为 0 operations，reconciliation 停在真实用户 review，Agent 自报采用返回 `APPROVAL_REQUIRED`。它仍不证明连续 observer、live trusted acceptance、多 live 域或跨版本，`release_acceptance=false`。
- P3 已用 3 张真实 external reference 完成 Trimble S6 的 hash-bound S3 reviewed edit -> recapture 因果链，且旧诊断中的 capture 全宽背景误分割已由 versioned row-conditioned border flood + foreground registration 消除。固定门槛下 coarse silhouette IoU `0.569986` / Dice `0.726104` 通过，但 appearance residual 仍为 diagnostic-only，整体 `visual_similarity_accepted=false`。该算法已接入 `visual-correction-qa-result.v1`，L0/no-file/no-vision 的 4,096 字符 Gateway 投影保留关键 structured summary 与不可提权边界，完整结果可分页；当前接入证据为 `docs/evidence/visual-correction-gateway-structured-result-v1-mock-evidence.json`，mock/offline、queue calls=0。另有 architecture/product 两个不同 model key 的完整重启 capture/recapture：`5,859 / 5,859` 与 `71,626 / 71,626` 索引完整，session 已变化而 model/revision/camera/spec 精确一致，前后 PNG 字节相同、IoU/Dice=`1`，模型 bytes/state 与 queue 不变。该新增证据只证明两域同模型 fresh-process 捕获一致性；独立 camera-pose 与外部参考图跨模型质量仍缺，`release_acceptance=false`。
- P4 已有 7 领域/23 任务 deterministic mock corpus，并完成当前源码 `7 / 7` hash-bound live reliability：`23 / 23` named tasks、`3` 例 formal geometry mutation，wrong-object / silent-corruption 均为 0，恢复 `2 / 2`，每例 save/reopen 与 queue cleanup 通过。最后的 product Boolean 证明 exact-target replacement、tool/non-input isolation、manifold/material 与 `71,868 / 71,868` identity；但它和 dirty-topology 都只覆盖受控隔离 overlay，不能外推为任意产品 Boolean 或任意 CAD 修复。Portal v8 的历史 S3 pair 仍只是 confirmed precommit abort。SketchUp 跨版本矩阵按用户决定 deferred，P2 的更广 live 域/accepted reconciliation 与 P3 仍有缺口，`release_acceptance=false`。
- P5 除 L0/L1/L2 的 21/21 scripted scenarios 外，已有三个真实 ephemeral Codex CLI 进程。柜体与共享 component 双实例 fixture 各完成 4 次 L0 Gateway 调用，覆盖 understand、精确 idempotent replay、resume by task_id 与 ambiguous edit abstention；第三个 no-vision reference/capture fixture 用 2 次调用取得 inline structured image summary 和 metadata-only overlay handle，图片 bytes 未暴露，S2 correction 停在 `awaiting_review`。聚合为 3 个 fixture family / 2 个 workflow family / 3 个独立进程 / 10 次调用；服务端 hash-chain、模型 revision unchanged、unexpected command=0、image-content exposure=0 与三项 hard gate=0 均通过。它证明 fixture/workflow diversification 和 no-vision summary transport，未证明多厂商/明确模型、live SketchUp、视觉质量或 production human approval，`release_acceptance=false`。

## 1. 本地静态检查

```bash
npm run release:offline-gates -- --output output/release-readiness/<new-report>.json
npm run plugin:check
npm run test:copy-fast-session
npm run qa:copy-fast:check
npm test
npm run tool-registry:check
npm run qa:mock
npm run qa:model-layout
npm run qa:expert:mock
npm run qa:budget:mock
npm run qa:python-sdk-high-value:mock
npm run qa:nested-edit:mock
npm run qa:existing-model-edit:mock
npm run qa:save-reopen:mock
npm run qa:mock-session-isolation
npm run test:python-sdk-source-compat
npm run qa:mcp-capability-suite -- --runtime mock
node test/sketchup-plugin-crash-safety.mjs
node test/model-graph-live-readonly-evidence.mjs
node test/design-intent-cross-domain.mjs
node test/visual-correction.mjs
node test/image-artifact-store.mjs
node test/live-visual-capture-evidence.mjs
npm run test:fresh-process-multi-model-visual-runner
npm run test:fresh-process-multi-model-visual-evidence
npm run qa:real-model-reliability:mock
npm run test:real-model-reliability-offline
npm run test:plugin-install-safety
npm run test:release-manifest-create-new
npm run test:release-artifact-drift-evidence
node test/mock-evidence-hash-integrity.mjs
node scripts/run-agent-compatibility-harness.mjs
npm run test:independent-agent-compatibility-probe
npm run test:independent-agent-compatibility-evidence
npm run test:independent-agent-compatibility-evidence-v2
npm run test:independent-agent-compatibility-evidence-v3
npm run test:image-structured
node test/image-structured-mcp-adapter.mjs
git diff --check
```

通过标准：

- Ruby 插件主文件和所有子模块 `ruby -c` 通过。
- Operation contract 输出 manifest / mock / Ruby dispatch 为 `101 / 101 / 101`，component registry / dispatch 为 `57 / 57`。
- Expert Mode fixture 编译和 mock build 通过，且安全拒绝场景由 `test/expert-compiler.mjs` 覆盖。
- MCP stdio server 和 HTTP `/tools` 必须从共享 registry 精确暴露 41 tools（36 expert + 4 Gateway + 1 Session Contract）；`docs/tool-registry.md` 必须通过生成检查。所有 live mutating tool schema 必须暴露 `session_contract`；两个 image artifact adapter 和两个 reviewed existing-model edit 工具的 allowed/blocked 合同分别由 targeted tests 与 capability suite 覆盖。
- `test/session-contract.mjs` 必须覆盖缺失/篡改/过期、MCP/plugin restart、document/model switch、revision/capability drift、queue residue，以及 Gateway 缺 handshake/queue lock 的非终态恢复；所有 preflight 失败场景 mutation count 为 0，恢复后只修改一次。默认测试不得创建 live queue request。
- Agent result envelope 必须保持 `result===data` 的兼容语义、合并全部 QA warning 来源；artifact pagination 只接受整数 `max_chars`。失败的 submit idempotency replay 与 `resume_agent_task` 必须保持原 `ok=false`/stable error，不得变成伪成功。
- `get_workflow_bundle` 的所有 tool 示例必须引用共享 registry、提供 schema required 参数占位；verify 中每个独立 queue mutation 必须紧邻新的 `create_queue_handshake`，不得复用已经跨 mutation 的合同。
- crash safety 必须覆盖 queue request 原子 claim 到 `processing/`、崩溃后不自动重放、response temp+fsync+atomic rename、仅在 response 持久化后删除 claim，以及 owner-scoped 清理只删未 claim request/lock。已 claim 且无 receipt/abort proof 的 processing 或未观测 response 保留为 outcome-unknown 证据；可信、无冲突的 confirmed precommit abort 则记录 `not_committed` / `rollback_confirmed`，但同样禁止重放。Ruby 修改 transaction 必须在 commit 前完成 snapshot/JSON 检查，只有 pre-commit 异常可 abort；commit 成功才返回 `mutation_receipt.v1`。同时保留 raw mutation transport guard 和 `reset_model` 对 active edit path/locked entity 的 fail-closed。
- Python source corpus 必须为 35 cases / 29 canonical golden / 6 stable unsupported / 0 unclassified；mock session 并发隔离必须通过。
- mock QA、model layout QA、Expert mock QA 与 mock budget 均 Verdict `pass`；`qa:model-layout` 必须生成 Switch、救护车和儿童房的正交 preview/report，且 issues 为 `0`。

## 2. 安装 SketchUp 插件

```bash
npm run plugin:install
```

安装器必须先取得插件根 0600 独占锁，再用 22 文件精确清单完成 source/stage/install bytes、Ruby syntax 与 runtime manifest 校验。stage 后到 backup 前若原安装 bytes 变化必须 fail closed；普通异常及 SIGINT/SIGTERM 要恢复原 bytes。若 rollback 本身不完整，唯一 backup/recovery directory 必须保留而不能被 finally 删除。安装完成只证明磁盘 bytes，不能证明运行中的 SketchUp 已加载它们。

安装目录默认是：

```text
~/Library/Application Support/SketchUp 2026/SketchUp/Plugins
```

安装后完全退出并重新打开 SketchUp，然后执行：

```bash
node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000
node src/cli.mjs create_queue_handshake --timeout-ms 10000 --output-file output/session-contract.json
```

通过标准：

- `runtime.version` 等于当前 `PLUGIN_VERSION`。
- `runtime.compatibility.ok` 为 `true`。
- `runtime.compatibility.issues` 为空。
- supported operations 数量为 `101`。
- `create_queue_handshake` 返回签名 `session-contract.v1`，包含当前 session、document/model identity、revision、版本、capability、queue state 和 expiry，且不修改当前模型。
- 当前 handshake 还必须返回 capability `0.1.0-rc.3-capabilities.1`、manifest `2026-07-agent-contract-rc3.1`、`definition-merkle.v2`、Boolean/Model Revision 两个已加载源码 SHA 与布尔型 `model_modified`；源码不匹配、旧 strategy 或未保存状态漂移均 fail closed。
- `queue_diagnostics` 中 `queue.count=0`、`processing.count=0`、`lock.exists=false`；任何不明 owner 制品只审计，不自动删除。

## 3. Queue 回归

```bash
export ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue
export ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1
export ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION=1

npm run qa:copy-fast:queue -- --runtime queue --queue-required --ack-disposable-copy --fresh-sketchup-confirmed
npm run qa:queue
npm run qa:expert:queue
npm run qa:budget:queue
npm run qa:official-api-r3:queue
npm run qa:python-sdk-high-value:queue
npm run qa:nested-edit:queue
npm run qa:save-reopen:queue
node src/cli.mjs compare_model --code-file examples/boolean-manifold-slice.json --expected-runtime mock --actual-runtime queue --fresh-handshake --timeout-ms 180000 --tolerance-mm 20 --face-tolerance 2 --edge-tolerance 4 --format markdown --output-file output/boolean-manifold-queue-report.md
npm run qa:mcp-capability-suite -- --runtime queue --queue-required --timeout-ms 240000
```

`queue` runtime 绑定当前 SketchUp 进程和 file queue，发布验证必须串行执行这些命令。Node 侧会用 `~/.sketchup-mcp-replica/queue-runtime.lock` 防止多个 queue 命令互相插入。仓库 queue QA 脚本会为每个高层 live mutation 显式创建 fresh Session Contract；手工 CLI mutation 必须使用 `--session-contract-file` 或同命令 `--fresh-handshake`。

`qa:copy-fast:queue` 是单独的当前源码授权替代 gate：必须先打开文档中固定 SHA 的 Fire Escape disposable copy 并完整重启 SketchUp。它会删除一个精确 nested Group 和其空父组，只修改活动内存模型，固定不保存；完成后关闭且不要保存。默认 `qa:copy-fast:check` 只读磁盘、核对 22-file installed/workspace manifest 且 queue calls=0，不能代替 live gate。

直接 expert/QA queue 命令还必须由用户运行的 host 同时配置 `ALMA_SKETCHUP_AGENT_ALLOWED_RUNTIMES=mock,queue`、`ALMA_SKETCHUP_AGENT_ALLOW_QUEUE_MUTATION=1` 和 `ALMA_SKETCHUP_ALLOW_DIRECT_EXPERT_QUEUE_MUTATION=1`。长驻 Agent 服务应保持最后一项关闭；Gateway queue permission 不会隐式开启 direct expert mutation。

`qa:existing-model-edit:queue` 的历史 validator 仍要求嵌入式 `trustedApprovalProvider`，不能由普通 CLI 自铸 token。目录外生产式验收走 `npm run approval:serve` + `approval:live:prepare/status/apply`：真实用户在独立本机审批页复核绑定并输入审批口令，Agent 只提交 fresh Session Contract，token 始终保留在服务端私有状态。Copy Fast live 验收必须使用明确配置的 disposable-copy root，可省略逐任务用户点击，但仍要保存 server session summary、plan/revision/policy binding、fresh Session Contract、before/after/diff/QA/receipt、queue cleanup 与原文件未触碰证明。不得用 Agent 自报“这是副本”或浏览器自动化伪造授权。

通过标准：

- `output/qa-reports/queue/index.md` 中 10 个默认样例 `OK: true`；聚合 Verdict 允许为 `review`，因为 mock/queue 真实拓扑差异会保留 warning。
- `output/boolean-manifold-queue-report.md` 使用 solid boolean 专用 topology/bbox tolerance 后 Verdict `pass`，Total Diffs 为 `0`。
- `output/model-qa/ambulance-reference-rerun-queue/report.md` Verdict `pass` / Level `ok` / issues `0`；救护车样例必须由 `npm run acceptance:generate-ambulance` 重新生成后再跑 queue。
- `output/qa-reports/expert-queue/index.md` Verdict `pass`，Expert fixture 编译、queue 构建、SKP artifact 保存、runtime compatibility、warnings 和基础预算均通过。
- `output/performance-budgets/queue/index.md` Verdict `pass`，四个发布样例低于默认 face / edge / vertex / group / instance / SKP size budget。
- `output/python-sdk-official-api-expression-r3-queue.json` 断言全部通过，并保存 `output/python-sdk-official-api-expression-r3.skp`；当前基线为 `12 operations / 5 groups / 10 faces / 29 edges / 25 vertices / selection 1 / scene 1 / warnings 0`。
- 高频 Python SDK 和 nested edit queue gate 必须保存对应 JSON/SKP。Existing Model Editing Engine 的目录外 S2-S4 live gate 只能在 Local Approval Host 已初始化、真实用户逐项批准且 fresh Session Contract 有效时运行；明确配置的 Copy Fast disposable-root gate 可用 server session 代替逐任务 decision，但仍需完整 plan/revision/policy/session/receipt 证据。两类 gate 都必须保存 before/after/diff/QA/receipt/SKP，并证明 deep path/revision 在 save/reopen 后稳定。image adapter 只生成离线 preview，不进入 queue 执行。
- `qa:save-reopen:queue` 是不依赖 S2-S4 token 的独立受控 fixture：必须显式 `--queue-required`，并走 target -> distinct intermediary -> target 的真实 path switch；三个阶段都要核对 active `source_path`，重开后要求完整 recursive identity signature、model revision、shared-definition impact 一致且 zero-tolerance snapshot diff 为 0，结束时 queue/processing/responses 为 0、无 lock。macOS 若返回 `pending_mdi_activation`，先在 SketchUp「窗口」菜单中显式选中 target，用只读 `get_model_info.source_path` 确认路由后，再使用保存的 checkpoint 执行只读 `--resume-after-open`；不得把视觉上的前台窗口、same-path open/no-op 或关闭 intermediary 后的被动 fallback 当成 MDI 验收。两个窗口保持打开时，`source_path` 必须能双向跟随显式窗口切换。
- `qa:mcp-capability-suite` 的 mock/live `build_report` 和 `iterate_model` 必须 `model_qa.verdict=pass`，且顶层 report 必须包含末尾 `queue=0 / processing=0 / responses=0 / lock=false`；只有 group delta 正确不足以放行。
- 任一 handshake/session/document/model revision/expiry/version/capability 不匹配，以及 active/stale lock、pending request 或 orphan response，必须返回稳定错误码与 `next_action`，且不得执行 mutation。
- 上述错误若发生在 Gateway 授权执行回调之前，task 必须保留为可恢复非终态并持久化 error；若已进入 `executing`/`verifying`，则继续 fail closed。无 durable task receipt 时只有可信 confirmed precommit abort 能证明未提交；否则保持 outcome unknown。两者都不得按错误码盲目自动重试。
- 任一 SketchUp native crash 使当次 live gate 直接失效；同一 request 在 plugin 重启后自动执行次数必须为 `0`，旧 transport guard 必须以 session/document/revision mismatch 拒绝。

## 4. 打包 RBZ

当前源码版本已提升为 `0.1.0-rc.3`。冲突的 rc.2 三件套继续保持不可变历史；rc.3 使用不同文件名，因此只有在 rc.3 插件完整重启、Copy Fast v2 live gate、严格证据 validator 与最终离线门禁均通过后，才可在默认 `out/releases` 执行下面的 canonical create-new-only 流程：

```bash
npm run plugin:package
npm run release:manifest -- --live-status passed --offline-gate npm-test --offline-gate test-image-structured --offline-gate plugin-check
```

package 与 manifest 生成必须共用 version-scoped 0600 独占锁；RBZ、sidecar、manifest 均 create-new-only，任一既存、symlink、version mismatch 或并发竞争都要在不覆盖/删除已有制品的前提下失败。非发布预览必须使用独立 output directory 和显式 artifact label，不能冒充 canonical RC。

输出：

```text
out/releases/alma-sketchup-mcp-<PLUGIN_VERSION>.rbz
out/releases/alma-sketchup-mcp-<PLUGIN_VERSION>.sha256
out/releases/release-manifest-<PLUGIN_VERSION>.json
```

checksum 文件中的 RBZ 名是同目录相对路径，应在 `out/releases/` 内运行 `shasum -a 256 -c <file>.sha256`。

打包内容必须包含：

- `alma_sketchup_mcp.rb`
- `alma_sketchup_mcp/operation_registry.rb`
- `alma_sketchup_mcp/document_state.rb`
- `alma_sketchup_mcp/object_operations.rb`
- `alma_sketchup_mcp/materials.rb`
- `alma_sketchup_mcp/appearance_operations.rb`
- `alma_sketchup_mcp/geometry_operations.rb`
- `alma_sketchup_mcp/primitive_operations.rb`
- `alma_sketchup_mcp/product_operations.rb`
- `alma_sketchup_mcp/profile_operations.rb`
- `alma_sketchup_mcp/surface_operations.rb`
- `alma_sketchup_mcp/feature_operations.rb`
- `alma_sketchup_mcp/model_revision.rb`
- `alma_sketchup_mcp/runtime_source_manifest.rb`
- `alma_sketchup_mcp/runtime_source_attestation.rb`
- `alma_sketchup_mcp/boolean_operations.rb`
- `alma_sketchup_mcp/structural_probe.rb`
- `alma_sketchup_mcp/demo_operations.rb`
- `alma_sketchup_mcp/architecture_operations.rb`
- `alma_sketchup_mcp/component_operations.rb`
- `alma_sketchup_mcp/view_operations.rb`
- `alma_sketchup_mcp/snapshot.rb`

## 5. 提交切片建议

当前主线变更已经跨多个功能面，建议按下面顺序拆 commit：

1. Operation registry / runtime contract：`src/capabilities.mjs`、`src/docs.mjs`、`src/bridge.mjs`、`src/snapshot-diff.mjs`、`test/*`。
2. DSL capability slices：新增 examples 和对应 mock/queue runtime 行为。
3. Runtime split：`src/object-*`、Ruby `alma_sketchup_mcp/` 子模块、主插件加载和 contract 更新。
4. Release docs / QA scripts：`docs/*`、`scripts/*`、`package.json`、README/PROJECT_STATUS。

提交前用 `git diff --name-only` 过滤 OneDrive mode-bit 噪声和无关生成物。
