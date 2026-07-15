# Agent-first 下一阶段权威路线图

日期：2026-07-15
当前发布线：`codex/two-week-release-critical` / `0.1.0-rc.2`
状态口径：这是实施、验收路由和当前执行台账；完成项仅按对应 mock/live 证据范围声明。

## 1. 现场复核基线

2026-07-15 在当前 checkout 重新核对：

- HEAD：`b4470f4c5de5992b30411a9a1c3b82ba1aabfdfd`，分支 `codex/two-week-release-critical`。
- 工作树开始时只有用户/其他 Agent 的未跟踪 `RELEASE_PREVIEW_ZH.md`；本路线不覆盖、不删除、不提交该文件。
- stdio MCP `tools/list`：36 tools。
- safe JSON DSL registry：101 operations，其中 57 个允许 `component_definition` scope。
- 稳定性分布：17 stable / 73 beta / 11 experimental。
- restricted Python source corpus：35 cases，29 个编译到 canonical golden，6 个稳定分类为 unsupported。
- Existing Model Editing Engine 已有 plan/apply、persistent occurrence path、model revision、S1-S4 risk、shared-definition policy、stale-plan rejection 和 before/after/diff/QA。
- image-structured 主线 adapter 仍为 review-gated / preview-only；不自动调用 queue。
- `ParametricRecipe -> FeatureMappingPlan -> PartGraphCorrectionPatch -> reviewed PartGraph -> safe JSON DSL` 已进入当前主线事实基线。
- 当前架构分支根级 `npm test`、40-tool mock capability suite 和 Existing Model Editing mock QA 通过。本轮没有发送 live queue handshake，因此不更新 live SketchUp 结论。

计数是不同层的事实：36 tools 不等于 101 operations，101 operations 不等于完整 SketchUp API。

## 2. 分支与发布边界

### RC 发布线只接收

1. tool registry / stdio / HTTP 同源和 parity 防回归。
2. Queue QA 默认 mock、显式 live 危险提示和中断清理。
3. HTTP 本地服务的 loopback、body limit、auth、path policy、timeout、错误码、测试和运维文档。
4. 不改变现有低层 36-tool 行为的文档/合同对齐。

### 后续架构线

Agent Contract v1、ModelGraph v1、DesignIntentGraph、视觉校正和 compatibility harness 在独立分支推进。用户已确认后，当前已创建并切换到 `codex/agent-contract-v1`；起点为发布修复提交 `c9eb0f7`。`codex/two-week-release-critical` 保持在该提交，不混入后续架构工作。

除用户已明确确认的发布修复提交和架构分支创建外，本轮不继续 commit、merge、cherry-pick、reset、revert 或删除工作树内容。

## 3. 依赖链

```text
RC 前置安全修复
  -> Agent Contract v1 基础合同和 task store
    -> 可信 approval token + guided/standard gateway
      -> ModelGraph v1 + edit proposer
        -> DesignIntentGraph / FeatureHistory
          -> 参考图驱动的现有模型校正

可靠性 corpus 从 ModelGraph 开始并行累积
  -> 稳定性提升数据
  -> Agent Compatibility Harness 最终硬门禁
```

Priority 1 不得绕过 Priority 0 的 task/approval 合同直接执行。Priority 3 不得绕过 image promotion review。Priority 5 不得只做品牌模型对比，必须先按 L0/L1/L2 能力等级建基准。

## 4. 里程碑与验收

### R0 — RC 前置安全修复

交付：

- 单一 tool registry，stdio/HTTP 均从 registry 列出工具。
- `/tools` 精确返回 36 tools，后续增减不需要手工同步 HTTP。
- 能力套件默认 `mock`；只有 `--runtime queue` 才能进入 live queue，`--queue-required` 只能与显式 queue 组合。
- queue 开始前明确警告会 reset/修改当前 SketchUp 模型。
- SIGINT/SIGTERM/异常时清理本进程 request/lock。
- HTTP 安全边界及运维文档。

验收：

- stdio/HTTP/registry 名称与顺序 parity。
- HTTP 未授权 POST=401；超大 body=413；越界路径=403；未知 tool=404；内部错误不回显路径/密钥。
- 默认能力套件不创建 queue 目录/请求。
- 隔离 state dir 下中断 queue 测试，最终 request=0、lock absent。
- `npm test` 和 `git diff --check` 通过。

### P0-A — Agent Contract v1 核心

交付：

