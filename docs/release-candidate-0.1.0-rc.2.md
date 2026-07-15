# 0.1.0-rc.2 候选构建说明

状态：`rc_candidate_verified` / `rc_signed=true`（2026-07-15）

## 发布重点

`rc.2` 把“扩大既有模型可编辑范围”升级为正式 Existing Model Editing Engine v1：

- MCP 新增 `prepare_existing_model_edit` 和 `apply_reviewed_model_edit`，当前 `tools/list=36`。
- recursive adoption 返回深层 Group/ComponentInstance/Face/Edge 的 persistent occurrence path、affected-instance count、shared-definition policy、allowed operations 和 truncation 状态。
- 审查合同包含 model revision、S1-S4 risk、operation/affected-instance budget、blockers、plan-matched approval 和 stale-model rejection。
- 受控编辑覆盖属性/metadata、Face 双面材质/reverse/pushpull、Edge soft/smooth/visibility、duplicate/replace/explode、erase/transform collections、nested feature，以及同 `Entities` 作用域的 boolean/manifold。
- shared definition 必须显式选择 `definition_wide` 或 `make_unique`；deep make-unique 会沿 occurrence path 隔离共享祖先。

这些能力不允许任意 Ruby/Python/runtime access，不等于完整 SketchUp API。101 个 registered operations 仍只是 safe JSON DSL registry；`ModificationIntent` 仍是可审计编排层，不是自主语义智能体。

## Python source compatibility

- corpus：35 cases。
- compiled：29，每例有 committed canonical DSL/result golden 与 source hash。
- unsupported：6，全部有稳定 reason code；unclassified=0。
- 高频语义：`Entities.erase_entities -> None`；`Entities.transform_entities -> Boolean`，空集合返回 `False`；Page named flags 可用 bitwise OR，`Page.update` 返回 Boolean；同脚本 affine positioned-material 支持任意面内点 UVQ read。
- 仍拒绝 import、while、try/except、lambda、任意 `open`、active-model/unmapped UVHelper 和非仿射 UV mapping。

## 已通过的离线证据

- `git diff --check`
- `npm test`
- `npm run plugin:check`
- `npm run qa:mock-session-isolation`：20 iterations / 40 concurrent runs
- `npm run test:python-sdk-source-compat`：35 / 29 / 6 / 0 unclassified
- `npm run qa:python-sdk-high-value:mock`
- `npm run qa:existing-model-edit:mock`：property / deep make_unique / nested feature / boolean / manifold / save-reopen path+revision
- `npm run qa:mcp-capability-suite`：36 tools，101 registered operations；mock steps green
- `npm run qa:official-api-r3:mock`
- `npm run parametric-recipe:first-output-switch`：FeatureMappingPlan、compile report、CorrectionPatch、applied PartGraph、safe JSON DSL

- `npm run test:image-structured`：全量通过。该结果只证明独立上游子项目门禁，不把图片分析管线复制进主线，也不代表 image adapter 会自动调用 queue。

## Fresh queue 证据

2026-07-15 完全重启 SketchUp 2026 并重新启动 Bridge 后，以下 `rc.2` 硬门禁全部通过：

1. fresh `get_capabilities --runtime queue`：SketchUp `26.2.242`、plugin/runtime `0.1.0-rc.2`、capability `0.1.0-rc.2-capabilities.1`、manifest `2026-07-existing-model-edit-rc2`、101 operations，compatibility issues 为空。
2. `qa:existing-model-edit:queue`：深层 Face/Edge 属性、single-occurrence `make_unique`、nested feature、same-scope boolean/manifold 通过；persistent path 与 model revision 在 save/reopen 后不漂移，保存 `output/existing-model-editing/queue/existing-model-editing.skp`。
3. `qa:queue` 10/10、`qa:identity:queue` 1/1、`qa:expert:queue` 1/1、`qa:budget:queue` 4/4 通过；通用 queue 聚合的 reviewed mock/SketchUp 几何差异按既有容差合同保留。
4. `qa:official-api-r3:queue`、`qa:python-sdk-high-value:queue`、`qa:nested-edit:queue` 通过；high-value 结果包含 erase=`null`、transform=`true`、Page flags=`37`、UVQ=`[0.5,0.5,1]`。
5. queue-required MCP capability suite 为 36/36 tools、0 missing、0 skipped，queue compatibility 通过，并保存 live build report、SKP、capture、iteration manifest 和 iteration SKP。

`plugin:check` 仍只是静态证据；本次 RC 签名依据是上述 fresh queue artifacts，不是 `rc.1` 旧快照。
