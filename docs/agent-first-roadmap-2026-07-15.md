# Agent-first 下一阶段权威路线图

日期：2026-07-15
当前架构线：`codex/agent-contract-v1`，候选版本 `0.1.0-rc.3`

> **2026-07-24 rc.3 发布候选边界：**产品版本、runtime capability 与 manifest 分别为 `0.1.0-rc.3`、`0.1.0-rc.3-capabilities.1`、`2026-07-agent-contract-rc3.1`；41 tools、101 operations / 57 component scopes 不变。22-file 插件已安装并完整重启，Copy Fast v2 的固定 S4 live gate 通过，公共 evidence SHA 为 `1357a42f…b56e2`；接入后 current-source core `39 / 39`、release-offline-gates `18 / 18` 通过，报告 SHA 为 `2f087378…9dba4`。rc.3 RBZ/checksum/manifest 已 create-new-only 生成，RBZ SHA 为 `b5b4dcc4…7b8f2`，manifest 为 `rc_candidate_verified` / `rc_signed=true`。rc.2 的版本对、发布三件套与 v1 live evidence 保持不可变历史。该闭环只签署边界明确的 rc.3 技术预览候选，不改变后续产品化缺口。
状态口径：这是实施、验收路由和当前执行台账；完成项仅按对应 mock/live 证据范围声明。

> **2026-07-24 Copy Fast live 替代验收：**`copy-fast-session.v1` 已新增单进程、显式 opt-in 的 live runner 与严格 evidence schema。默认 `check` 只核对固定 Fire Escape disposable SKP 的 SHA/大小和 22-file installed/workspace manifest，queue calls=0；`run` 缺少 `--runtime queue --queue-required --ack-disposable-copy --fresh-sketchup-confirmed` 任一标志都会在 queue 前失败。离线 contract/schema 测试覆盖旧授权模式拒绝、session/revision 交叉绑定、installed/loaded source drift、重复请求不重复修改、磁盘不保存与 queue cleanup。SketchUp `26.2.242` 的新 session live replacement 已通过：S4 task 直接 approved、0 challenge、finalized receipt、target/empty parent absent、revision changed、idempotent replay 无重复修改、disk bytes unchanged、queue clean；公共 evidence SHA 为 `0968b72f...c4d80`，见 `docs/evidence/copy-fast-session-v1-live-evidence-2026-07-24.json`。这是 scoped milestone，`release_acceptance=false`。

> **2026-07-24 发布距离盘点：**rc.3 技术预览候选的版本、安装/完整重启、scoped live、严格 evidence、39/39 current-source、18/18 offline、RBZ/checksum/manifest/signoff 已全部闭环。当前不再有阻塞该候选签署的工程门禁；剩余工作属于发布运营或后续产品化：分发/安装说明、可选的其他机器 smoke，以及 P2 continuous observer/多 live 域、P3 独立 camera/external-reference 跨模型质量、P5 多厂商/production approval。跨版本继续按用户决定 deferred。

> **2026-07-21 rc.2 Model Revision 历史迁移边界：**跨 SketchUp 进程不稳定的 `entityID` 已从修订身份中移除；当时合同为 capability `0.1.0-rc.2-capabilities.7`、manifest `2026-07-agent-contract-v1.4`、`definition-merkle.v2`，并绑定加载中的 Boolean 源码、Model Revision 源码和 `model_modified`。旧 `definition-merkle.v1` mock/live 文档保持原字节，仅作为 `lineage_only=true` 的历史选择/观察证据。22-file 插件当时完成 fresh `.7/v1.4/v2` 只读验收；该证据不能替代 rc.3 的重新安装与 live gate。证据见 `docs/evidence/current-source-live-readonly-evidence-2026-07-21.json`。样式等用户界面改动即使不改变几何修订，也可能令 `model_modified=true`；prepare 必须在用户手动重开干净 disposable copy 后重新开始，工具不得替用户保存或覆盖当前模型。

> **2026-07-22 大模型有界提案、target quality 与 execution contract 边界：**`auto / structural_groups / full_recursive` discovery、plan `.3`、`existing-edit-target-validation.v1` 与 `existing-edit-execution-target-validation.v1` 已实现；eligible Group property edit 的六阶段 structural validation 是 trusted mock 证明，其他 operation 保守回退 full recursive。修复后的选择器在几何唯一最大目标 locked/ineligible 时中止，不会隐式选择第二大目标；等几何并列也不能被不可信模型名称打破。当前源码只读 live 已用四个独立真实 SKP/revision 验证固定 `largest group` 目标：唯一选择 `3 / 3` 与独立 oracle 一致、歧义中止 `1 / 1`、top-5 `3 / 3`、`138` 次 artifact 分页，所有执行硬门禁为 0，且无 approval/mutation/save。7 月 21 日 plan `.3` capture 因 proposer 后续变更只保留为 historical exact-source snapshot；它没有 current reviewed-plan replacement。当前证据不证明宽泛语义理解、post-approval native mutation、跨版本或发布验收。

> **2026-07-22 可丢弃副本授权与受控 S4 live 边界：**用户已明确授权配置目录内的副本模型可直接修改。实现将这一授权固化为 server-only `trusted_model_copy_auto_approval`，而不是取消安全合同：canonical model path、root fingerprint、risk、级联后的 affected count、save policy、plan hash、完整 model revision、fresh Session Contract 与 idempotency 仍需全部匹配；Agent 自报能力/approved/reviewer 不能启用。默认目录外 S2-S4 仍走本机真人审批。当前源码用一个 byte-exact Fire Escape 副本完成一次不保存的 S4 delete：guided 响应明确暴露 `pid:9287.9289` 删除会触发 `pid:9287` 空父组清理；一次 submit 后 receipt finalized、两者均缺失、revision 改变、disk bytes 未变、queue `0/0/0` 且无 lock。严格 schema/mock/live evidence 分别为 `docs/evidence/trusted-model-copy-auto-approval-v1-mock-evidence.json` 与 `docs/evidence/controlled-s4-delete-live-evidence-2026-07-22.json`。这是单副本受控破坏证明，不是宽泛 S4、save/reopen、fresh-process、跨版本或发布验收。

> **2026-07-22 current-source save/reopen identity 边界：**当前 `.7/v1.4/definition-merkle.v2` runtime 已完成一次 `target -> distinct intermediary -> target` 的真实保存、文档切换与重开。42 / 42 persistent occurrence identity、2 个 shared leaf occurrences、36 个 Face/Edge entries、revision/source attestation 与 zero-tolerance snapshot 均精确一致，重开后 clean 且 queue 全清。权限仅由显式本机 QA 进程策略提供，默认 policy 未放宽。证据为 `docs/evidence/current-source-save-reopen-identity-live-evidence-2026-07-22.json`。它关闭底层 identity/save-reopen 缺口，不等于 FeatureHistory lineage、observer/manual divergence、多模型 corpus、跨版本或发布验收。

## 1. 现场复核基线

2026-07-15 在当前 checkout 重新核对：

