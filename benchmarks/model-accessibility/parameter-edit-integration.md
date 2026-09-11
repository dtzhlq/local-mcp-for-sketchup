# 参数配方修改连接状态（2026-09-08）

Gateway 已接可信创建基线、配方重编译、一次性新定义 staging、现有审查任务应用，以及从签名 mutation ledger 恢复 assembly 绑定。参数编辑完成只表示几何替换与身份回读完成；`quality_accepted=false`、`saved=false`，仍须在新复核任务中核验原创建任务的冻结质量要求并完成文件交付。已 completed 的创建任务保持终态。离线 mock 不代表真实 SketchUp 或普通模型首次验收。

## 公开输入

```json
{
  "intent": "modify_design_parameters",
  "instruction": "仅将明确选中的柜体宽度改为 800 mm，保留其他实例。",
  "idempotency_key": "retain-this-key-for-retries",
  "inputs": {
    "runtime": "queue",
    "connection_task_id": "<fresh completed connect task id>",
    "parameter_edit": {
      "creation_task_id": "<server creation task id>",
      "scope": "single",
      "targets": [{ "entity_path": "<actual canonical occurrence path>" }],
      "changes": { "width_mm": 800 }
    }
  }
}
```

`single` 必须明确一个顶层组件；`all` 必须列出实际同一组件定义的全部当前实例。独立定义、嵌套实例、未绑定实例以及全局实例数与完整索引不一致均拒绝。不能用名称猜选、省略 scope、传入新 DSL、缩放向量或客户端基线。

父任务返回既有本地审批入口，实际授权绑定它的 `reviewed_task_id`。批准后向同一参数父任务 `submit_agent_task_input` 提交固定幂等键和新的 `connection_task_id`（或原有 `session_contract`），不传审批 token。`resume_agent_task` 继续同一父子任务链，不创建另一审查任务。

应用完成后，使用返回的 `next_action` 创建 `verify_model`：输入 `creation_task_id`、刚完成的 `parameter_task_id`、相同 `runtime` 和新连接。服务器从原创建私有状态读取 frozen spec、真实 occurrence mapping 与视图；客户端不能传入 spec、views、snapshot 或重新绑定来源。新复核通过 live quality 后，可以成为 `deliver_model.inputs.source_task_id`。复核中断只重新读取当前模型，不重建、不重开原创建任务。

在已打开的服务器保存副本上继续参数修改时，额外提供顶层 `inputs.saved_delivery_task_id`。服务器仅从该交付任务固定目录读取签名 save intent / receipt 与实际文件 SHA，核对当前 source_path、完整 revision、原参数版本及全部已绑定子树指纹，再迁移 source model_key。不会覆盖保存源文件，也不会把后来人工修改认作原始基线。新保存回执记录参数版本；旧回执只有在原创建参数 revision 0、可信即时 capture 与签名保存 revision 完全相同的情况下可以恢复遗漏的版本 metadata，其他情况明确阻塞。

`src/model-accessibility-parameter-reopen.mjs` 的身份迁移不执行关窗或打开文件，也不声明 cold reopen 已验收；调用方须先实际打开该副本。关闭、磁盘重开及原生测量是单独的实机证据。

## 服务端实现

`src/model-accessibility-parameter-edit.mjs`：

- `captureDefinitionParameterSource`：在创建当次可信只读回读时保存原 task/bundle、真实 root→definition、完整子树指纹、材质映射。queue 要求原 build 的完整 native revision 与即时只读回读一致；mock 单独标记较弱的 `mock_initial_snapshot_match`。
- `planDefinitionParameterEdit`：原配方重编译，再调用既有 `planDesignParameterChange({assemblyRebuild})`。柜体仍为 18 mm 侧板、独立抽屉和五金，并保留四个柜脚的对应角点 ID。支持 common window/door/cabinet/sink_counter，以及已有 detailed sample window/door/cabinet。复杂场景组合和外来 SKP 不在此 adapter 范围。
- `acceptDefinitionParameterEdit`：仅真实进程内 assembly receipt 可推进每个实例的配方版本。单件分离后，其余实例仍使用旧参数；未选实例的人工语义变化不会自动变成新基线。

`src/model-accessibility-parameter-execution.mjs`：

