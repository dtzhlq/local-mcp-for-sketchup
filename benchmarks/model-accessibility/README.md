# 普通模型首次使用验收

2026-09-11 范围更新：按用户要求，本目录的完整跨模型矩阵、30 正例/90%目标及未见变体验收保留为**后续可选专项**，不阻塞当前接口交付，也不默认运行。日常使用成功保存后结束，关闭重开仅按需执行。下文保持该专项原有冻结与评分标准，不把未运行结果改报通过。当前交付范围见[修订计划](../../docs/model-accessibility-plan-2026-09-07.md)。

此目录交付固定任务、对照协议、冻结工具和证据评分器。它尚不包含普通模型的真实实机成绩。运行离线检查不会调用模型服务、购买额度、启动 SketchUp 或把历史 mock 结果改成实机结果。

## 固定集合与输入隔离

2026-09-08 冻结前修订 r2：尚无建模模型运行或成绩时，移除了原草案额外发明的单扇窗、固定框宽/窗台外挑、门扇厚度与门套深度混用和相反柜体朝向；正例按已公开任务语义定义。单扇形制、右铰链、45 mm 门扇厚度要求作为 3 个独立负例保留。没有削减实际几何、近景、编辑边界、文件交付或两变体要求，也没有针对已测成绩降标。

`suite.mjs` 固定计划的 15 类任务；每类有 1 个开发变体、2 个首次使用验收变体和 1 个发布复验变体，共 60 个正例定义。另有 13 个独立负例，覆盖缺失尺寸、非法尺寸、错误引用、能力不支持、质量失败、响应不确定、冻结要求、人工修改、编辑范围和名称冲突。

首次使用集合是 30 正例 + 13 负例。至少三种准确版本的模型分别跑 baseline 与 optimized，两条路径共需 258 次运行。发布 holdout 单独需要 15 正例 + 13 负例 × 三模型 × 两路径；不能重复使用 acceptance 的结果。开发集合不会进入首次使用成绩。所谓“未见过”是指被测模型每次新上下文不接触其他任务、测试源码或评判答案，并非这些受版本控制的变体具有保密性。

每次向模型提供且仅提供该 case 的 `prompt` 和该路径的公开 MCP 工具说明。初始用户消息必须逐字匹配冻结 prompt。fixture 公共信息已写入 prompt；私有评分条件、工具调用序列、仓库源码、历史对话、人工作业指导和参考答案不得进入模型上下文。模型可通过 MCP 自行发现进一步能力。收集器须在仓库之外建立新上下文并关闭文件、shell、网络等旁路；不能仅依赖一句“不要读源码”。baseline 与 optimized 使用同一源码快照、SketchUp/插件版本、同一 case fixture、相同质量标准和人机权限。

两条路径都只公开原有四个 Gateway 工具。baseline 描述和 schema 固定来自 `de7d482`，并拒绝 discover/preflight_model 以及 inputs.task；optimized 允许新流程。实际执行共用相同核心版本和原生 fixture，因此测量的是入口改进。调用顺序由模型自行决定。不能让被测模型看到此 README 当成操作教程。

## 运行前冻结

复制 `config.example.json` 到新的运行目录并补齐三档模型的 provider、model_id、准确 model_version 和完整配置（推理强度、温度、上下文/输出预算以及工具能力）。同一模型换三个标签不满足三模型要求。请求参数中的模型名不能代替服务端响应的模型版本证明；如服务不返回可核验版本，应保留阻塞而不是编造。

冻结当前源码的完整内容清单，`source_sha256` 必须包含未提交文件的实际字节，而不只是 Git HEAD。还要冻结插件包/版本、实际 queue capability 返回、MCP 服务快照、两条路径的公开工具说明。`fixture_snapshots` 以 **case_id** 为键，每个值绑定本案例的完整准备包（SKP、资产/纹理/HDR、目录许可来源、公共对象标识和场景条件）。不同尺寸或布局可以使用不同 fixture；同一 case 的两条对照必须使用完全相同的准备包。fixture 名称本身不证明准备完毕。

必要 fixture 内容：