- 当前实现起点 HEAD：`ee0708adf845c51f71294091b8013e1cc6aa8979`，分支 `codex/agent-contract-v1`；本轮未创建新提交。
- 工作树开始时只有用户/其他 Agent 的未跟踪 `RELEASE_PREVIEW_ZH.md`；本路线不覆盖、不删除、不提交该文件。
- stdio MCP `tools/list`：41 tools（保留 36-tool expert surface + 4 Gateway tools + `create_queue_handshake`）。
- safe JSON DSL registry：101 operations，其中 57 个允许 `component_definition` scope。
- 稳定性分布：17 stable / 73 beta / 11 experimental。
- restricted Python source corpus：35 cases，29 个编译到 canonical golden，6 个稳定分类为 unsupported。
- Existing Model Editing Engine 已有 plan/apply、persistent occurrence path、model revision、S1-S4 risk、shared-definition policy、stale-plan rejection 和 before/after/diff/QA。
- image-structured 主线 adapter 仍为 review-gated / preview-only；不自动调用 queue。
- `ParametricRecipe -> FeatureMappingPlan -> PartGraphCorrectionPatch -> reviewed PartGraph -> safe JSON DSL` 已进入当前主线事实基线。
- 当前架构分支的门禁为根级 `npm test`、41-tool mock/live capability suite、Session Contract contract tests 和 Existing Model Editing mock QA。当前 stable top-level error registry 为 40 项。live 结论只按对应精确源码 hash 的证据声明，不由 `plugin:check` 推断。`03fc30ca...a89`、`e02517ba...41a`、capability `.5` / manifest `.v1.3` 的 `4ea76fca...7d94` 及其 Model Revision hash 都是各自历史 evidence 的精确 lineage，不是当前 runtime。Portal v8 加载的 Boolean SHA 为 `2e3d686b...c444`；当前 workspace 为 `b98fd554...7610`，差异必须显式阻断重放，直到安装、完整重启和 fresh attestation。所有证据仍 `release_acceptance=false`。

计数是不同层的事实：当前 41 MCP tools（其中 36 个为 expert surface）不等于 101 operations，101 operations 不等于完整 SketchUp API。

## 2. 分支与发布边界

### RC 发布线只接收

1. tool registry / stdio / HTTP 同源和 parity 防回归。
2. Queue QA 默认 mock、显式 live 危险提示和中断清理。
3. HTTP 本地服务的 loopback、body limit、auth、path policy、timeout、错误码、测试和运维文档。
4. 不改变现有低层 36-tool 行为的文档/合同对齐。

### 后续架构线

Agent Contract v1、ModelGraph v1、DesignIntentGraph、视觉校正和 compatibility harness 在独立分支推进。用户已确认后，当前已创建并切换到 `codex/agent-contract-v1`；起点为发布修复提交 `c9eb0f7`。`codex/two-week-release-critical` 保持在该提交，不混入后续架构工作。

除用户已明确确认的发布修复提交和架构分支创建外，本轮不继续 commit、merge、cherry-pick、reset、revert 或删除工作树内容。

当前同名 `0.1.0-rc.2` RBZ 已与历史 manifest/sidecar 不匹配，状态为 `invalid_for_signed_rc`。发布工具对 canonical RBZ、checksum 和 manifest 采用共享独占锁与 create-new-only 规则；不得覆盖现存三件套。可接受的恢复只有找回与历史 size/hash 精确一致的 RBZ，或提升版本后重新生成并签名完整制品集。

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
- `/tools` 从共享 registry 返回当前工具集；本轮为 41 tools，后续增减不需要手工同步 HTTP。
- 能力套件默认 `mock`；只有 `--runtime queue` 才能进入 live queue，`--queue-required` 只能与显式 queue 组合。
- queue 开始前明确警告会 reset/修改当前 SketchUp 模型。
- SIGINT/SIGTERM/异常时清理本进程 request/lock；正式 reliability runner 还会精确收敛六种纯只读 claimed request 及其迟到 response，修改类/未知 outcome 仍保留。
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
- S1 可依用户 execution policy 自动批准；S2-S4 默认必须由可信用户通道逐任务批准，或由用户预先配置且 hash-bound 到 exact 副本 root/risk/budget/save policy 的 server execution policy 授权。
- `review.status=approved` + `reviewer` 字符串不再是 S2-S4 授权依据。
- guided / standard / expert 三档入口。guided 默认服务端持状态，expert 保留原 36 tools。
- 少量高层 task tools：create/understand/propose/review/execute/verify/resume 语义，不要求普通 Agent 自己编排全部底层工具。
- 模型内名称、材质、attributes、OCR 统一标记 `untrusted_data`，不能改变 workflow/policy。

验收：

- Agent 伪造 approved/reviewer 必须失败。
- token 重放、过期、plan hash 变更、model revision 变更、operation 越权全部失败。
- 未经可信用户授权的 S2-S4 执行=0；可信授权可来自逐任务 user-presence decision，或用户预先配置的范围化副本 policy，永远不能来自 Agent 自报。
- `get_workflow_bundle` 覆盖 create/understand/reviewed edit/image artifact/verify，移除过时 `nested_read_only` 口径。
- `get_docs(topic, detail, max_chars)` 或等价渐进读取，普通 Agent 不再必须一次消费约 22 万字符。
- `Local Approval Host v1` 必须仅绑定 loopback，使用独立口令、逐次 reauthentication、Host/Origin/CSRF/XSS 防护，token 不返回 Agent；浏览器自动化只能验证隔离测试状态，不能代替真实用户批准。

### P0-C — Fresh Queue Handshake / Session Contract v1

交付：

- 显式 queue-only `create_queue_handshake`，只读读取 plugin session、document/model identity、model revision、plugin/server/capability versions、queue state 与 expiry；不得创建、reset、open 或修改模型。
- 短时签名 `session-contract.v1`；MCP server restart、plugin restart、切换模型、revision 漂移、过期、版本/capability 漂移全部 fail closed。
- 所有 live mutating tools 在同一 queue 排他锁内先验证合同，再执行完整高层操作；复合 tool 的内部 build/save/capture 共用一次授权边界。
- lock、stale lock、pending request、已 claim processing request、orphan response 使用稳定错误码与 `next_action`，不自动越过残留状态；plugin crash 后的 processing request 不自动重放。
- planning/revision 路径使用 `adopt_open_model read_only=true`，避免 prepare 阶段写 adoption attributes。

验收：schema + mock/contract tests；缺失/篡改/过期/restart/model switch/stale revision/capability drift 执行次数为 0；默认 `npm test` 不接触 live SketchUp。live handshake 实测仍需用户明确配合。

### P1 — ModelGraph v1 + 修改提案器

当前状态：P1 的 durable ModelGraph/proposer、queue-shaped golden、schema、Ruby source-shape 和有界 execution mock 已闭环；当前 `.7/v1.4/definition-merkle.v2` 安装源码也有 fresh-process Agent Gateway live 只读证据。一个 byte-exact 5,859-occurrence disposable 模型完成 ambiguity/unique/tie 三类路径。Trimble S6 暴露完整 recursive leaf materialization 不适合大模型后，已加入两阶段 discovery、独立 projection completeness、plan `.3`、hash-bound `existing-edit-target-validation.v1` 与六阶段 `existing-edit-execution-target-validation.v1`。7 月 21 日在完整 `71,360 / 71,360` revision 上采集的 proposal→plan `.3` 只读记录证明了 capture-time `41 / 41` Group 绑定与 reviewer-visible policy，但 proposer 随后修复，因此该记录已降为 historical exact-source snapshot，尚无 current reviewed-plan replacement。mock trusted reviewed execution 已证明 eligible Group path 不物化 recursive leaves，tamper/`make_unique`/topology 均 fail closed 或 full recursive。正式 L0 mock benchmark 的 4 域/5 任务记录 top-5 `3 / 3`、歧义中止 `2 / 2`、shared 澄清恢复 `1 / 1`；当前源码 real-SKP benchmark 又覆盖四个独立真实 fixture/revision 的固定 `largest group` 目标，唯一选择 `3 / 3`、歧义中止 `1 / 1`、138 次分页且四项硬门禁为 0。live post-approval native mutation、宽泛语义目标与 release acceptance 仍未完成。

交付：