1. 用既有 `mutationReceiptLedger.sign` 保护私有 `parameter_execution` 阶段记录；先持久化 `staging_started`，再通过原 Bridge 授权和原生原子 creation scope 创建未使用的新定义。收到可信返回后记录 `staging_committed`。
2. 已有 `staging_started` 但没有可信 committed 返回时，结果为 `outcome_unknown`，禁止重复 staging。已有 committed 记录时，只继续子树回读和审查准备。
3. 通过固定幂等键创建一个既有 `reviewed_existing_model_edit` 子任务。实际替换完整复用 `executeReviewedExistingEdit`、原本地审批 authority、一次性审批消费、签名 mutation receipt 和 `finalizeReviewedMutationReceipt`，不扩展或放宽 ledger 的 reviewed-only 规则。
4. 父任务 submit/resume 始终引用这个子任务。替换返回丢失且没有可信 ledger 时，不再 apply；已写签名 ledger 时，只继续 finalization。
5. `src/detailed-modeling/assembly-edit.mjs::finalizeAssemblyParameterEditFromLedger` 从 `bridge.taskStore` 加载并验证真实 ledger、私有审查 plan、精确 replacement operations、模型身份和 revision，然后只读验证根身份/新定义并签发进程内品牌 receipt。此 API 不接客户端 receipt，不执行几何。
6. 复用 `recordTrustedAssemblyEditMapping` / `resumeTrustedAssemblyEditMapping` 的签名 pending journal 更新原 frozen spec 的路径映射，再推进源版本。任一步响应丢失均可由同一已验证 child ledger 重新建立品牌并继续；不重放替换，不修改 frozen spec，不清空其他实例的失败次数。

Gateway 创建基线捕获失败（超预算、回读错误、revision 不符）仅记录 `parameter_edit_support`，不抹掉创建或质量结果。恢复和后续参数请求不会从后来的模型重造缺失基线。所有参数响应包含执行、质量、证据及下一步；`applied` 与质量通过、保存文件明确分开。

## 预算与验收边界

生产策略及预算阈值未改。旧全模型索引方式下，两个完整柜体可在 10000 递归条目内验证，三个柜体的 mock occurrence 全索引约 14727 条。新增 `adoptParameterRoots` 为明确的多个根逐个只读回读，每次仍使用原请求上限（最多 10000），最多 12 根；只有同一完整 native revision、同一文档身份、相同 snapshot/全局根信息和每根完整子树才能合并。重复 path 的条目必须逐字一致，保留全局 definition occurrence count。结果只声明 `scope_complete=true`、`complete=false`，不冒称全模型索引完整；任一单根仍超预算则阻塞。

该读取路径用于首次创建基线、参数计划、staging 前后检查、既有 reviewed 子任务准备/应用复查、assembly receipt finalizer 和 mapping 恢复。子任务传递固定 `recursive_roots`；底层只允许所声明根的 `replace_component_definition` 操作，保留原审查、签名 ledger 和目标覆盖校验。receipt 保留每次真实请求上限，不能将合并后的 occurrence 数当成提高预算的依据。

尚需实际运行的验收：普通模型首次操作；真实 SketchUp single/all 后的根 PID、位置旋转、抽屉净空、18 mm 板厚、人工标签/属性、柜脚身份及原定义；近景与原 frozen quality 重验；保存并重新打开。已有脚本和 mock 的成功不替代这些证据。

可运行离线验证：

```sh
node test/model-accessibility-parameter-edit.mjs
node test/model-accessibility-parameter-gateway.mjs
node test/model-accessibility-parameter-boundaries.mjs
node test/model-accessibility-parameter-reopen.mjs
node test/model-accessibility-verification-inputs.mjs
node test/model-accessibility-delivery.mjs
node test/model-accessibility-host-provisioning.mjs
node test/model-accessibility-scoped-readback.mjs
node test/model-accessibility-parameter-batched.mjs
ruby test/ruby/host_creation_metadata_test.rb
node test/assembly-parameter-edit.mjs
node test/agent-gateway-mutation-recovery.mjs
```

专属故障注入涵盖 staging committed 写盘后中断、审查 replacement ledger 后中断、冻结路径 mapping 后中断、服务器对象重启、私有阶段 HMAC 篡改、staging/替换返回未可靠记录时不重放，以及缺失基线不重造。几何边界测试涵盖 all 后再 single、板厚不变、旧定义保留、已选人工变化阻塞、未选同伴人工属性与标签保留。

新测试还涵盖 completed 创建之后使用独立复核任务、禁止复核输入替换要求、签名复核通过后的交付来源、旧已完成交付在参数源推进后仍仅校验旧保存字节并幂等返回、mock 文件写出后由全新 session 加载并实际修改尺寸，以及字符串 task id 不能冒充 snapshot。文件往返测试的 `.skp` 扩展名内部明确为 MockRuntime JSON，不是原生 SKP。

