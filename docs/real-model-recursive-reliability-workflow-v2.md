# Real-model recursive reliability workflow v2

本文定义真实 SketchUp 模型中递归 Group 候选复核到单案例 S3 原子试算的当前工程边界。当前合同组合为：

- `real-model-recursive-target-review.v2`（下文简称 **Review v2**）；
- `real-model-reliability-execution-plan.v3`（下文简称 **Plan v3**）。

本版最重要的语义修正，是把 world-space axis-aligned bounding box（AABB）证据与 exact solid overlap 明确分离。AABB 只能筛选和排序候选，不能证明两个 SketchUp 实体的精确实体交叠；精确实体交叠只能在真实用户批准后的 review-gated atomic apply 中，以实际 boolean 试算及其提交前置条件验证。

`docs/real-model-recursive-reliability-workflow-v1.md` 保持为历史文档，不在本版中改写。Review v1 与 Plan v1/v2 也只保留作历史 lineage；当前 validator、批准与执行边界只接受 Review v2 与 Plan v3。

## 当前证据边界

| 证据层 | Review v2 / Plan v3 字段 | 可以说明 | 不能说明 |
| --- | --- | --- | --- |
| World AABB | `bbox_relation`、`bbox_containment_direction`、`bbox_axis_overlaps`、`positive_bbox_overlap`、`bbox_overlap_bounding_box`、`bbox_overlap_volume`、`world_bbox_volume`、`target_bbox_volume`、`tool_bbox_volume` | 两个 occurrence 的 world AABB 是否 disjoint、contact、collision 或 containment；用于保守筛选与确定性排序 | exact BRep/solid overlap、实体包含关系、boolean 一定成功 |
| 单体 solid 状态 | target/tool 的同 revision fresh manifold attestation、`both_fresh_manifold` | 每个端点在指定 model revision 上分别通过 fresh manifold 条件 | 两个实体彼此存在 exact solid overlap |
| Exact solid overlap | `exact_solid_overlap.status=unverified_before_atomic_trial`、`verified=false`、`verification_stage=review_gated_atomic_apply` | 精确交叠尚未验证，且验证阶段被固定到受审批保护的原子 apply | 不得在 prepare/review 阶段声称已经验证实体交叠 |
| 原子试算资格 | `atomic_boolean_trial_eligible` | 存在正体积 AABB overlap，且两端均为同 revision fresh manifold，因此可以形成待审批原子试算候选 | 用户批准、当前可执行、修改已发生或发布验收通过 |

正体积 AABB overlap 是既有实体对进入原子试算候选的必要条件，但不是 exact solid overlap 的充分条件。反之，AABB 为 `disjoint` 或只有 `contact` 时，可以排除正体积 exact solid overlap，因此不得把该实体对送入 existing-pair 原子试算。

模型中的名称、材质、Tag、attributes 以及其他自由文本均为 `untrusted_data`。它们可以作为显示或保留要求的一部分，但不能改变候选资格、执行策略、风险等级或批准状态。

## 闭环流程

1. **显式只读 structural probe**
   - 只有调用方显式选择 queue runtime 后，才可在已打开的 disposable copy 上执行。
   - `adopt_open_model` 必须使用 `read_only=true`、`structural_groups=true`，并取得完整 `definition-merkle.v2` model revision、`model_revision_source_sha256` 与当时的 `model_modified`。
   - 第一阶段只枚举 Group occurrence 及其 canonical persistent path、scope、锁定/可见状态、world AABB 和身份摘要；不得修改模型来获取证据。
2. **离线 Review v2，第一阶段**
   - 在同一 parent/scope 内比较 world AABB，按稳定规则筛选并排序候选。
   - 只有 `positive_bbox_overlap=true` 的 pair 才进入 manifold 候选集合；此时 `exact_solid_overlap.verified` 仍必须为 `false`。
   - 如缺少 fresh manifold attestation，Review v2 只返回精确、有限的 `manifold_probe_paths`，不授予 target/tool 权威。
3. **显式只读 fresh manifold probe**
   - 在完全相同的 model revision 上，仅探测 Review v2 返回的 occurrence paths。
   - 路径、计数、revision 或 fresh 状态不匹配时 fail closed；不得扩大到未请求实体，也不得调用会写 attribute 或文档状态的检查。
4. **离线 Review v2，第二阶段**
   - 只有同 scope、`positive_bbox_overlap=true`、双方均为同 revision fresh manifold 的 pair，才可得到 `atomic_boolean_trial_eligible=true` 与 `server_recommended`。
   - `server_recommended` 仍是 `confirmed=false`、`authorized=false` 的几何排序提案。它只表示“可请求原子试算批准”，不表示 exact solid overlap 已验证。
5. **离线 Plan v3**
   - Plan v3 绑定候选清单、语义映射、top-level review、Review v2 的文件 SHA，以及完整 revision、revision source、`model_modified`、target/guard fingerprint、AABB 证据、材质期望、唯一 `boolean_difference` 操作、S3 风险、keep policy、输出根、save/reopen QA 与幂等 receipt 合同。
   - existing-pair 计划必须保留 `exact_solid_overlap.verified=false` 和 `atomic_boolean_trial_eligible=true`，并输出 `execution_scope.disposition=awaiting_local_approval_for_atomic_trial`。
   - 计划始终为 `stage=offline_prepare_only`、`runtime=offline`、`live_queue_called=false`、`executable_now=false`、`mutation_authorized=false`。生成计划不等于执行批准。
   - generated-cutter lineage 未完成时保持 `blocked`，不得借用 existing-pair 的原子试算资格。
