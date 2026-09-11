# 普通模型易用性：五轮 development 运行记录

记录日期：2026-09-08。范围限定为下列五轮已结束运行；本报告不启动模型或 SketchUp，不修改历史运行、任务要求或主计划。

**五轮均未完成用户要求的完整交付，完整交付数为 0。** 四轮窗任务属于 `window.development`，强模型资产查询属于 `asset_query.development`。这些运行用于发现接口和实机故障，不属于固定验收变体，更不构成正式三模型通过。代码在开发期间持续变化，不能据此报告成功率提升、误用减少比例或每个成功任务成本。

## 运行与实际结果

“请求/工具”分别为向 Alma 发出的提供商请求次数、Gateway 工具调用尝试次数；后者包含被 schema 拒绝或执行返回错误的调用，并非成功建模操作数。Token 是代理报告的输入与输出之和，耗时是各运行器记录的墙钟时间。

| 运行 | 路径 / API 模型 | 请求 / 工具 | 输入 / 输出 token | 合计 token | 秒 | 结束原因与实际结果 |
|---|---|---:|---:|---:|---:|---|
| `glm-flash-window-development` | optimized / `glm-5.3-flash` | 12 / 12 | 88,869 / 2,479 | 91,348 | 98.629 | `token_limit`；先有一次缺少 `intent` 的 schema 拒绝，随后停留在能力发现与分页读取，未发出建模创建。 |
| `glm-flash-window-development-v2` | optimized / `glm-5.3-flash` | 12 / 11 | 90,491 / 1,986 | 92,477 | 74.832 | `token_limit`；两次能力发现、九次 artifact 读取，未发出建模创建。 |
| `glm-window-development-v3` | optimized / `glm-5.3` | 8 / 23 | 90,641 / 4,425 | 95,066 | 115.406 | `token_limit`；经过预检和 queue 连接，实际创建窗，但质量失败，任务停在 `awaiting_input`。 |
| `glm-flash-window-baseline` | baseline / `glm-5.3-flash` | 12 / 12 | 70,321 / 8,705 | 79,026 | 237.838 | `provider_request_limit`；三个创建任务均以 `INVALID_ARGUMENT` 失败，反复出现 `Creation requires JSON DSL.` 及失败状态下提交冲突，没有完整交付。 |
| `strong-asset-query-development` | optimized / `gpt-5.6-sol` | 7 / 6 | 69,975 / 1,174 | 71,149 | 62.276 | `model_finished`；五次能力发现、一次 artifact 读取。模型明确表示未完成资产扫描、未保存结果 JSON；不是通过。 |

合计：**51 次提供商请求、64 次 Gateway 调用尝试、429,066 个 reported token**；五轮运行耗时相加为 **588.981 秒**，不含宿主准备、另存诊断、修复及接入探测时间。Gemini 探测和三模型最小接入探测不计入上述五轮总数。

各轮原始摘要、初始输入、完整事件和服务器任务状态的绝对路径、字节数、SHA-256 均收录在同目录 [原始来源索引](model-accessibility-development-results-2026-09-08.sources.json)。已复算每轮事件文件哈希，并核对摘要中的请求数、工具尝试数和 token 合计。

## GLM-5.3 实际窗模型的边界

创建任务为 `task_05c29c13-a645-43b5-be85-c04dbd78524f`。服务器保存了 `Alma Build Model` 的 committed mutation receipt；25 个要求部件均有测量记录，但 `quality_status=fail`、`quality_accepted=false`，三个剩余问题是：

1. `quality.layout_failed`：布局 QA 报告 `pid:41159 / id-window-900x140x1200` 的包围框重叠。
2. `detail.view_unverified`：overview 未得到有效服务器近景证据。
3. `detail.view_unverified`：closeup 未得到有效服务器近景证据。

该轮 `collision_review=null`，拍摄错误为 `DETAIL_CAPTURE_UNVERIFIED`。有创建回执、测量和 PNG 文件，都不能代替布局、视图及交付验收。

宿主随后把失败现场另存为 `glm-window-development-v3-failed-diagnostic.skp`，保存回执记录 365,585 字节。这个文件用于保留已有成果和诊断，是**宿主另存**，不是模型执行 `deliver_model` 完成的交付，也没有因此取得质量通过或冷重开验证。原始 SKP、保存 JSON 及该轮两张 PNG 的路径和哈希保留在来源索引中。

## 独立拍摄恢复诊断仍然失败

索引中的 `capture-restoration-v2/{before,after,capture}.json` 是另外一次宿主诊断，不是第六轮模型验收。该记录为 `restoration_failed`：相机与外观状态恢复，但完整模型 revision 没有恢复，三次刷新均未形成匹配。

`Sree`（persistent ID `41159`）启用了面向相机行为。记录显示其朝向矩阵变化、平移不变，模型 `modified` 前后均为 `false`；因此不能凭“相机已恢复”或“文件未变脏”放行。完整 revision 从 `sha256:c5d6780321de0a59d2b2fbd25795b73aafa689e67c8ddcb9d87cf529d7bb5ae8` 变为 `sha256:f3c5f67328ffa0ba0422fab2977de52ee1fe2a09fa3f1306eca976597d976d18`。后续代码修复或新诊断不得追溯改变这份失败记录。

## 供应商、配置和用量口径