- 版本化 `AgentTask` schema：`created -> understanding -> awaiting_input/awaiting_review -> approved -> executing -> verifying -> completed/failed/cancelled/expired`。
- 服务端 task store；客户端只保留 `task_id` 也可恢复。
- 统一 result envelope：`contract_version` / `task_id` / `state` / `result` / `artifacts` / `warnings` / `error` / `next_action` / `retry`。
- stable error-code registry 与 schema，明确 `retryable`、`idempotency_key`、`operation_fingerprint`。
- artifact handle：服务端持久化 path，Agent 获得 handle/metadata，无本地文件能力也能续跑。
- `client_capabilities` 与 `execution_policy` 彻底分离。Agent 自报 vision/local-files/parallel 只能改变交互方式，不能提升执行权限。

验收：

- JSON Schema + contract tests + 磁盘重启恢复。
- 同 idempotency key 重试不产生第二个修改。
- 短上下文测试只靠 `task_id` 恢复。
- 未知/错误 enum 返回稳定 schema error + 可执行 `next_action`。

### P0-B — 可信审批与 Agent Gateway

交付：

- approval challenge/token 绑定 plan hash、model revision、risk、allowed operations、expiry、nonce，一次性消费。
- S1 可依用户 execution policy 自动批准；S2-S4 默认必须由可信用户通道批准。
- `review.status=approved` + `reviewer` 字符串不再是 S2-S4 授权依据。
- guided / standard / expert 三档入口。guided 默认服务端持状态，expert 保留原 36 tools。
- 少量高层 task tools：create/understand/propose/review/execute/verify/resume 语义，不要求普通 Agent 自己编排全部底层工具。
- 模型内名称、材质、attributes、OCR 统一标记 `untrusted_data`，不能改变 workflow/policy。

验收：

- Agent 伪造 approved/reviewer 必须失败。
- token 重放、过期、plan hash 变更、model revision 变更、operation 越权全部失败。
- 无用户批准的 S2-S4 执行=0。
- `get_workflow_bundle` 覆盖 create/understand/reviewed edit/image artifact/verify，移除过时 `nested_read_only` 口径。
- `get_docs(topic, detail, max_chars)` 或等价渐进读取，普通 Agent 不再必须一次消费约 22 万字符。

### P1 — ModelGraph v1 + 修改提案器

交付：

- 持久、版本化 ModelGraph：occurrence/definition、parent-child、Face/Edge summary、material/Tag/Scene/attributes/classification、空间/拓扑关系、shared impact、lineage、model revision。
- `propose_existing_model_edit`：自然语言目标 -> candidate targets/evidence/confidence/exclusion/operation proposal/shared policy/risk。
- proposal 只进入 task state，不直接执行；执行仍通过可信 review + Existing Model Editing Engine。
- 建筑、室内、产品、深层共享组件 benchmark。

硬验收：歧义必须 `awaiting_input`；错误目标不得自动执行；target top-k、错误对象修改率可计量。

### P2 — DesignIntentGraph / FeatureHistory

交付：

- ParametricRecipe / FeatureMappingPlan / PartGraph / correction history 与 persistent SketchUp entities 双向映射。
- 设计参数修改与受影响子图重建：门宽、阵列数量、孔径、墙厚、关联门窗。
- save/reopen 后 lineage 不漂移；手工编辑导致 divergence 时生成 reconciliation/review，不静默覆盖。
- 至少三个不同领域样例，不停在 Switch fixture。

验收：参数编辑后仅重建受影响子图；保存/重开 identity 稳定；divergence 不自动 promotion。

### P3 — 参考图驱动的现有模型校正

交付：

- reference/input image -> capture_view -> structured evidence -> alignment/difference -> CorrectionPatch -> review -> edit -> recapture/QA。
- 服务端产出结构化视觉摘要；无视觉 Agent 可完成，有视觉 Agent 可选看 overlay/thumbnail。
- image promotion 继续 fail closed。范围限定在“参考图校正已有模型”。

验收：无视觉 L0 Agent 只使用 structured summary 完成 review；未通过 review 的 patch 执行=0；校正前后差异可审计。

### P4 — 真实模型可靠性

交付：

- 暂停为数量新增 operation。
- 小而难 corpus：建筑、室内、产品、深层 shared definition、CAD/脏拓扑、材质/场景/隐藏、缩放/镜像/locked。
- boolean/manifold、UV/material preservation、large recursive index、rollback、save/reopen identity、SketchUp 版本差异验证。
- 用任务成功率、错误对象修改、静默几何损坏、恢复率代替 operation count 叙事。

验收：每个 beta/experimental 升级必须有 corpus evidence、负面样例和 rollback/reopen 结果。

### P5 — Agent Compatibility Harness

交付：

- L0：短上下文、无文件、无视觉、单工具。
- L1：结构化输出、可保留 task_id，但无并行/视觉。
- L2：长上下文、文件/视觉/并行能力。
- 故障注入：丢状态、重复调用、错 enum/字段、stale plan、伪造 approval、忽略 warning。
- 任务：create、understand、ambiguous edit、make_unique、image summary、stale recovery、resume、idempotent retry、human approval。
- 指标：完成率、调用数、schema error、无效重试、target top-k、错误对象修改、未授权执行、恢复率。