- 持久、版本化 ModelGraph：occurrence/definition、parent-child、Face/Edge summary、material/Tag/Scene/attributes/classification、空间/拓扑关系、shared impact、lineage、model revision。
- `propose_existing_model_edit`：自然语言目标 -> candidate targets/evidence/confidence/exclusion/operation proposal/shared policy/risk。
- proposal 只进入 task state，不直接执行；执行仍通过可信 review + Existing Model Editing Engine。
- 建筑、室内、产品、深层共享组件 benchmark。
- 按可信 model identity 持久化的 model-level store：原子版本、内容 hash、restart recovery、跨 document 隔离、版本 delta 和完整性 fail closed。
- queue `pid:` occurrence path 归一化为 `canonical-occurrence-path.v1`；recursive truncation、不存在/重复/locked target 与不允许 operation 全部拒绝提升。
- proposal -> reviewed edit 由服务端持久的 task/proposal/hash/graph/revision 绑定；Agent 不能重传 targets/operations 替换已提案内容。
- queue adoption 与紧随的只读 handshake 绑定同一 plugin session/document/model identity/occurrence contract/完整 revision counts；MDI 切换和不完整 revision 都 fail closed。
- 原生 SketchUp classification 只保存 schema name/namespace 与 definition attribute 不透明指纹；assigned schema type 不可枚举时明确 `unknown/incomplete`，不解释未公开 dictionary 结构。

硬验收：歧义必须 `awaiting_input`；错误目标不得自动执行；target top-k、错误对象修改率可计量。正式 mock benchmark 已把 top-k、歧义、澄清恢复、调用次数与四项硬门禁结构化计量并由严格 schema/19 个负例守护；四模型 live 聚合补充了一个固定结构 superlative 的 real-SKP 验收，但不升级为宽泛自然语言语义、reviewed execution 或发布验收。

### P2 — DesignIntentGraph / FeatureHistory

当前状态：已完成 model-scoped durable DesignIntent/FeatureHistory 工程闭环。建筑、产品、室内三域 mock 覆盖不可变版本、save/open/reload、参数受影响子图、reviewed rebuild、divergence 与 trusted reconciliation；current-source live 又在一个小型 SketchUp 组件副本上把真实 DesignIntentGraph sidecar、`task_id`、`pid:92187` binding 与保存/完整重开共同绑定。重开后 revision/graph/binding/FeatureHistory version 精确一致；一次故意不保存的材质偏差使后续参数计划停在 0 operations，并生成 `awaiting_review` reconciliation。Agent 自报采用偏差返回 `APPROVAL_REQUIRED`，FeatureHistory 未晋级，磁盘与 source fixture 不变。严格证据见 `docs/evidence/design-intent-live-lineage-evidence-2026-07-23.json`。该证据是 task-time 检测，不宣称连续 observer；live trusted reconciliation acceptance、多 live 域与跨版本仍未证明，`release_acceptance=false`。

交付：

- ParametricRecipe / FeatureMappingPlan / PartGraph / correction history 与 persistent SketchUp entities 双向映射。
- 设计参数修改与受影响子图重建：门宽、阵列数量、孔径、墙厚、关联门窗。
- save/reopen 后 lineage 不漂移；手工编辑导致 divergence 时生成 reconciliation/review，不静默覆盖。
- 至少三个不同领域样例，不停在 Switch fixture。

验收：参数编辑后仅重建受影响子图；保存/重开 identity 稳定；divergence 不自动 promotion。

### P3 — 参考图驱动的现有模型校正

当前状态：已完成 immutable reference CAS、服务端 current-view capture、adoption-capture-adoption revision guard、结构化 evidence/alignment/difference、私有 CorrectionPatch、reviewed route 与 QA 的 mock/source-contract 闭环；CAS 发布竞态已用 64 路相同 ingest 证明只产生一个稳定 record/inode，replay ctime 不变，异常 hard link fail closed。另已在 `Trimble S6` disposable copy 上完成一例窄范围 current-source live 因果链：3 张外部参考图以 immutable hash 绑定到 S3 plan，server-only 副本策略自动授权，26 个操作及 30 个预期装配接触共同进入 plan hash，单次 submit 后 receipt finalized；21 / 21 新增组、材质与下前面板检查、raw Model QA、recapture、queue cleanup 均通过，磁盘副本字节未变且未保存。外部图像、模型名称、材质和 attributes 始终按 untrusted data 处理，不能改变执行策略。后续 server-owned 只读正视图最初因 background 误分割而保持 `review`；现已对同一组 immutable bytes 增加无补白、保纵横比的 row-conditioned border flood + foreground registration。capture bounds 从全宽收敛到 `[0.386719, 0.027778, 0.613281, 1]`，固定门槛下 silhouette IoU `0.569986`、Dice `0.726104`、aspect log delta `0.163759`，得到仅限粗结构的 `coarse_structure_pass`。appearance MAE `0.296766` / RMSE `0.380301` 仍只作诊断，整体继续 `review_required=true`、`visual_similarity_accepted=false`，且没有启动 SketchUp、queue、promotion、mutation 或 approval。该算法现已接入正式 `visual-correction-qa-result.v1`：服务端生成 comparison 与 8 个 immutable image handles，L0 guided/no-file/no-vision 的 4,096 字符投影保留 verdict、IoU/Dice、appearance 与 fail-closed 边界，完整结果可分页恢复，Agent 伪造 comparison/acceptance/approval 字段会失败。architecture/product 两个不同 model key 又分别完成 full-quit/reopen capture consistency：`5,859 / 5,859` 与 `71,626 / 71,626` complete adoption、fresh plugin session、exact revision/camera/spec、before/after PNG byte equality、IoU/Dice=`1`、模型和 queue 不变。它关闭两域同模型 fresh-process 复验，不关闭外部参考图独立 camera-pose 或跨模型质量；跨版本按用户决定暂缓，`release_acceptance=false`。

交付：

- reference/input image -> capture_view -> structured evidence -> alignment/difference -> CorrectionPatch -> review -> edit -> recapture/QA。
- 服务端产出结构化视觉摘要；无视觉 Agent 可完成，有视觉 Agent 可选看 overlay/thumbnail。
- image promotion 继续 fail closed。范围限定在“参考图校正已有模型”。

验收：无视觉 L0 Agent 只使用 structured summary 完成 review；未通过 review 的 patch 执行=0；校正前后差异可审计。

### P4 — 真实模型可靠性

> 2026-07-23 authoritative update：正式 current-source live corpus 已完成 `7 / 7` cases、`23 / 23` named tasks 和 `3` 个 guarded geometry-mutation cases；wrong-object / silent-corruption 均为 0，恢复 `2 / 2`，每例 save/reopen 与 queue cleanup 通过。最后的 product Boolean 受控 overlay 证明 exact target replacement、tool/non-input isolation、manifold/material preservation 与 `71,868 / 71,868` identity。严格聚合见 `docs/evidence/current-source-real-model-reliability-live-evidence-v6-2026-07-23.json`。下方 `5 / 7`、Boolean/manifold 或 dirty-topology 尚未完成的过程段落保留为历史诊断，均由本段与后文已勾选 v6 里程碑取代；受控 overlay 仍不外推为任意产品 Boolean/CAD repair，跨版本 deferred，`release_acceptance=false`。

当前状态：已有 7-case / 23-task hardened mock corpus，并覆盖外部文件 realpath、`O_NOFOLLOW`、TOCTOU、symlink 和 sidecar fail-closed。用户本地 corpus 现为 6 个 SKP 候选，`6 / 6` candidates confirmed、`7 / 7` semantic categories mapped；`7 / 7` formal readiness sidecars 已生成并通过 hash/content/authority 校验，但 readiness sidecar 本身仍全部 blocked，不能授予执行权限。独立的 hash-bound current-source live harness 现已通过 `deep-shared-components`、`interior-expression`、`scaled-mirrored-locked`、`appearance-scenes-hidden` 和 `architecture-golden` 五例：`5 / 7` cases、`17 / 17` named tasks、`1` formal geometry-mutation case，wrong-object 与 silent-corruption 均为 0，恢复 `1 / 1`。appearance 例在 byte-preserved `Fire Escape` 派生副本上加入真实纹理、FaceUV、1 个 Scene 与 1 个隐藏 target，正式保存/重开后两类 signature、model revision 与 `5,897 / 5,897` occurrence identity 均精确一致。architecture 例在独立派生副本上只加入受控材质目录项与 1 个 Scene，不改变几何；保存/重开后材质和顶层 Scene/visibility signature、model revision 与 `5,859 / 5,859` occurrence identity 均精确一致。architecture 结论不独立证明所有嵌套 hidden occurrence，FaceUV 结论也只覆盖结构化 payload、材质 signature 和无 texture-position warning，不是独立 UVHelper 坐标读回或任意 UV 编辑证明。Portal disposable product case 的 S3 负向 atomic trial 仍只作失败 lineage，不是成功 mutation case。Boolean/manifold 与 dirty topology 两例仍缺。用户明确暂缓跨版本矩阵，该项是 deferred，不是 pass，也不支持 beta/experimental 稳定性升级。