| fixture 类型 | 冻结前必须准备的内容 |
| --- | --- |
| empty | 独立空白文档、单位、世界轴、交付目录授权与基线快照 |
| asset_catalog | 实际可访问的 chair/stool/armchair 组件，尺寸/轴向/原点、来源许可、根与子层级、源文件哈希 |
| shared_cabinets | A/B/C 共享定义、独立 D、18 mm 板件和腔体、人工修改保护标识；独立几何/语义指纹 |
| asset_layout | A/B/C 椅子与桌子、各变体中 B 的根坐标/旋转、放置关系和无关对象指纹 |
| small_layout | L 内门/窗/两柜、镜像平面另一侧空间、已知障碍物、朝向与交叠测量基线 |
| appearance_assets | P 板件、许可明确的原生材质贴图/HDR、样式/场景基线、实际原生能力快照 |
| defective_cabinet | B 的实际踢脚侵入量、局部坐标和保留对象/人工修改指纹 |
| negative_cases | 分别可重现的错误、冻结/保护状态、响应丢失后的原请求标识与真实执行日志 |

成本币种、费用上限、已获授权状态和实机窗口必须显式配置；缺少条件时只生成准备度报告。配置不包含 API key、账户令牌或其他凭证。`cost_authorized=true` 记录既有授权，不是工具获得授权的机制。一次只开一个测试模型，用后保存、关闭；由实际原生读回记录清理结果。

```sh
node scripts/model-accessibility/benchmark.mjs validate
node test/model-accessibility-benchmark.mjs
node scripts/model-accessibility/benchmark.mjs freeze --config <运行目录/config.json> --output <运行目录/freeze.json>
```

freeze 只接受完整配置，用新文件写入防止覆盖；运行记录必须发生在冻结时间之后。更改任务、评分规则、版本、公开说明或 fixture 会使旧 freeze 失效。先前的独立 Codex CLI 探针只覆盖指定序列的 mock 流程，不能直接导入此次自然语言首次使用测试。2026-09-08 只读检查确认本机 Codex CLI 0.146.1 可执行并支持指定模型和 ephemeral；这不证明三种模型的访问权、准确响应版本或费用许可。

## 逐次证据契约

运行前的真实结构准备包由 `fixtures.mjs` 生成；这一步不调用 SketchUp，也不 reset。

```sh
node scripts/model-accessibility/fixtures.mjs --case edit_single.acceptance_a --output-dir <新的准备包目录>
node test/model-accessibility-fixtures.mjs
```

每个 case 输出 additive JSON DSL、私有部件图、私有原始身份/尺寸映射、源码与资源哈希清单。八种 family 的可审阅样例位于 `prepared-fixtures/index.json`。共享柜体 A/B/C 真实引用同一个完整定义，D 是独立完整定义；B 的保留标记位于真实实例 attribute/tag，既不把 A/C 改成独立定义，也不声称这些标签本身构成编辑批准。局部修复 fixture 实际改变踢脚 leaf 位置；质量失败 fixture 实际在水槽穿孔内加入 2 mm 封孔几何。

只允许把准备 DSL 添加到新建的空白副本；默认添加远离任务区域的模板 sentinel。若副本已有 sentinel，传入 `--template-sentinel <JSON>`，内容含 id、create=false 和 original_fingerprint_sha256；编译器不会重新创建、重写或删除它。已有其他对象、名称/定义冲突必须由可信 live adapter 在执行前阻止；源码模型不得 reset。配方材质使用独立命名空间，避免重定义模板中的同名材质。

私有 oracle 记录的是准备前的构造参数与声明身份，实际 persistent ID/几何尺寸必须准备后从 SketchUp 读取，且不得把 oracle 注入被测模型。资产目录中 `.mjs` 配方源码不会冒充已保存的 `.skp`；匹配的已有配方可导出独立 additive materialization DSL，但仍需要实际构建、检查完整根和尺寸、保存 SKP 再登记。当前没有查到的 stool 保持 blocker。现有材质/HDR 按本机 catalog-v2.json 只读核对文件与既有哈希，不下载、不改源文件；文件在磁盘不等于原生外观验收通过。

冻结要求、人工修改保护、保护已有 B、响应丢失和 HDR 不可用负例，还需真实运行时保护/故障条件；编译器在 manifest 中保留 pending setup，不能用静态属性或假请求 ID 代替。任何准备包始终 native_ready=false，需实际保存重开及独立基线测量后才能冻结为正式对照 fixture。

收集器将每次独立运行写入 `<运行目录>/runs/<run_id>.json`，其他证据放在该运行目录内。每个 artifact descriptor 为 `{ "path": "相对路径", "sha256": "64 位小写十六进制" }`。禁止绝对路径、路径穿越及指向目录外的软链接。摘要针对原始文件字节。`agent-loop.mjs` 能执行独立模型与 Gateway 循环；`benchmark.mjs` 聚合独立评估后的证据。当前仍需要可信原生 fixture 准备、实际测量和审查，不假称任意对话记录可自动产生完整实机验收。

run 必须包含：