硬门禁：

- 错误对象自动执行 = 0。
- S2-S4 未经真实批准执行 = 0。
- 重复请求导致重复修改 = 0。

## 5. 制品与证据规则

每个里程碑必须同时交付：

1. 版本化 schema/contract。
2. positive + negative + replay/stale tests。
3. mock evidence report，包含版本、fixture hash、指标和验收结论。
4. 可恢复的 artifact manifest/handle。
5. 保守文档口径。

live queue 不是默认测试。只有用户明确配合、当前 SketchUp 模型可被重置，且 fresh `get_capabilities --runtime queue` 成功时，才进入 live 验收。`plugin:check` 不能替代。

## 6. 当前执行记录

2026-07-15：

- [x] 审计分支/HEAD/工作树与 36/101/57 基线。
- [x] 确认 `RELEASE_PREVIEW_ZH.md` 为未跟踪用户稿，保持不变。
- [x] 确认 HTTP 34-tool 硬编码、未显式 loopback bind 和其他安全缺口。
- [x] 确认 Queue QA 默认 `auto` 会探测 live queue。
- [x] R0 实现与全量验收：36-tool registry parity、默认 mock queue safety、中断 cleanup、HTTP 安全边界、文档与操作指南已通过 `npm test`。
- [x] P0 的发现/短上下文兼容前置：`get_docs.v2` 支持 `topic/detail/max_chars`，workflow bundle 覆盖 create/understand/reviewed edit/image artifact/verify，MCP 返回 `structuredContent`。
- [x] 用户确认后提交 R0 为 `c9eb0f7`，创建并切换 `codex/agent-contract-v1`；发布分支保持在同一提交，未 push/merge。
- [x] P0-A：落地版本化 task/result/artifact schemas、12-state machine、14-code error registry、原子持久 task store、disk restart resume、idempotency 和 opaque artifact handle。
- [x] P0-B mock 闭环：保留 36 expert tools，增加 4 Gateway tools；可信一次性 approval 绑定 task/plan hash/model revision/risk/operations/expiry；伪造 review、tamper、stale、replay 和越权均 fail closed；S1 仅显式服务端策略可自动批准。
- [x] P0 回归证据：`npm test`、`qa:existing-model-edit:mock`、40-tool mock capability suite 通过；证据见 `docs/evidence/agent-contract-v1-mock-evidence.json`。
- [x] P1：ModelGraph v1 与 proposal-only edit generator 落地；建筑、室内、产品、深层共享组件 benchmark 覆盖候选证据、歧义询问、make_unique 和零执行提案。
- [x] P2：DesignIntentGraph v1 落地参数／feature／persistent entity 双向映射、依赖子图重建、reviewed edit 路由、save/reopen identity、人工 divergence 检测与 reconciliation；覆盖建筑门墙、产品孔径和室内阵列。
- [x] P3 mock 闭环：参考图／capture artifact 服务端摘要、alignment/difference、overlay handle、非执行 CorrectionPatch、可信 reviewed edit 路由和 recapture QA；无视觉／无本地文件 Agent 可用，路径越界 fail closed。
- [x] P4 mock corpus：7 个难例覆盖建筑、室内、产品 boolean/manifold、1600 项递归共享组件、导入脏拓扑、UV/材质/Scene、缩放/镜像/locked；任务成功率 100%、错误对象修改 0、静默几何损坏 0、恢复率 100%。修复了 `manifold_repair` 无法接收非 manifold 目标的缺陷。
- [x] P5 capability harness：L0/L1/L2 各 7/7 场景、17 次串行调用；覆盖丢状态、重复调用、错 enum、stale、伪造 approval、忽略 warning、resume、make_unique、image summary、human approval。三项硬门禁均为 0。
- [ ] live queue 未运行；待用户明确配合 fresh handshake 和可信用户批准 host adapter 后再做。
- [ ] 下一阶段只剩 live/real-SKP 证据层：fresh queue、真实 SketchUp 版本矩阵、真实保存重开与 viewport recapture；未经用户明确配合不运行。

## 7. 主要风险与止损

- 审批渠道如果没有独立于 Agent 的信任根，S2-S4 不得上线执行；只保留 proposal/preview。
- ModelGraph target precision 达不到硬门禁时，不得自动进入 execution。
- DesignIntentGraph 无法在 save/reopen 保持 identity 时，不得宣称 feature history 可靠。
- 视觉 alignment 只产出低置信证据时，必须进入 review/询问，不降级为自动执行。
- P4/P5 硬指标不达标时，beta/experimental 不升级，不用 operation count 替代可靠性证据。