2026-07-23 dirty-topology runner hardening：单窗口 `prepare-only -> --active-working-copy` 已避免 runner 再创建 SketchUp 文档；O(1) `get_active_model_identity` 取代激活轮询中的全局 revision。第一次 current-source dirty-topology 正式尝试证明初始 `boundary_edges` 检测成立，但实际 repair 在 commit 前 fail closed，源文件和工作副本磁盘哈希未变、queue 全清，因此不计入 live pass。根因已定位为 `manifold_repair` 错误复用“输入必须已是 manifold”的 Boolean target resolver；现已拆成允许非流形 Group、仍拒绝 locked/invalid target 的专用 resolver，并完成 Ruby/Node/mock 回归。失败报告同时保留稳定 `code/phase/commit_state/abort_succeeded/operation_failure_code` 与已完成任务证据。大模型写入的 fresh handshake 签发和 Node 侧验证也已合并到同一 exclusive scope，把每次写入从两次 server global revision scan 降为一次，同时保留 Ruby transport guard 的独立最终扫描。以上均为离线修复和 runner hardening；安装后 fresh-process live rerun 尚未完成，P4 仍保持 `5 / 7`。

2026-07-21 补充：Portal 产品样例的 historical v1 target selection 仍有效作 lineage，但一次跨重启 revision drift 证明 v1 错把进程内 `entityID` 当成了内容身份；用户报告曾调整样式，这足以解释独立观察到的 `model_modified=true`，但不作为 revision drift 的唯一归因。current execution 已迁到 `definition-merkle.v2`、reliability execution plan v2、Portal workflow v3 和 save/reopen report v2：persistent id / Alma custom reference 是唯一实体身份，缺失或重复身份 fail closed；容器枚举、Face loop 起点/方向、洞顺序、Edge 端点方向和 JSON key 顺序被规范化，而 transform/material/attribute/真实几何变化仍改变 revision。迁移目前只有离线合同与 mock evidence；旧五模型 v1 live evidence 不会被刷新为 v2，必须在安装并完整重启后另建 current live evidence。

交付：

- 暂停为数量新增 operation。
- 小而难 corpus：建筑、室内、产品、深层 shared definition、CAD/脏拓扑、材质/场景/隐藏、缩放/镜像/locked。
- boolean/manifold、UV/material preservation、large recursive index、rollback、save/reopen identity、SketchUp 版本差异验证。
- 用任务成功率、错误对象修改、静默几何损坏、恢复率代替 operation count 叙事。

验收：每个 beta/experimental 升级必须有 corpus evidence、负面样例和 rollback/reopen 结果。

### P5 — Agent Compatibility Harness

当前状态：已完成 `21 / 21` constrained L0/L1/L2 mock scenarios；指标由 `536` 个真实 Gateway dispatch events（其中 `468` 个为受 4,096 字符生产投影上限约束、由 public tool accounting 直接统计的 `read_agent_artifact` 分页调用）、`24` 个 mutation events/model diffs、`24` 条 mutation ledger 与 `6` 个 HMAC-verified receipts 派生。L0 的全部七类场景已强制穿过 canonical JSON text 边界，共 `173` 次 lossless round trip、`0` failure；undefined optional fields 显式省略，非 JSON 值 fail closed。错误对象自动执行、未授权 S2-S4 执行、重复请求重复修改三项硬门禁均为 `0`。另有三个真实 ephemeral Codex CLI 进程：柜体与共享 component 双实例 fixture 各完成 4 次 hash-chained L0 Gateway 调用，覆盖 understand、精确幂等重放、按 `task_id` 恢复与歧义 edit 中止；第三个 reference/capture fixture 只用 2 次调用完成服务端 structured image summary 与 metadata-only overlay handle 读取，无视觉/无本地文件 Agent 未收到图片 bytes，S2 correction 停在 `awaiting_review`。聚合为 3 个 fixture family、2 个 workflow family、3 个独立进程、10 次调用，三个 revision 均未改变，unexpected command 与三项硬门禁均为 0。它证明独立进程、fixture/workflow diversification 和 no-vision image-summary transport，不证明多厂商/明确模型、live SketchUp、视觉质量或 production human approval。

交付：

- L0：短上下文、无文件、无视觉、单工具。
- L1：结构化输出、可保留 task_id，但无并行/视觉。
- L2：长上下文、文件/视觉/并行能力。
- 故障注入：丢状态、重复调用、错 enum/字段、stale plan、伪造 approval、忽略 warning。
- 任务：create、understand、ambiguous edit、make_unique、image summary、stale recovery、resume、idempotent retry、human approval、scoped disposable-copy authorization。
- 指标：完成率、调用数、schema error、无效重试、target top-k、错误对象修改、未授权执行、恢复率。

硬门禁：

- 错误对象自动执行 = 0。
- S2-S4 未经可信用户授权执行 = 0；逐任务批准与 server-configured disposable-copy standing authorization 分开计数。
- 重复请求导致重复修改 = 0。

## 5. 制品与证据规则

每个里程碑必须同时交付：

1. 版本化 schema/contract。
2. positive + negative + replay/stale tests。
3. mock evidence report，包含版本、fixture hash、指标和验收结论。
4. 可恢复的 artifact manifest/handle。
5. 保守文档口径。

live queue 不是默认测试。只有用户明确配合并确认当前模型可以安全操作，fresh `get_capabilities --runtime queue` 成功且显式 `create_queue_handshake` 返回有效 Session Contract 时，才进入 live 验收。握手本身不得 reset/修改模型；后续测试是否 reset/修改由具体命令决定。`plugin:check` 不能替代。

## 6. 当前执行记录

2026-07-15：