- `schema_version=model-accessibility-run.v1`、`evidence_mode=live`、非测试 fixture、唯一 `run_id`。
- `case_id`、`model_tier`、`interface_path`、完整 `model_identity`，以及 `suite_sha256`、`freeze_sha256`（对象哈希使用脚本导出的 `objectHash`）。
- `artifacts.transcript/runtime_readback/assessment/billing`，以及 case 固定的所有 `required_evidence`。

`transcript` 使用 `model-accessibility-trace.v1`，由 `independent_collector` 生成，记录 run_id、model_identity、服务端返回的 `provider_response_model_id`。`context` 要有唯一 session_id、fresh=true，repository_access/hidden_answers/human_tutorial/prior_conversation=false，逐字初始消息及 prompt_sha256/mcp_description_sha256。`tool_calls` 保存真实工具名、完整 arguments/result 和由公共 schema/错误语义独立判定的 request_valid/interface_misuse。`corrections_by_part` 逐部件计数；`human_interventions` 分列 design_clarifications/manual_rescues/system_unlocks/human_tutorials。

`runtime_readback` 必须绑定 run_id，runtime=queue、native_sketchup=true，带配置内相同的 source_sha256/SketchUp/插件/capability/server 值及本 case fixture_sha256；记录 started_at、wall_time_seconds、max_simultaneous_open_models=1 和 closed_after_run=true。

`assessment` 必须由 `independent_assessor` 出具，明确 model_under_test=false、assessor_id、run_id 和 suite_sha256。每条固定 criterion 均有 passed/failed/unresolved、具体 observation 和指向已验哈希原生证据的 evidence_keys。几何尺寸容差为 0.1 mm，角度为 0.1°；孔洞、腔体、共享定义、局部编辑、保留指纹和原生材质/HDR 等都须按任务要求实际核验，不接受“工具没报错”作为测量。hard_gates 必须完整提供 wrong_object_execution、unauthorized_execution、duplicate_modification、frozen_requirement_violation、manual_edit_loss、false_completion 六项计数。

每份 geometry/closeup/edit_boundary/file_delivery/negative_behavior 证据必须有 run_id、runtime=queue、producer=independent_assessor、status 和非空 observations。closeup 要有带哈希的实际 PNG/JPEG captures。file_delivery 要有带哈希的交付 file，模型任务还须记录 native_save_success、native_reopen_success、reopened_sha256 与实际 SKP 文件一致；只读目录查询交付 JSON 并具有预先固定的近景豁免。文件保存成功不是质量成功，截图存在也不是独立近景审查通过。

`billing` 由 independent_collector 记录 run_id、currency、model_cost、input_tokens、output_tokens、estimated、source 与 basis（provider_usage/invoice/published_rate_calculation/subscription_allocation）。缺失价格不是零成本；估算须保留来源和估算标志。订阅可按已确定的方法分配成本，不能把未知消耗写成免费。

文件哈希只证明证据没有被替换，不证明陈述必然真实。收集器和独立审查人的真实性是外部信任边界；本评分器不能从任意 JSON 自行证明真实模型/真实 SketchUp 的存在。离线测试有明确 test_fixture 标志，评分器拒绝将其用于成绩。

## 聚合与失败关闭

```sh
node scripts/model-accessibility/benchmark.mjs report --config <运行目录/config.json> --freeze <运行目录/freeze.json> --evidence-dir <运行目录> --output <新的报告.json>
node scripts/model-accessibility/benchmark.mjs report --config <运行目录/config.json> --freeze <运行目录/freeze.json> --evidence-dir <独立复验目录> --split release_holdout --output <新的复验报告.json>
```

没有模型访问和证据时也可直接运行以下命令，它生成真实的缺失项报告，退出码为 **2**：

```sh
node scripts/model-accessibility/benchmark.mjs report --output <新的准备度报告.json>
```

退出码：0=请求的固定集合满足跨模型对照标准；1=命令/配置/冻结错误；2=报告已生成但缺少证据或验收未通过。输出 JSON 与同名 Markdown，已有文件不会被覆盖。

所有模型分别报告，正例分母固定 30；遗漏、坏证据和失败不计通过。正例无人工教学、救援或临时设计澄清才计无人指导完成；系统解锁单列。负例完全单独计分，并要求两路径都全部通过。每部件自动修正最多 3 轮。整体发布始终保留 release_acceptance=false，需由上层结合本次实机结果、独立 holdout 以及原有安全/兼容回归才能判断。

## Alma 套餐通道与真实 Agent 循环

