# Real-model recursive reliability workflow v1

本文定义真实 SketchUp 模型中递归 Group 目标复核到单案例 S3 可靠性执行的正式工程边界。它把只读发现、离线推荐、staged plan、真实用户批准和受控执行分开；任何前置阶段成功都不能替代后续授权。

## 闭环流程

1. **只读 structural probe，第一阶段**
   - 仅在调用方显式选择 queue runtime 后读取已打开的 disposable copy。
   - 当前 `adopt_open_model` 必须使用 `read_only=true`、`structural_groups=true`，并绑定完整 `definition-merkle.v2` model revision、`model_revision_source_sha256` 与当时的 `model_modified` 状态。
   - 服务端只枚举 Group occurrence；ComponentInstance 只作为路径容器。名称、材质和 Tag 均为 `untrusted_data`，不能改变目标排序、执行策略或批准状态。
2. **离线 recursive target review，第一阶段**
   - 按 canonical occurrence path、同一 parent/scope、world-space bounding box 和锁定/可见状态筛选候选。
   - collision/containment 且存在正体积重叠时，仅输出精确 `manifold_probe_paths`；此时仍没有 target/tool 授权。
   - 当所有相关路径都已有 fresh attestation、但不存在双方均为 manifold 的候选对时，以 `no_manifold_qualified_pair` 终止，并返回 `select_manifold_qualified_disposable_model_case`；不得返回空 probe 列表配合“仍需 attestation”的循环状态。
3. **只读 structural probe，第二阶段**
   - 在同一完整 model revision 上，只对第一阶段返回的精确 occurrence paths 调用纯只读 fresh manifold report。
   - 不调用会写入 attribute 或修改文档状态的 manifold check，也不扩大到未请求路径。
4. **离线 recursive target review，第二阶段**
   - 只有同 scope、正体积重叠、两端均为同 revision 的 fresh manifold Group 才可得到 `server_recommended`。
   - `server_recommended` 只是由服务器几何排序生成的待审提案：`confirmed=false`、`authorized=false`，不代表用户选择，也不是执行权限。
5. **离线 staged S3 plan**
   - 当前 `real-model-reliability-execution-plan.v2` 绑定候选清单、语义映射、top-level review、recursive review 的文件 SHA，以及完整 `definition-merkle.v2` revision、`model_revision_source_sha256`、`model_modified`、目标/guard fingerprint、bounding box、材质期望、精确 `boolean_difference`、S3 风险、keep policy、输出根、save/reopen QA 和幂等 receipt 合同。这些 revision 字段全部进入 plan identity；任一变化都必须生成新 plan。
   - plan 只允许 disposable copy；原始 SKP 必须保持只读。初始状态始终 `executable_now=false`、`mutation_authorized=false`。
   - `real-model-reliability-execution-plan.v1` schema 与既有 evidence 只作为历史 lineage 保留可读；当前 validator、批准与执行面不得接受 v1 plan。
6. **本机真实用户批准与执行**
   - 执行前必须获取 fresh Session Contract，并由本机审批页对精确 plan hash、model revision、revision source hash、`model_modified`、S3、允许操作和有效期作一次真实用户决定。
   - Agent 的自由文本、`review.status=approved`、reviewer 字符串或本说明都不能生成批准。
   - 批准后仍须在 disposable copy 上执行，保留 target 与 guard，非覆盖保存，重开并验证唯一 result identity；错误对象修改和静默几何损坏的容许值均为 0。

## Fail-closed 条件

| 条件 | 结果 |
| --- | --- |
| structural group 列表 truncated、总数不精确、计数不一致或 pair budget 耗尽 | 不生成 recommendation；扩大有界 probe 后重新开始 |
| occurrence 或祖先 locked、hidden、无直接 Face、无有效正体积 world bbox | 候选被排除；不得自动放宽条件 |
| 不同 parent/scope | 不组成 boolean pair |
| contact 或 disjoint | 不作为 existing-pair plan；不请求 manifold probe |
| fresh manifold 路径、revision 或计数不匹配 | recommendation 为空 |
| 任一端 fresh non-manifold | pair 保持 blocked |
| model revision 不完整、不是 `definition-merkle.v2`、source hash/`model_modified` 缺失或与绑定不一致 | 当前 plan 拒绝；不得用 v1 plan 或旧批准重试 |
| approval challenge 过期、已消费、范围不符或没有真实用户批准 | 不执行修改 |

Trimble S6 当前 top-level A/B bounding boxes 为 disjoint，因此不能直接做 existing-pair boolean。系统可以生成 `generated_cutter` 的 staged 草案来保留 target/guard 意图，但在 composite generated-target lineage 完整并重新生成 hash-bound plan 之前，该草案必须保持 `blocked_generated_cutter_lineage`；不能临时移动模型、伪造重叠或绕过审批来“完成”案例。

## 离线验证

以下命令只使用 fixture/临时目录，不调用 live queue，也不修改 SketchUp：

```bash
npm run test:real-model-recursive-target-review
npm run test:real-model-reliability-plan
npm run test:real-model-recursive-reliability-evidence
npm run test:real-model-reliability-offline
```

既有 `docs/evidence/real-model-recursive-reliability-v1-mock-evidence.json` 固定的是历史 v1 结果，只能用于 lineage 与回归读取，不能授权当前执行。其机器可验证冻结边界为 `docs/evidence/real-model-reliability-plan-v1-archival-lineage-manifest-v1.json`：manifest 固定 evidence 与历史 schema 字节，并强制 `lineage_only=true`、`current_acceptance=false`、`release_acceptance=false`。evidence 内的 11 个源码哈希只描述捕获时刻，不与当前 v2 源码比较；未列入 archival manifest 的 current evidence 仍必须执行严格源码哈希校验。

当前 v2 针对性测试同样必须保持 queue requests 0、`mutation_authorized=false` 和 `release_acceptance=false`；在产生独立 v2 evidence 前，不得把历史 mock evidence 描述为 v2 live structural probe、真实 S3 修改、save/reopen 或发布验收证据。历史冻结可单独验证：

```bash
node test/real-model-reliability-plan-v1-archival-lineage.mjs
node test/real-model-recursive-reliability-evidence.mjs
node test/mock-evidence-hash-integrity.mjs
```