- [x] 审计分支/HEAD/工作树与 36/101/57 基线。
- [x] 确认 `RELEASE_PREVIEW_ZH.md` 为未跟踪用户稿，保持不变。
- [x] 确认 HTTP 34-tool 硬编码、未显式 loopback bind 和其他安全缺口。
- [x] 确认 Queue QA 默认 `auto` 会探测 live queue。
- [x] R0 实现与全量验收：当时 36-tool registry parity、默认 mock queue safety、中断 cleanup、HTTP 安全边界、文档与操作指南已完成；共享 registry 随 Gateway/handshake 自动扩展到当前 41 tools，stdio/HTTP/docs/tests 继续同源。
- [x] P0 的发现/短上下文兼容前置：`get_docs.v2` 支持 `topic/detail/max_chars`，workflow bundle 覆盖 create/understand/reviewed edit/image artifact/verify，MCP 返回 `structuredContent`。
- [x] 用户确认后提交 R0 为 `c9eb0f7`，创建并切换 `codex/agent-contract-v1`；发布分支保持在同一提交，未 push/merge。
- [x] P0-A：落地版本化 task/result/artifact schemas、11-state machine、原子持久 task store、disk restart resume、idempotency 和 opaque artifact handle；后续 model identity/revision/graph 与 recovery/integrity 加固后，当前 stable error registry 为 40 项。
- [x] P0-B mock 闭环：保留 36 expert tools，增加 4 Gateway tools；可信一次性 approval 绑定 task/plan hash/model revision/risk/operations/expiry；伪造 review、tamper、stale、replay 和越权均 fail closed；S1 仅显式服务端策略可自动批准。
- [x] P0-B production host + 单模型 S2 live：新增 loopback-only `Local Approval Host v1`、scrypt 口令、逐次 reauthentication、Host/Origin/CSRF/CSP/XSS 防护、批准/拒绝一次性决定和服务端私有 token 消费；Gateway resume/submit 不向 Agent 暴露 token。真实用户已在 current-source S2 challenge 上完成逐次批准，第二次修复后运行进入 `completed` 并 finalized durable mutation receipt。首次运行暴露 Save As identity drift 并被严格 gate 拒绝；修复改用 `Sketchup::Model#save_copy` 后安装、完整重启和复验成功。证据见 `docs/evidence/local-approval-live-evidence-2026-07-16.json`。
- [x] P0-B 范围化副本授权 + 单模型 S4 live：新增 server-only copy-root/risk/affected/save policy、公开 root 脱敏摘要、plan/live preflight binding、目录外 fail-closed、Agent capability 不可提权和幂等回归。第一次 S4 live 发现 SketchUp 会在删除唯一子组后异步清理空父组；该影响现已进入 `destructive_side_effects`、affected budget、plan/review hash、guided projection 与 postcondition。当前源码第二次用新副本一次提交完成，receipt finalized、target/parent 均 absent、disk 未保存、queue 全清。证据见 `docs/evidence/trusted-model-copy-auto-approval-v1-mock-evidence.json` 与 `docs/evidence/controlled-s4-delete-live-evidence-2026-07-22.json`；`release_acceptance=false`。
- [x] P0-B Copy Fast UX closure（current-source mock + scoped live）：新增 process-local、model-copy-bound `copy-fast-session.v1` 与脱敏 public summary；命中 root 的 S1-S4 plan 直接 `approved -> execute_copy_edit`，不创建逐任务 challenge。S1/S4、跨 task/revision reuse、幂等重放、目录外拒绝、Agent 自报无效、restart/expiry/revoke fail-closed 与 save-path root guard 均由严格 schema/负例覆盖，默认 queue calls=0。2026-07-24 的精确 Fire Escape disposable copy 又完成 current-source S4 live replacement，0 challenge、finalized receipt、无重复修改、disk unchanged、queue clean。见 `docs/copy-fast-mode-v1.md`、`docs/evidence/copy-fast-session-v1-mock-evidence.json` 与 `docs/evidence/copy-fast-session-v1-live-evidence-2026-07-24.json`；这是 scoped milestone，`release_acceptance=false`。
- [x] P0-C mock/contract 闭环：增加只读 `create_queue_handshake` 与签名 `session-contract.v1`；41-tool registry 中所有 live mutating tools 暴露 `session_contract`；restart/model switch/stale/expiry/capability/queue residue 全部在 mutation 前 fail closed。
- [x] P0 回归证据：2026-07-16 的顺序 `npm test`、`npm run test:image-structured`、`npm run plugin:check`、tool/operation registry checks、mock-evidence hash integrity 与 `git diff --check` 全部通过；证据见 `docs/evidence/agent-contract-v1-mock-evidence.json` 与 `docs/evidence/session-contract-v1-mock-evidence.json`。
- [x] P0 合同加固：Agent Gateway 与 direct expert queue policy 分离；preflight handshake/queue/policy 错误保留可恢复 task。可信 mutation receipt 已持久化时由 single-owner finalizer 恢复且不重放 mutation；无 receipt 的 native-commit crash window 保留 `outcome_unknown` 并禁止自动重试。
- [x] P0 输出/生态加固：HTTP 对 thrown error 与 Gateway failure envelope 统一 4xx/423/428 映射并移除内部 details；`result`/`data` 同 payload，warnings 合并去重，artifact integer offset pagination 可读到 EOF；workflow bundle 由测试校验 registry schema required 参数与 mutation 间 fresh handshake。
- [x] P0 生产 caller 能力约束：`agent-response-policy.v1` 持久化 server-trusted profile 与公开请求的交集；默认 guided/4,096 字符/no-files/no-vision/same-task=1，公开 expert/vision/files/parallel 自报不能升级。超限 `understand_model` 与通用 envelope 生成确定性摘要和 capability-safe artifact，artifact 读取再次应用路径/视觉策略；`structured_output=false` 仍获得稳定 JSON envelope。新增 schema/mock 回归，不调用 queue；这不等于独立真实 Agent benchmark。
- [x] P1-A mock/fixture/source-shape：model-level durable ModelGraph store、source-path-first 不透明 model identity、canonical queue `pid:` hierarchy/topology、strict revision/completeness/exact-target/locked-ancestor abstention、trusted artifact lineage、reserved routing override 拒绝和 server-bound proposal promotion 已实现；建筑、室内、产品、深层共享组件 mock benchmark 与 queue-shaped golden 通过。
- [x] P1-A native classification 保守闭环：已按公开 Ruby API 枚举已加载 schema name/namespace；definition assigned type 不可枚举，因此保持 `assignment_presence=unknown`、`complete=false`、不回显 attribute values，不调用 classification mutation API。当前证据为 mock/schema/source-shape，非 live。
- [x] P1-B current-source live：22-file installed/workspace manifest 精确一致且 SketchUp 完整重启；当前 `.7/v1.4/definition-merkle.v2` 对一个 byte-exact disposable 模型完成弱能力 guided Agent Gateway `understand_model` + proposal-only 闭环。revision `5859 / 5859` 完整；泛化语义请求歧义中止，结构化正例唯一选择内层含几何 Group，同包围盒 superlative 反例再次中止，且排序器不再以 `node_id` 打破几何平局。所有提案均 `execution_allowed=false`，公共 artifact 分页可恢复，前后签名 handshake、model bytes、revision、`model_modified=false` 与 queue 全部不变。证据见 `docs/evidence/current-source-agent-gateway-live-readonly-evidence-2026-07-21.json` 与 `docs/evidence/current-source-agent-target-quality-live-evidence-2026-07-21.json`。这仅是单模型 scoped proof，未执行 mutation，`release_acceptance=false`。
- [x] P1-C 大模型有界 Group discovery：在 Trimble S6 的完整 `71,360 / 71,360` revision 上，guided `largest group` 由服务端自动路由到 `structural_groups`，只物化完整 `41 / 41` Group projection 和 0 个 Face/Edge leaf；Graph 保留 `recursive_index_not_requested` blocker，提案以 `0.86` 选中 `pid:89456` 进入 review。回归覆盖 71,360-occurrence fixture、projection scope mismatch、truncated global ranking abstention、exact returned path、equal-geometry ambiguity 与 expert full-recursive override。live 前后没有 approval/mutation/save，模型与 queue 不变；证据见 `docs/evidence/current-source-agent-bounded-group-live-evidence-2026-07-21.json`。旧 full-recursive 尝试只记为已中止的性能发现，不宣称 native crash。
- [x] P1-D 有界 reviewed-plan preparation：新增严格 `existing-edit-target-validation.v1` schema；只有 server-bound、canonical Group path、非拓扑对象操作可复用结构 projection，caller 伪造 selector 在 queue 前失败，破坏/拓扑操作保留 full recursive。Trimble S6 current-source live 用第二次完整 `41 / 41` probe 将 `pid:89456` 精确绑定到 S2 rename plan，challenge 保持 pending 且没有 decision/token；proposal 与 plan stage 各约 24 秒，非性能保证。模型/queue 未变，证据见 `docs/evidence/current-source-reviewed-plan-live-evidence-2026-07-21.json`。
- [x] P1-E 有界 reviewed execution 合同与 mock 闭环：plan 升为 `.3` 并把完整 `target_validation` 纳入 `plan_hash`；审批 context 明示 execution validation policy。新增严格 `existing-edit-execution-target-validation.v1`、共享 canonical PID mock resolver 和 trusted reviewed mutation 回归。eligible `definition_wide` Group property edit 在 Gateway preflight、apply preflight、iteration before/after、post-apply、finalization 六阶段均 exact-target、0 leaf；伪造 target validation 在任何 model observation 前失败，`make_unique`/topology 保守 full recursive。该项尚无新的 live approval/native mutation，不复用旧 token。
- [x] P1-F plan `.3` capture-time 只读复核：同一 byte-exact Trimble S6 disposable 模型完成 proposal/plan 两次 `41 / 41` bounded Group probe；plan hash 与 target validation 一致，审批 context 明示 `existing-edit-execution-target-validation.v1` structural policy。challenge 保持 pending，未产生 decision/token/execution/mutation/save。由于 proposer 随后修复，严格证据 `docs/evidence/current-source-reviewed-plan-v3-live-evidence-2026-07-21.json` 现为 historical exact-source snapshot，不能计作当前 reviewed-plan acceptance；尚无 current replacement。
- [x] P1-G 跨领域 target-quality benchmark：新增严格 benchmark/report/evidence 三份 schema、可重复 runner 与 4 域 5 任务 fixture。L0/no-file/no-vision/short-context/single-tool profile 在 architecture/product 各完成唯一选择，在 interior/shared 各正确中止歧义，并以 exact occurrence + `make_unique` 恢复 shared proposal；top-5 `3 / 3`、ambiguity `2 / 2`、clarification `1 / 1`、191 artifact page calls，错误对象自动执行/未授权 S2-S4/重复修改/歧义自动选择均为 0。两次 report byte-equal，原始模型标签不进入公开报告，默认不调用 queue。证据见 `docs/evidence/model-graph-target-quality-v1-mock-evidence.json`；随后由 P1-H 补上窄范围真实 SKP 验收。
- [x] P1-H 四领域真实 SKP 当前源码 target-quality：architecture、deep-shared、interior、product 四个 byte-exact fixture/revision 均以 fresh signed handshake、完整 revision 与只读 structural Group projection 运行。固定 `largest group` 目标中，3 个唯一最大目标全部与 server-private world-bbox oracle 一致并进入 top-5，1 个等体积并列正确中止；共 `4` 次 Gateway task 与 `138` 次 artifact page，schema error 0，模型 bytes/revision/modified 状态及 queue 前后不变，四项硬门禁为 0。公开聚合不含原始标签或路径，证据见 `docs/evidence/current-source-multi-model-target-quality-live-evidence-2026-07-22.json`。该里程碑只证明一个结构 superlative，不证明宽泛自然语言语义或 mutation。
- [x] P2 durable mock 闭环：参数/feature/persistent entity 映射、model-scoped immutable history、依赖子图 rebuild proposal、save/open/store reload 与 divergence reconciliation 覆盖建筑门墙、产品孔径和室内阵列。
- [x] P2 live 基础 identity：当前 `.7/v1.4/definition-merkle.v2` runtime 完成 target -> distinct intermediary -> target；42 / 42 occurrence identity、shared leaf 2、Face/Edge 36、revision/source attestation、zero-tolerance diff 与 queue cleanup 全部通过。证据见 `docs/evidence/current-source-save-reopen-identity-live-evidence-2026-07-22.json`。
- [x] P2 live lineage / divergence：同一小型 disposable SKP 在保存和完整 SketchUp/plugin 重开后恢复原 `task_id`、DesignIntentGraph、`pid:92187` binding 与 1 个不可变 FeatureHistory version；故意不保存的材质偏差阻断参数 rebuild（0 operations），生成一次 `awaiting_review` reconciliation，Agent 自报采用被 `APPROVAL_REQUIRED` 拒绝，history 不晋级且 disk/source bytes 不变。证据见 `docs/evidence/design-intent-live-lineage-evidence-2026-07-23.json`。连续 observer、live trusted acceptance、多 live 域和跨版本不在此证明内。
- [x] P3 mock/source-contract + live capture ingress：immutable image CAS、服务端 current-view capture、adoption-capture-adoption revision guard、临时路径/symlink fail-closed、结构化 evidence/alignment/difference、私有 CorrectionPatch、reviewed edit 路由和 QA 已完成；current-source live capture 又证明 1280×720 PNG、immutable handle、结构化 provenance、采集前后状态不变和临时清理。
- [x] P3 CAS 并发加固：64 路相同 image ingest 只发布一个 durable record/inode，replay 不改变 ctime，临时 hard-link window 被读取端重试，持久 unexpected hard link fail closed。证据仍是 mock/source-contract。
- [x] P3 scoped live/causal milestone：`Trimble S6` 的 3 张真实参考图、26 个操作和 30 个预期接触均绑定到同一 S3 plan hash；server-only disposable-copy policy 自动授权，Agent 未获得 token 或策略控制权。单次 submit 完成并 finalized，21 / 21 新增组、材质/下前面板、raw QA、recapture、queue cleanup 通过，磁盘 SHA 未变且没有 save。严格证据见 `docs/evidence/trimble-s6-reference-correction-live-evidence-2026-07-22.json`。
- [x] P3 补充结构化诊断：server-owned 正视图完整框入三脚架，独立计算 alignment / RGB difference 并输出 immutable overlay/thumbnail；CorrectionPatch 未持久化、不可 promotion、未触发 mutation 或 approval，queue 清洁且磁盘字节不变。
- [x] P3 background-normalized comparison：新增严格 schema、可复现离线 runner、合成 matched/mismatch/blank 负例与真实 Trimble 制品。保持原始纵横比后按行估计边界背景并 flood-fill，消除 capture 全宽误分割；固定阈值下粗轮廓 IoU `0.569986` / Dice `0.726104` 通过。appearance 仍为 diagnostic-only，整体不接受视觉相似度、不 promotion、不执行。证据见 `docs/evidence/trimble-s6-background-normalized-visual-evidence-2026-07-23.json`。
- [x] P3 Gateway structured-result：`visual-correction-qa-result.v1` 把 lineage-bound QA、background-normalized comparison、8 个 immutable image handles 与不可提权 diagnostic boundary 合成正式服务端结果；L0/4,096/no-file/no-vision 投影直接保留关键 scalar summary，完整安全结果可分页到 EOF。Agent 注入 comparison、acceptance、review 或 execution decision 均 fail closed；该回归默认 mock-only、queue calls=0，严格源码绑定证据见 `docs/evidence/visual-correction-gateway-structured-result-v1-mock-evidence.json`。
- [x] P3 双模型 fresh-process capture consistency：architecture/product 两个 byte-exact copy 分别在完整退出/重开后保持 exact model key/graph/revision/camera/spec，完整索引 `5,859 / 5,859` 与 `71,626 / 71,626`，前后 PNG 字节一致、IoU/Dice=`1`、model bytes/state 与 queue 不变。证据见 `docs/evidence/fresh-process-multi-model-visual-evidence-2026-07-23.json`；它不是 external-reference quality acceptance。
- [ ] P3 剩余视觉验收：补 external reference 的独立 camera-pose comparability 与跨模型质量 benchmark；不得改写旧 v1 live evidence，也不得升级为通用照片驱动自动建模或 release acceptance。跨版本按用户决定暂缓。
- [x] 2026-07-16 current-source 只读/live-capture 证据已归档到 `docs/evidence/model-graph-v1-live-readonly-evidence-2026-07-16.json` 和 `docs/evidence/live-visual-capture-evidence-2026-07-16.json`，两者均有严格 schema/test，明确 `live_mutation_performed=false` 与 `release_acceptance=false`。
- [x] P4 hardened mock corpus：`7 / 7` cases、`23 / 23` tasks，任务成功率 100%、错误对象修改 0、静默几何损坏 0、恢复率 100%；外部文件的 realpath/O_NOFOLLOW/TOCTOU/symlink/sidecar 负例 fail closed。
- [x] P4 readiness sidecar 层：已有 6 个用户本地 SKP 的 hash-bound intake/语义映射，`6 / 6` candidates confirmed、`7 / 7` categories mapped；7 个正式 sidecar 均通过 schema、manifest、内容哈希、路径 containment、symlink 和 authority-boundary 负例，Portal v8 失败证据只作为不可重试的 context-only exclusion record。
- [x] P4 正式真实 mutation corpus：current-source live aggregate v6 已为 `7 / 7` cases、`23 / 23` named tasks、`3` formal geometry-mutation cases，wrong-object/silent-corruption 为 0、恢复 `2 / 2`，每例均有 save/reopen 与 queue cleanup。dirty-topology 与 product Boolean 使用受控隔离 overlay，不外推为任意 CAD repair/任意产品 Boolean；压力 case 不作为普通 Agent 默认负载。SketchUp 版本矩阵按用户决定暂缓。
- [x] P4 邻接受控 S4 证明：Fire Escape disposable copy 已完成 exact delete + expected empty-parent cleanup 的一次 native success，但未经过正式 7-case sidecar/role/viewport/save-reopen harness，因此不单独增加正式 corpus 计数，也不支持稳定性升级。
- [x] P5 constrained compatibility harness：`21 / 21` L0/L1/L2 scenarios，由 `536` Gateway events（含直接统计的 `468` 次公开 artifact 分页读取）、`24` mutation events/model diffs、`24` mutation-ledger rows 和 `6` HMAC-verified receipts 派生指标；L0 七场景累计 `173` 次 canonical JSON-text round trip、0 failure，三项 mutation 硬门禁均为 `0`。
- [x] P5 独立进程三 fixture / 两 workflow：三个仓库外、ephemeral、workspace-write sandbox 的 Codex CLI 进程只经 4-tool allowlist 访问 mock Gateway；服务端强制 L0 profile。柜体与共享 component 双实例 fixture 各 4 次调用；no-vision reference/capture image-summary fixture 用 2 次调用读取 inline structured summary 与 metadata-only overlay handle。聚合 3 个 fixture family / 2 个 workflow family / 3 个独立进程 / 10 次 Gateway 调用；audit hash chain、同请求 replay、同 task resume、歧义 `awaiting_input`、视觉 `awaiting_review`、revision unchanged、0 unexpected command、0 image-content exposure 与 0 hard-gate violation 均通过。v1/v2/v3 证据分别为 `docs/evidence/independent-agent-compatibility-evidence-2026-07-23.json`、`docs/evidence/independent-agent-compatibility-evidence-v2-2026-07-23.json` 与 `docs/evidence/independent-agent-compatibility-evidence-v3-2026-07-23.json`。
- [ ] P5 生态残项：继续接不同厂商/明确模型的能力等级，并把 production human-approval host 纳入独立 Agent benchmark。当前仅证明一种 Agent 实现下的 fixture/workflow diversification 与 no-vision summary transport；selected model 未独立钉住，不能宣称多模型/多厂商生态兼容或视觉质量。
- [x] 2026-07-15 用户提供可覆盖模型并打开当时已安装的插件后，完成 fresh `create_queue_handshake`、reset/build/save/capture 分级验证与 41-tool capability suite。SketchUp 26.2.242 / Ruby 3.2.2 / plugin 0.1.0-rc.2 / 101-op compatibility 通过；每次 mutation 使用 fresh Session Contract。该证据早于后续 MDI/document-state/transaction source hardening，不替代新源 reinstall/restart 后的复验。
- [x] 本轮 live 发现并修复 capability suite 假阳性：原 queue addon 与 component instance 碰撞，但顶层仍报 pass。现在 mock/live build + iteration 都硬断言 `model_qa.verdict=pass`，并在末尾断言 `queue/processing/responses=0` 和 `lock=false`；修复后 live 复跑为零 issue。
- [x] direct-expert policy 分离与 capability QA 加固后再次显式运行 41-tool live capability suite：41/41 used、101-op registry/34-op live fixture 分开报告，live build/iteration Model QA 均 `pass`，结尾 queue/processing/responses=`0/0/0`、lock=false；SketchUp 进程保持存活，20:39 后无新增 `.ips`。脱敏证据见 `docs/evidence/agent-contract-v1-live-evidence-2026-07-15.json`。该文件本身不等于 101 ops 逐项 live 语义验证，也不包含后来完成的 trusted approval；后续单模型 S2 host/receipt 证据单独记录在 `docs/evidence/local-approval-live-evidence-2026-07-16.json`。
- [x] 追加 live 可靠性证据：identity 1/1 pass；nested shared-definition definition-wide/make_unique pass 并保存 SKP；10 个 queue golden cases 全部 `OK:true`；boolean/manifold 专用容差报告 0 diff；expert 1/1、performance budget 4/4、Official API R3 和 high-value restricted-Python queue gates 通过。这些是分层 smoke/reliability 证据，不等于 41 tools 全部 live 或 101 ops 逐项语义验证。
- [x] P0 Gateway mutation surface 再收紧：`create_model` / `verify_model(code)` 在 macro expansion 后仅允许 56 个明确分类的 standalone/additive operation，另外 45 个会在执行前 `OPERATION_NOT_ALLOWED`；新增 operation 默认未分类即拒绝。现有模型修改仍路由到 reviewed task。queue `import_model(mode=replace)` 同样在授权/dispatch 前拒绝，mock replace 保持可用。
- [x] 强 save/reopen gate 已改为 target -> distinct intermediary -> target，要求 active source path、persistent occurrence identity、model revision 和 zero-tolerance snapshot diff 全部一致，并支持 MDI activation 后只读 `--resume-after-open`。原 same-path pass 已降级为 inconclusive；真实 path switch 首次运行 fail closed，暴露 macOS 多文档 window activation 与跨文档 sidecar 泄漏，证据见 `docs/evidence/save-reopen-mdi-bug-discovery-2026-07-15.json`，该文件明确不是 acceptance proof。修复后在当时的 P0 源码与安装插件 hash 一致、完整重启的 SketchUp 26.2.242 上通过：identity 42/42 exact、shared leaf 2、Face/Edge entries 36、revision exact、zero-tolerance diff 0、queue `0/0/0`、无 lock。后续 P1 Ruby source 变更不在该精确 hash 证据内。
- [x] Ruby source 已实现按 Model 隔离并持久化 document sidecar、`pending_mdi_activation` 和 target activation 后 fresh handshake。现场进一步发现 observer hint 在 macOS 窗口切换中可能 stale，因此改为每个 request 以 `Sketchup.active_model` 为权威来源，并在单 request 内 latch 同一 Model。fake Ruby/source-shape 与全量 `npm test` 通过；真实双窗口保持打开时，显式 target -> intermediary -> target 切换后 `get_model_info.source_path` 双向精确跟随，未依赖关闭 intermediary 的 fallback。
- [x] revision guard 已加固：selection/capture/普通 save/export 不消费起始 model revision；只有首个成功真实模型写入消费。`open_model` 请求 document switch 后旧 guard 立即失效。fake queue 14 项与 Session Contract 17 项通过。
- [x] controlled S1 batch-abort gate 已改为合法操作语义：同一 reviewed transaction 中先写入合法 probe attribute，再对已知 non-manifold 目标运行 `manifold_check(fail_on_non_manifold=true)` 触发 `MUTATION_EXECUTION_FAILED`（non-retryable），要求 revision before/after/replay 三次一致、probe 不存在、同 submit key 幂等重放不再执行、queue 全清。新语义已通过 mock；历史 P0 live 证据绑定当时 source hash，不覆盖当前新 fixture。它只证明受控 pre-commit abort 效果，不等于 native crash recovery、task-wide exactly-once 或 S2-S4 授权。
- [x] AgentTaskStore crash recovery 加固：stale/dead create/submit/finalizer claim 在跨进程 recovery lock 下仅一个 owner 可接管，active pending 仍冲突；可信 durable receipt 存在时恢复仅执行 step-idempotent finalizer，不重放模型修改。
- [x] Ruby mutation/queue source 已完成 pre-commit snapshot/readback/JSON 检查、commit boundary、atomic response persistence、claimed-processing outcome-unknown 保留和最小 `mutation_receipt.v1`；fake Ruby 30 项、crash-safety source-shape 25 项、queue/session tests 通过。
- [x] P0 durable receipt/finalizer：HMAC 保护的 task-level receipt ledger、resumable single-owner finalizer、terminal-response recovery、visual/design finalizer idempotency 与 no-replay 均已有 mock/source-contract 证据。native commit 到 durable task receipt 之间的窄崩溃窗口仍为 `outcome_unknown`，不宣称 end-to-end rollback 或 universal native exactly-once。
- [x] Portal v8 真人批准负向 S3：exact task/plan/challenge 只提交一次并 confirmed precommit abort；approval=`consumed_failed`，无 commit/receipt/save/replay。Review v3 已将失败 pair、runtime drift、低 fill uncertainty 与 source-evidence content binding 固化为 fail-closed 合同。
- [x] 发布制品漂移只读证据：当前同名 rc.2 RBZ 与历史 manifest/sidecar 的 size/hash 不匹配，状态 `invalid_for_signed_rc`；三个文件未覆盖、未删除。恢复路径仅为找回精确历史 RBZ，或提升版本后重建/重签整套制品。
- [x] P4 五模型 current-source reliability checkpoint：前三例保持 v2 的 deep-shared、interior 与 scaled/mirrored/locked 结论；`appearance-scenes-hidden` 以真实纹理、FaceUV、1 个 Scene、1 个 hidden target 和 `5,897 / 5,897` exact identity 完成保存/重开；`architecture-golden` 以 metadata-only 材质 + Scene overlay 和 `5,859 / 5,859` exact identity 完成保存/重开。五例共 `17 / 17` tasks，wrong-object/silent-corruption 为 0，恢复 `1 / 1`，输入 bytes 不变且 queue 全清；严格 v4 evidence/schema/test 固定为 `5 / 7`、`1` formal geometry-mutation case、`release_acceptance=false`，旧 v1/v2/v3 aggregate 保持不可变。architecture 只证明顶层 visibility signature；FaceUV 不扩展为独立 UVHelper 坐标或任意 UV 编辑证明；室内压力例耗时 `1,291,250 ms`，不能作为普通 Agent 默认 payload。
- [x] P4 大模型 live 负载止损：dirty-topology 首轮 formal retry 在写入前暴露 macOS MDI 多窗口和 `get_session_state` 激活轮询反复计算 `1,903,697` logical occurrence revision，退出时仍占满单核；运行已中断，queue/processing/responses/lock 与残留进程清零，未产生 mutation acceptance。当前源码新增 O(1) `get_active_model_identity` 激活探针、匹配 pending-open 清理、只读 adoption 去除冗余 transport revision guard，以及 schema-validated `--prepare-only` + allowed-root/hash-bound `--active-working-copy` 单窗口模式。mock/source/Ruby 回归已通过；在重新安装插件并以唯一目标副本启动后的 fresh live 复验前，这只算 runner hardening，不增加 `5 / 7` 正式计数。
- [x] P4 dirty-topology current-source 闭环：独立的 `manifold_repair_target` guard 允许已解锁 Group 在非 manifold 前置状态下进入修复，同时 locked/invalid 目标继续 fail closed；正式 runner 通过 atomic fresh authorization 把每次大模型修改从三次全局 revision 扫描降为服务端一次 + Ruby dispatch guard 一次，并保留异常/中断自有 queue cleanup。唯一窗口中的 v6 正式运行对隔离 loose-edge overlay 完成 structured before/after：6 faces / 13 edges / 10 vertices、`boundary_edges` -> 6 / 12 / 8、manifold；exact persistent target 改变、所有其他顶层实体不变，保存/重开后 `1,903,696` logical occurrences 的 `100,000 / 100,000` bounded sample 与完整 `definition-merkle.v2` revision 精确一致。六例累计 `20 / 20` tasks、wrong-object/silent-corruption=0、恢复 `2 / 2`、queue clean；严格 v5 evidence/schema/test 固定为 `6 / 7`、`2` formal geometry-mutation cases、`release_acceptance=false`。该目标是受控隔离 overlay，不外推为任意 imported CAD 自动修复；单例耗时 `1,423,821 ms`，不能作为普通 Agent 默认 payload。
- [x] P4 product Boolean/manifold 与七领域 current-source 闭环：以 byte-preserved `Trimble S6` 副本为 product context，在隔离位置构建 manifold box target + through-cylinder tool；准备阶段保存/重开后两输入仍 manifold。正式 `boolean_difference` 精确替换 target，tool 与全部 non-input 顶层 entity fingerprints 保持不变，结果 manifold、目标材质保留，保存/重开后 `71,868 / 71,868` full-recursive identity 与完整 revision 精确一致。P4 聚合 v6 固定为 `7 / 7` cases、`23 / 23` tasks、`3` formal geometry-mutation cases、wrong-object/silent-corruption=0、恢复 `2 / 2`、queue clean；schema/test 含 11 个 fail-closed 负例与 deterministic regeneration。该结论只覆盖受控相交 pair，不外推为任意产品 Boolean，且 `release_acceptance=false`。
<!-- superseded by the current live-evidence line below
- [ ] 剩余 live/real-SKP 证据：更多 S2-S4 operation/shared-definition；P1 当前源码更广语义目标；P2 连续 observer、trusted reconciliation acceptance 与多个 live 域；P3 external-reference 独立 camera-pose comparability 与跨模型质量 benchmark；P5 多厂商/多模型独立 Agent 与 production human-approval benchmark。P3 的 background-normalized coarse silhouette、Gateway structured-result 与两域 fresh-process capture consistency 已通过各自固定门禁，但前者 appearance 仍只作诊断、Gateway 接入仍是 mock/offline、后者不是外部参考图质量接受。P4 七领域 `7 / 7`、`23 / 23` 与三个 guarded geometry mutation 已完成，不再列作缺口，但受控 overlay 不外推为任意产品 Boolean/CAD repair，压力 case 也不作为普通 Agent 默认 payload；跨版本矩阵按用户决定暂缓。Agent 仍不能自铸或读取 token。所有 live 证据只绑定其记录的精确 source hash，且 `release_acceptance=false`。

