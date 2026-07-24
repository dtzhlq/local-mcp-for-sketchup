# Trimble S6 真实模型只读 target 复核（2026-07-20）

本次复核把用户提供的 `Trimble S6.skp` 映射到 `product-boolean-manifold`，补齐候选语义路由中的产品类别。它是单候选、disposable-copy-only、显式 queue opt-in 的只读结构复核，不是 boolean/manifold 修改验收，也不生成正式 reliability sidecar。

## 已验证结果

- 旧 5 模型的 mapping、profile 和 live evidence 保持冻结；本次以独立 amendment 追加 Trimble S6，没有改写旧证据。
- 聚合结果为 `6 / 6` candidates confirmed、`7 / 7` semantic categories mapped、`0 / 7` formal sidecars ready。
- SketchUp `26.2.242` / plugin `0.1.0-rc.2` / capability `.5` 上，disposable copy 的 `definition-merkle.v1` revision 在复核前、adoption 和复核后完全一致；统计为 71,360 logical occurrences、60,247 unique entities、44 reachable definitions，原件与副本字节均验证未变。
- 模型包含 2 个顶层 Group（`pid:89456` / `pid:89455`）；两者均可作为后续人工复核候选。系统据此生成 2 个方向相反的 pair suggestions，但它们只基于“顶层、未锁定、Group、正体积 bounding box”，状态均为 `unconfirmed`，不具有 target/tool 角色权威性。对应 material `[Color_008]` / `[Color_D06]` 仍按 untrusted model data 处理，不能确认角色或改变执行策略。
- 本轮未请求模型内容修改、保存、selection、视觉截图、approval token 或 `manifold_check`；只读 adoption 的 `adopted_count` 为 0，结束后 queue / processing / responses / lock 均为空。

## 尚未通过的门禁

以下事项仍未批准、未验证，不能从本次结构信号推导：

- boolean target 与 boolean tool 的真实角色；
- 所需 material 的人工选择；
- manifold 状态以及 boolean/manifold mutation 的正确性；
- mutation 后 rollback、save/reopen identity 与持久 target identity；
- `product-boolean-manifold` 的正式 hash-bound sidecar。

因此本里程碑的 `target_roles_confirmed=false`、`mutation_authorized=false`、`release_acceptance=false`。跨 SketchUp 版本验证按用户决定记为 `deferred_by_user`，不表示通过。

## 证据与后续动作

- [只读 live evidence](evidence/real-model-target-review-live-evidence-2026-07-20.json)
- [Trimble S6 语义映射 amendment](evidence/real-model-candidate-semantic-mapping-amendment-2026-07-20.json)
- 生成的聚合报告：`output/real-model-reliability/review-amendment/real-model-candidate-review-aggregate.v1.json` / `.md`

如继续产品 boolean/manifold 验收，必须先由真实用户确认 target/tool 角色和 material，再建立独立、可信批准的 mutation 计划；本次 pair suggestions 不得直接转成执行授权。

## v1 历史语义更正（2026-07-21）

本节只追加语义更正，不改写上述 2026-07-20 原始观察，也不改变既有 evidence 的字节或哈希。Review v1 字段 `positive_volume_overlap` 及旧说明中的“正体积重叠”，只表示两个 occurrence 的 world-space axis-aligned bounding box（AABB）存在正体积交集；它不代表 SketchUp BRep/solid 的 exact overlap。上述原始 bullet 实际使用的“正体积 bounding box”条件更弱，只表示每个 occurrence 自身具有非零体积 AABB，连两个 AABB 相互交叠也不能证明。两种表述都不能证明实体包含关系或 boolean 一定成功。

因此，上述两个方向相反的 historical pair suggestions 只能理解为未确认的顶层候选方向，不能理解为两实体已经被证明互相交叠。后续递归复核记录的 Trimble S6 顶层 A/B world AABB 关系为 `disjoint`；该记录没有改写本次历史 evidence，但意味着这对现有顶层实体不能作为当前 existing-pair 原子试算候选。

当前合同已由 Review v2 / Plan v3 明确拆分：

- AABB 证据使用 `bbox_*`、`positive_bbox_overlap` 和 `bbox_overlap_*` 字段，仅用于候选筛选与排序；
- `exact_solid_overlap` 在原子试算前固定为 `status=unverified_before_atomic_trial`、`verified=false`；
- `atomic_boolean_trial_eligible` 只表示满足正体积 AABB overlap 与双方同 revision fresh manifold，可以请求真实用户批准的原子试算，不表示已批准或已执行；
- Review v1 与 Plan v1/v2 仅保留为历史 lineage；当前 validator、批准与执行边界只接受 Review v2 与 Plan v3，旧版本批准不得复用。

本追加说明是 documentation-only：没有调用 live queue，没有产生新的模型观察，没有取得或消费 mutation approval，也没有执行、保存或重开任何 SketchUp 修改。当前仍为 `live_queue_called=false`、`mutation_authorized=false`、`exact_solid_overlap_verified=false`、`release_acceptance=false`。