## Fixture 接线仍需处理

`shared_cabinets` fixture 含 B 作者化保留标签。后续已实现下述受限 host provisioning 与分根读取接线；尚未以此在实机建成 ABC+D 的完整 fixture，不能报告参数验收就绪。不能在模型执行前临时修改普通任务私有状态补造 baseline/receipt。三个共享实例的 native 每根完整子树能否在现有单次上限内完成仍须用实际数据核验，不得修改预算或将部分索引当作全实例证据。

普通 `prepareTaskOwnedCreationDsl` / `validateTaskOwnedCreationDocument` 默认规则仍不允许 `attribute`、`tag`、`assign_tag`。新的 host 专用封包可为明确的新根追加受限 metadata；它不授权高级 fixture DSL 任意修改已有对象，也没有给普通 MCP inputs 增加封包入口。

fixture 新输出已将 JSON 可序列化值作为 DSL、oracle、part graph、asset materialization 与其来源清单的哈希语义，manifest 标记 `canonical_json_of_json_roundtripped_value.v1`。此修复只影响新准备文件；旧 prepared-fixtures 与历史 raw 记录保持原样，不能用重新计算的哈希覆盖历史冻结包。

2026-09-08 preparation r3 另修正 `array_align` 专属共享柜体摆位：A 仍在原点，B/C/D 的 Y 改为 4000 mm，为 A 的目标 +X 排列行留空。原先 development 900 mm 间距的第三个柜体会与 B 的 600 mm 宽实体冲突，两个 acceptance 变体也可能与保留对象冲突；这是正式冻结及任何 array 模型运行之前消除 fixture 的物理矛盾。共享定义、B 的属性/标签保留、D 的独立定义、输入提示和评分要求均保留。三变体追加持久化 roundtrip 测试后 fixture 测试共 93 项通过；旧 prepared 文件未重建。

## Host 初始化的生产入口与边界

`src/model-accessibility-host-provisioning.mjs` 的 `prepareHostCommonCreation()` 只供宿主代码调用，返回的普通创建 options 带有进程内 WeakMap 品牌，JSON 克隆不会保留品牌。Gateway 在新任务开始 understanding 之前，将 exact common task、原始 DSL hash、逻辑根 ID 和 literal metadata 写为服务器 HMAC 封包。相同键恢复只允许相同封包；已经执行或建立普通来源的任务不能事后追加 host 封包。

最短调用形式为：

```js
import { prepareHostCommonCreation } from './src/model-accessibility-host-provisioning.mjs';
const result = await bridge.agentGateway.start(prepareHostCommonCreation({
  instruction: 'Prepare the authored cabinet fixture before the blind model run.',
  idempotency_key: 'host-fixture-unique-stable-key',
  inputs: {
    runtime: 'queue', connection_task_id: freshConnectionTaskId,
    recursive_limit: 10000, task: exactCommonCabinetTask
  },
  metadata: [{
    root_id: 'B', dictionary: 'BenchmarkManualEdit',
    attributes: { preserve: true, fixture_authored_manual_edit_marker: true, note: 'keep-B', authored_before_test: true },
    tag: 'preserve-manual'
  }]
}));
```

必须使用新建的空模型副本，D 作为独立 common task 先建；ABC 使用另一个 common task 的 `instances`，每个记录都只绑定自己的精确来源。无需把整份高级 fixture DSL 伪装成单一配方。`10000` 仅是既有生产上限内的显式请求，不能提高策略；宿主必须实际读取任务的 `parameter_edit_support.baseline_captured`，以及 fixture 的对象/尺寸/保留项原生回读后才能交给盲模型。失败仍保留已经创建的几何事实，同时参数来源不可用，不补造 baseline。

prepared 段把新根映射、任务命名空间 tag、最终 DSL hash 写入创建记录。只有 `creation_scope.host_metadata.version=new-root-metadata.v1` 时允许三个限定操作：新根的 `BenchmarkFixture` / `BenchmarkManualEdit` 字典 scalar literal 属性、最多 12 个全新可见 tag、新根赋予此前新建 tag。禁止嵌套/数组/表达式、动态属性字典、别名目标、额外字段、同名既有 tag 和既有根的 id/adopted_id/PID。Ruby 在原子 build 内对完整 model/active_entities 和 layers 再核验真实缺席。queue 必须通过实际 capabilities 的 `host_new_root_metadata` 标记，旧插件会拒绝执行。