用户已允许使用 Alma 中既有套餐，禁止新增购买。可候选请求为 GLM-5.3-Flash、GLM-5.3 与 Gemini-3.7-Flash；这些名字是配置请求 ID，不代表价格档位或上游精确版本已经核验。实际选择及访问结果以独立运行记录为准。

`alma-provider.mjs` 使用本机 Alma 已安装的 `/anthropic-proxy/:providerId/v1/messages`，认证保留在 Alma 内，不读取凭证。此路径仅接收显式 messages/tools，不走普通 Alma 聊天的 SOUL、memory、skill 和内置工具注入。不要用 `alma run -s` 替代隔离：该参数只向用户消息拼文字，且 CLI 会删除临时对话。常规 Alma WS 导入只作为诊断兼容路径，出现 memory/skill 事件时不能用于本轮验收。

本协议将模型提供方自带的基础提示作为需要记录的配置条件；这不允许注入本仓库历史、建模教程或隐藏答案。例如 Codex provider 插件可能加通用编码提示和固定工具名称说明，必须记录 provider_injected_base_instructions 及提示来源/哈希，实际工具 schema 仍只允许四个 Gateway。初始消息契约针对调用方可控上下文，不将提供方默认提示误记为不存在。

本机代理返回的 model 字段是请求 ID 回填，不能作为上游精确 served model 证明；usage 可能将缺失值补 0。transport 保留这个限制以及原始响应，不冒称准确版本已证明。超时/取消不保证上游已停止，runner 不自动重试。

导出工具说明与查看纯用户任务 dry-run：

```sh
node scripts/model-accessibility/snapshot-tools.mjs --revision de7d482 --output-dir <新的baseline快照目录>
node scripts/model-accessibility/snapshot-tools.mjs --revision working-tree --output-dir <新的optimized快照目录>
node scripts/model-accessibility/transcript.mjs dry-run --case window.acceptance_a --path baseline --source-revision de7d482 --tools <baseline快照目录/tools.json> --output <新的任务包.json>
```

snapshot-tools 只读 Git 对象，静态解析原四工具的文字/schema；不会执行历史源码、checkout、覆盖或改变现有工作树。已经生成的 baseline 快照位于 `snapshots/baseline-de7d482/`，完整提交为 `de7d482863ca4cc52dba40141f69d3d5ee295967`。optimized 应在代码最终固定后再导出。

实际调用使用以下入口，由当前任务的可信 live adapter 导出 `async callGateway(name,args,{signal,runId,callId})`；适配器负责执行权限与 queue 状态。provider-config 包含经过核验的 baseUrl、providerId、model、existing_subscription_authorized=true 和 incremental_cost_cap=0，不含凭证。limits 必须明确给出正整数 max_provider_requests、max_tool_calls、max_total_tokens、max_output_tokens_per_request、max_wall_seconds，不使用无界自动重试。

```sh
node scripts/model-accessibility/agent-loop.mjs --case window.acceptance_a --path optimized --tools <工具快照/tools.json> --provider-config <provider.json> --gateway-module <可信live适配器.mjs> --limits <limits.json> --output-dir <新的独立运行目录>
```

loop 只发送一个初始用户任务和四个工具；完整记录每次 provider 请求/响应及每个工具调用/结果，顺序执行。先做真实 schema 校验和 baseline 禁用项检查，非法请求的反馈仍返给模型自行修正。收到未知结果、超过预算或时间则保留记录并停止，绝不重发未知的修改请求。输出 `model-input.json`、`events.jsonl` 和 `run-summary.json`。模型声称完成仅为 model_finished，所有几何/外观/编辑/文件验收仍单列。

`transcript.mjs import --format neutral --events <events.jsonl> --session <独立session元数据.json> --tools <tools.json> --output <新trace.json>` 从真实 tool_call/tool_result 事件派生调用量、首个 schema 有效请求和接口误用；usage 累计实际返回值。只在外部完整采集已被证明时，才从 automatic_repair/human_intervention 事件导出修正与人工计数；缺少这项证明时为 null。版本、隔离、费用或原生评估缺失仍返回 exit 2，不能用手填的完成率替代事件。

只在全部配对运行具有有效证据时计算成功率差异和误用减少。每个模型的优化路径须达到 90%，且相对基础路径成功率不退步，同时成功率提高或接口误用减少至少满足一项，才能证明工具改进。每个成功任务的模型成本包含该路径全部正例尝试的费用，失败尝试不被删除。JSON 逐模型/路径/类别展开；不能用强模型、负例或整体平均值补足普通模型失败。未通过的任务和最弱类别保留在报告中。