五轮均通过 **Alma 0.4.22** 本机 Anthropic Messages 代理，使用用户已授权的现有套餐。配置文件保存了 `existing_subscription_authorized=true` 和 `incremental_cost_cap=0`，这是授权/预算条件，不是账单已证明费用为零。

| 配置 | 已验证供应商 ID | 请求 API 模型 ID |
|---|---|---|
| GLM Flash | `zai-coding-plan` | `glm-5.3-flash` |
| GLM 常规模型 | `zai-coding-plan` | `glm-5.3` |
| 强模型参照 | `plugin:openai-codex-auth:openai-codex` | `gpt-5.6-sol` |

入口为 `http://localhost:23001/anthropic-proxy/<providerId>/v1/messages`，插件 provider ID 在实际 URL 中按百分号编码。请求上限为 12 次，工具尝试上限为 24 次，累计 reported token 停止阈值为 80,000，单次请求声明 `max_tokens=2048`，墙钟上限为 600 秒。累计阈值在收到整次响应后检查，因此前三轮实际 reported 总量超过 80,000；它不是提供商账单的硬截断。

OpenAI Codex Auth 插件版本为 **1.8.8**。它附加通用 Codex 基础指令及固定 Alma developer 工具名称说明，属于本轮提供商条件；所审阅注入源码没有本仓库历史、SketchUp 人工教程或隐藏答案。插件实际透传的工具 schema 仍是四个 Gateway。Codex 基础指令来自官方源码/缓存，未另行冻结运行时缓存文本；历史 transport 的 `context_source` 不能被解释为“上游没有默认系统提示”。插件还会移除输出 token 上限，因此 Codex 单次生成的硬 token 预算不能由该字段保证；请求数、工具数和墙钟停止条件仍照实记录。

初始 `model-input.json` 均只有一条用户任务和四个 Gateway 描述。四轮窗使用相同用户 prompt 哈希；优化路径记录同一公开工具描述哈希，baseline 记录基线描述哈希及 `de7d482` 标识。然而 `working-tree`、`development-v2-inline-example`、`development-v3-inline-next-step` 等是开发标签，不是五轮代码完全一致的证明。

记录的 provider ID、API 模型 ID、插件版本与配置可以明确确认。代理返回的 `model` 字段回填请求模型，不独立证明底层权重版本；这是证据限制，不额外增加计划之外的上游权重认证门槛。实际未完成验收的原因是功能结果、实机恢复及完整测试矩阵不足。

`usage_complete=true` 只表示每次代理响应有可汇总的 usage 字段。代理可能把缺失的上游用量填零，缓存及实际费用没有独立账单核验；本报告不把 reported token 当作已确认扣费金额，也不报告“每个成功任务成本”。

## Gemini 通道阻塞

独立最小探测请求 `gemini-3.7-flash`、供应商 `gemini`。Alma 本机返回 HTTP 500，内层 Google API 为 HTTP 400 / `FAILED_PRECONDITION`，原因为 `User location is not supported for the API use.`。该通道没有进入五轮 development 矩阵；不能记为建模能力失败或模型通过。本次没有修改网络、地区或账户配置。错误原始 JSON 已列入来源索引。

## 指标解释与需同步的计划条目

**schema 合法不等于任务输入有效。** 例如 baseline 请求可以符合宽泛 `inputs` schema，却缺少可执行 `code`，随后进入缺参等待或 `INVALID_ARGUMENT`。不能把这种请求算成“首次有效请求”。

测量工具已经将两项分开：`first_schema_valid_request_rate` 记录公开 schema 与路径约束是否合法；`first_semantically_effective_request_rate` 还要求对应 Gateway 响应明确成功，且没有错误、缺失必填输入、`awaiting_input`、失败或阻塞状态。旧名 `first_effective_request_rate` 现在指向后一项。缺少响应或无法判断时记录 `null`，汇总同时给出已观察与未知数量，不假定成功或失败。这衡量单次请求是否得到有效推进，能力发现请求也可满足，**不是最终建模或交付通过**。这次更正通过 72 项离线 benchmark 断言，不改变 15 类任务和 90% 评分规则。

从五份原始事件重新派生的首次请求结果分别为：第一轮 GLM Flash「schema 不合法 / 语义无效」；第二轮 GLM Flash、GLM 常规模型和强模型资产查询「schema 合法 / 语义有效」；baseline「schema 合法 / 语义无效，缺少 `code`」。逐轮结果存于来源索引，不据此计算开发版本之间的提升比例。

主计划此次未修改，后续应同步：

- 阶段四的三模型配置与接入证据已具备候选渠道；准确保留 Gemini 地区阻塞，以及 Codex 固定基础提示条件。三模型接入不等于三模型完成建模。
- 首次使用对照只能记录上述开发诊断；固定未见验收变体、冻结代码与需求、完整 15 类任务矩阵仍待执行，不能勾选正式完成或宣称提升比例。
- 阶段三和阶段五继续保留真实失败、未验证视图及宿主诊断另存的区别。拍摄恢复、匿名对象的碰撞复核和资产入口可发现性需要修复后的新证据。
- 最终交付清单中的“三模型对照报告及原始证据”目前仅有 development 诊断部分；本报告不改变 15 类任务、90% 标准或既定质量/授权保护。