原始提交成功后沿现有 `captureCreationParameterBaseline` 立即读回，完整 revision 和 marker/tag 必须匹配，marker 从一开始纳入保护指纹。丢失 build 回应的任务只恢复原状态，不重新建模或从后来的模型补捕获；已有参数执行的 staging/review/签名 mutation receipt 幂等链保持不变。

## 参数来源的首次发现

创建期捕获成功时写服务器私有、逐来源 HMAC 索引；查询只读取当前 model key 的索引，再核验 document ID/runtime object ID，避免同模板路径的其他窗口串出任务。普通模型可调用四工具之一：

```json
{"intent":"discover","instruction":"Find the trusted parameter source for B in this model.","inputs":{"topic":"parameter_sources","runtime":"queue","query":"B"}}
```

响应提供当前文档的 creation_task_id、`roots:[{name,target}]`、支持参数名、原始基线状态和 parameter_revision，不暴露磁盘路径、其他文档或私有源码。它只证明来源可用，`current_geometry_rechecked=false`；真正修改仍要 fresh graph、手改保护、single/all 显式范围和真实审查。没有索引的旧任意模型不会被追溯登记。

新保存会在已签名并确认文件字节后索引交付来源。当前文档若已重开，发现可返回 `saved_delivery_task_id` 与原 creation_task_id，提示沿真实保存来源复绑；复绑前必须核验原保存文件路径/SHA、完整 revision 及旧根指纹。合法复绑后再索引新文档身份。索引失败不抹掉已有创建/保存成功结果，但不能声称发现入口已就绪。

物理共享不等于 occurrence 完整：隔离 mock 中两个共享柜体只有 3 个物理 definition、27 组，但每个 instance path 的叶面/边仍需独立索引；两根的全索引在 10000 内，再加第三根后全索引会截断。新分根读取消除此特定的总量限制，仍核验每个根全部叶面/边，未把多实例压成一个实例以虚报 complete。纯 readback 测试已覆盖 15 种坏 report、5 种非法预算/根列表、跨请求身份/revision 冲突和首失败早停。ABC+D 的实机实际总量、参数 single/all 以及保存重开后的继续修改，仍由单独实机记录验收。

2026-09-08 最后一次必要的 `parameter-batched` 隔离 MockRuntime 测试通过 30 项：四柜完整 occurrence 共 19612，单次参数读取固定为 5000，10000 全量读取确实截断。首次 ABC 保留 marker 基线、真实 reviewed all→800 mm、再 single A→900 mm 均完成；B/C 保持 800 mm，D 实例和 definition 全量不变，B marker 与 18 mm 侧板保持。同任务 resume 和相同 submit 重放后总计仍仅 2 次 staging、2 次 replacement。此结果不含原生 SketchUp、SKP 保存或正式质量验收。独立 reopen 测试另通过 36 项，包括同文件路径/model key 但新 document session 缺少签名保存来源时在 staging 前拒绝。最后补齐的多根 frozen verification 接线只做语法检查，未追加长链重跑。

`scripts/model-accessibility/materialize-parameter-fixture.mjs` 是新宿主准备脚本，默认只做 dry run：

```sh
node scripts/model-accessibility/materialize-parameter-fixture.mjs --prepared-dir /absolute/new-prepared-fixture --output-dir /absolute/new-preview-dir --dry-run
```

宿主另选一个全新输出目录并显式添加 `--execute-host`，才会在已打开的空副本中执行；模块导入和 dry run 均不连接 SketchUp。脚本从冻结 DSL 提取 sentinel 的唯一 material/box definition/instance/BenchmarkFixture 属性，单次原子新建，再执行 D 和 ABC 两个精确 common 来源。它核对两份各 30 个配方零件、真实根位置/宽高、ABC definition 全局三实例与独立 D、B 首次 metadata 和 sentinel 子树不变，完成有界回读后才写私有 HMAC ready manifest。此脚本尚未实机运行；不自动保存、重开、重试或调用模型。启动时已有同名输出目录即拒绝，失败保留已发生几何和日志，不事后补 capture。模型执行器只通过显式 `MODEL_ACCESSIBILITY_INITIALIZED_FIXTURE_STATE_ROOT` 挂接该已签状态目录；源 UUID 不注入提示，仍由公开 `parameter_sources` 查询发现。