-->
- [ ] 剩余 live/real-SKP 证据：更多 S2-S4 operation/shared-definition；P1 当前源码更广语义目标；P2 连续 observer、trusted reconciliation acceptance 与多个 live 域；P3 独立 camera-pose comparability 与外部参考图跨模型视觉质量；P5 多厂商/多模型独立 Agent 与 production human-approval benchmark。P3 的 background-normalized coarse silhouette、Gateway structured-result 与两域 fresh-process consistency 已完成各自边界明确的门禁，但 appearance 仍只作诊断且 Gateway 接入仍是 mock/offline。P4 七领域 `7 / 7`、`23 / 23` 与三个 guarded geometry mutation 已完成，不再列作缺口，但受控 overlay 不外推为任意产品 Boolean/CAD repair，压力 case 也不作为普通 Agent 默认 payload；跨版本矩阵按用户决定暂缓。Agent 仍不能自铸或读取 token。所有 live 证据只绑定其记录的精确 source hash，且 `release_acceptance=false`。

## 7. 主要风险与止损

- 审批渠道如果没有独立于 Agent 的信任根，S2-S4 不得上线执行；只保留 proposal/preview。
- ModelGraph target precision 达不到硬门禁时，不得自动进入 execution。
- DesignIntentGraph 无法在 save/reopen 保持 identity 时，不得宣称 feature history 可靠。
- 视觉 alignment 只产出低置信证据时，必须进入 review/询问，不降级为自动执行。
- P4/P5 硬指标不达标时，beta/experimental 不升级，不用 operation count 替代可靠性证据。