6. **本机真实用户批准**
   - 执行前必须取得 fresh Session Contract，并由可信本机审批页把一次性批准绑定到精确 plan hash、完整 model revision、revision source、`model_modified`、S3 风险、允许操作、review 上下文与有效期。
   - Agent 自报 `approved`、自由文本 reviewer、模型内文本或旧 approval token 均不能授予权限。过期、重放、scope 不符或 revision 不符时必须拒绝。
7. **Disposable copy 上的受审批原子试算**
   - 批准后，执行层才可在单一原子事务中对绑定的 target/tool 运行实际 SketchUp boolean/split。
   - 提交前必须同时满足：atomic split 成功、target exact volume 正向减少、result 为 manifold；原始 target 与 guard 按 keep policy 保留，且只允许增加绑定的唯一 result identity。
   - 任一前置条件失败时执行 `abort_before_commit`；不得保存失败状态、不得把失败试算推广为证据，也不得继续部分提交。
   - 全部前置条件成功时才可 `commit_only_after_all_success_preconditions`。该成功结果才可为本次绑定的实体对提供 exact solid 行为证据；不能反向把此前 AABB 证据改写成实体交叠证明。
8. **非覆盖保存、重开与验收**
   - 原子提交成功后仍必须非覆盖保存 disposable copy，重开并验证 result identity 恰好解析一次、完整 revision 可重建、结构 diff 符合计划、原始 target/guard 与其他 occurrence 未被错误修改。
   - 错误对象修改、静默几何损坏与未授权执行的容许值均为 0。未完成 save/reopen 证据时不得声称案例验收或 release acceptance。

## Fail-closed 条件

| 条件 | 结果 |
| --- | --- |
| structural group 输入 truncated、总数不精确、计数不一致、重复 path 或 pair budget 耗尽 | 不生成 recommendation；扩大有界只读 probe 后重新开始 |
| occurrence/祖先 locked、hidden、无直接 Face、world AABB 无效或体积不为正 | 排除候选；不得自动放宽 |
| pair 不同 parent/scope | 不组成 boolean pair |
| AABB 为 `disjoint` 或 `contact` | 不进入 existing-pair 原子试算候选；不请求该 pair 的 mutation 批准 |
| 只有正体积 AABB overlap | `exact_solid_overlap` 保持 unverified；不得当作实体交叠证明 |
| fresh manifold path、revision 或计数不匹配 | recommendation 为空 |
| 任一端 fresh non-manifold | pair 保持 blocked |
| model revision 不完整、不是 `definition-merkle.v2`，或 revision source/`model_modified` 缺失或不一致 | 旧 plan 拒绝；重新只读复核并生成新 plan |
| Review v1 或 Plan v1/v2 被送入当前批准/执行面 | 拒绝；只能作为历史 lineage 读取 |
| approval 缺失、过期、已消费、重放、范围不符或不是可信本机用户决定 | 不执行修改 |
| 原子试算未产生 target exact volume 正向减少、result non-manifold、split 结果不满足唯一 result identity，或任何提交前置条件失败 | `abort_before_commit`，不保存、不推广 |
| 原子事务提交结果未知 | 不自动重放；先按幂等 receipt 与模型状态恢复 |
| save/reopen identity、完整 revision 或结构 diff 未通过 | `release_acceptance=false` |

## 版本 lineage 与兼容边界

- Review v1、Plan v1 与 Plan v2 的 schema/evidence 可保持字节冻结并继续用于历史回归、审计和 lineage 读取。
- 旧字段 `positive_volume_overlap` 或旧文档中的“正体积重叠”，不得自动翻译为 exact solid overlap；在旧 Review v1 语境中，它实际表示 world AABB 的正体积交集。
- 当前 Plan v3 validator 要求 hash-bound Review v2；当前批准与执行面不得接受 Review v1 或 Plan v1/v2，也不得复用旧版本的批准。
- 历史 evidence 内的源码哈希只描述捕获时刻，不能被“刷新”为当前源码哈希；升级合同必须生成新的 Review v2 / Plan v3 artifact 与新 plan hash。
- workflow v1 本身保持历史原文。对旧结论的语义修正应以追加说明或本 v2 文档表达，不覆盖、重写或伪造原始观察。

## 离线验证

以下命令只使用 fixture/临时目录，不调用 live queue，也不修改 SketchUp：

```bash
npm run test:real-model-recursive-target-review
npm run test:real-model-reliability-plan
npm run test:real-model-recursive-reliability-v2-evidence
npm run test:real-model-recursive-reliability-evidence
npm run test:real-model-reliability-offline
node test/real-model-reliability-plan-v1-archival-lineage.mjs
node test/real-model-recursive-reliability-evidence.mjs
node test/mock-evidence-hash-integrity.mjs
```

文档、schema 与 mock/fixture 测试只能证明合同和 fail-closed 行为。它们不能替代 fresh live handshake、真实本机批准、受控原子试算或 save/reopen 证据。

## 当前验收状态

本 v2 文档及其对应 Review v2 / Plan v3 离线合同不包含任何新的 live 模型观察或修改证据。当前口径固定为：

- `live_queue_called=false`；
- `mutation_authorized=false`；
- `model_mutation_performed=false`；
- `exact_solid_overlap_verified=false`；
- `release_acceptance=false`。

在另行取得 fresh handshake、真实用户批准、原子试算成功以及 save/reopen QA 之前，不得声称真实 S3 boolean 已通过，也不得把当前 mock/offline 结果描述为 live proof。
