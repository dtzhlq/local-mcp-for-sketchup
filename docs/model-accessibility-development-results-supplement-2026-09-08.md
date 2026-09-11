# 普通模型易用性：v4 / v5 与第八、九轮 development 补充记录

记录日期：2026-09-08。仅审阅已有原始文件，不启动模型或 SketchUp，不改写此前五轮报告、固定 suite 或历史结果。

**v5 已由 GLM-5.3-Flash 自行完成参数窗创建、服务器 live quality pass 和独立 SKP 保存。** 运行最终因 `token_limit` 停止，未完成最终答复和全部独立验收。不能把运行器停止原因写成“没有建模”或“没有保存”，也不能把这一次 development 的已保存成果写成完整三模型验收通过。v4 停留在发现与分页读取，未发出创建或交付请求。

逐条核对 v4 / v5 全部 166 条事件，并核验摘要、初始输入、服务器任务、不可变投影、近景、保存回执与文件。其后独立追加第八轮 39 条、第九轮 45 条事件；目前共 250 条事件、105 份来源。来源的绝对路径、字节数、SHA-256、逐次工具调用及校验结果收录于 [补充来源索引](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/docs/model-accessibility-development-results-supplement-2026-09-08.sources.json)。没有读取供应商凭证、修改历史任务或重写原始证据。下文 v4 / v5 的结论和两轮合计保留原范围，第八、九轮另列。

## 两轮用量与停止原因

| 运行 | 模型 / 路径 | 提供商请求 | Gateway 尝试 | 输入 token | 输出 token | 合计 reported token | 运行秒数 | 结束原因 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `glm-flash-window-development-v4` | `glm-5.3-flash` / optimized | 16 | 17 | 155,504 | 3,225 | 158,729 | 119.380 | `provider_request_limit` |
| `glm-flash-window-development-v5` | `glm-5.3-flash` / optimized | 16 | 17 | 170,026 | 6,567 | 176,593 | 253.022 | `token_limit` |
| 合计 | 同一请求模型 | **32** | **34** | **325,530** | **9,792** | **335,322** | **372.402** | 不含宿主准备与诊断 |

每轮 16 个 request、16 个 response、16 个 usage、17 个 tool_call、17 个 tool_result 加一条 session_start，共 83 条事件。所有已执行调用都满足记录的公开 schema；合法 schema 仍可能得到错误或无效推进。v4 为 5 次 start、11 次 artifact 读取、1 次 submit；v5 为 10 次 start、3 次 artifact 读取、3 次 submit、1 次 resume。

v5 最后一个提供商响应还提出一次 `understand_model` 工具调用，但累计 token 已达到停止条件，运行器没有执行它。故 v5 是 **18 次模型提出的工具调用、17 次实际 Gateway 调用尝试**，不能将未执行的最后一次计入工具结果。

两轮均记录供应商 `zai-coding-plan`，入口为 Alma 本机 `http://localhost:23001/anthropic-proxy/zai-coding-plan/v1/messages`；全部响应 HTTP 200，transport 未进行客户端自动重试。请求模型与回填模型均为 `glm-5.3-flash`。代理明确标记 `request_echo_only`，不独立证明底层权重版本；此为证据边界，不新增计划之外的模型认证门槛。

用户授权使用现有套餐，配置为 `existing_subscription_authorized=true`、`incremental_cost_cap=0`；没有新增购买记录，实际账单未核验。输入/输出用量按每次代理 usage 复算；缓存字段记录为零，但代理可能将缺失的上游用量补零，不能据此断言没有缓存费用。两轮合计不是已确认收费金额，也不计算“每个成功任务成本”。

这两轮开发预算记录为：最多 16 次提供商请求、24 次工具尝试、累计 160,000 reported token、每次声明 `max_tokens=2048`、600 秒。累计阈值是在整次响应返回后检查，v5 因此超出 160,000；它不是账单硬上限。此前五轮的 12 次请求 / 80,000 token 条件保持原记录，不能直接合并计算提升率。

## v4：在分页与输入修正中用完请求额度

v4 第 3 次工具调用将窗类型写为不存在的 `parametric_window`，收到 `INVALID_ARGUMENT`。第 4 次 submit 只补充 topic/detail，没有替换错误 kind，仍失败。第 5、6 次重新发现合法 `window` 并取得可执行 task 示例，第 7 次查询参数后转入 artifact 分页。

该轮共读取 11 页，每页实际只返回 512 字符。最后一页从 offset 4608 读到 5120，参数 artifact 共 5485 字符，仍有 365 字符未读到，随后达到请求上限。完整事件没有 `preflight_model`、`create_model` 或 `deliver_model` 调用；不能把“所有调用都 schema 合法”解释为完成模型任务。记录见 [v4 完整事件](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/glm-flash-window-development-v4/events.jsonl)。

## v5：创建、质量、保存和后续错误分别成立

下表序号均为实际工具调用次序，来源索引还记录对应事件行号、call ID、输入与返回时间。

| 次序 | 实际行为 | 可确认结果 |
|---:|---|---|
| 1–3 | 发现入口、读取一页，再查询 `parametric_window_catalog` | 第 3 次因不存在的 kind 失败。 |
| 4–7 | 同任务改为 `window`，取得参数，连接 queue，预检 900×1200×140 mm 输入 | 第 4 次成功修正；第 7 次 `preflight_ok=true`，尚未执行几何。 |
| 8–10 | 创建请求漏传连接；另建连接后只 resume 原创建任务 | 第 8、10 次均为 `HANDSHAKE_REQUIRED`，没有凭新连接任务自动获得授权。 |
| **11** | submit 将 `connection_task_id` 交给原创建任务 | **实际创建完成；`quality_status=pass`、`quality_accepted=true`、`evidence_level=live_runtime`，remaining=0。** |
| 12–13 | 读取创建结果第一页，重新连接交付 | 创建原始结果约 244,254 字符，模型该次只读到 512 字符；随后继续保存。 |
| **14** | 模型发出 `deliver_model`，有稳定幂等键及新连接 | **保存成功，`saved=true`、`live_saved_file`，独立 SKP 为 365,831 字节。** |
| 15–16 | 又发出多余的 verify 请求，把 source_task_id/task 交给旧接口，再把 task ID 字符串当 snapshot | 旧入口先等待 `code_or_snapshot`，随后错误地完成零对象诊断；`quality_status=pass`，但 `quality_accepted=false`、`supplied_snapshot`。这不是新的模型质量证据。 |
| 17 | 读取上述无效诊断第一页 | 只读 512 字符。下一次提供商响应提出 understand_model，但预算停止，未执行。 |

创建任务为 `task_2d36a542-895a-4610-a871-e2e43c82d35b`，原生 `Alma Build Model` 回执明确为 committed。第 11 次结果于北京时间 **10:42:57.963** 返回。原冻结 spec 哈希为 `sha256:86d772f73e4f7a7098a0d5f80163dcc3576579885513e2aaf88d32e9b01a904c`，要求和实际测量部件均为 **25**，没有剩余质量项。此窗任务没有 required_void 条目；不能把 25 个部件的检查扩写成所有任务的孔洞、腔体或编辑边界均已验收。

原生局部测量包括：外框 **900×140×1200 mm**；每扇框 **386×58×1072 mm**；外层玻璃 **322×6×1008 mm**；窗台 **970×270×28 mm**。这些分别是对应部件的原生局部 bounds。整体窗含外挑窗台，所以总 bbox 为 **970×270×1225 mm**，不能拿整体外包框误判外框尺寸。两扇实例具有不同 occurrence path，并引用共享子定义；这证明层级和身份记录存在，尚不证明模型实际执行过单件编辑、关联编辑或开启操作。

场景保留了模板人物 `Sree`。服务器对它与窗的 bbox 重叠进行了原生局部几何检查，在共享盒区域的 Sree 一侧未发现几何，因此记录 `native_separation_proof` 并解除该布局冲突。不是单凭 bbox 重叠就移动模板人物，也不是隐藏原警告。原生存储几何资源为 612 面、2654 边、2082 顶点；可见实例展开统计为 1070 面、3428 边、2418 顶点，包含人物，不能当作窗的独立资源成本或细节分数。

overview 和 closeup 均有 **1600×1000** PNG、匹配模型 revision 的 `server_verified=true` 记录，文件 SHA 已复核。只读查看 [overview 原图](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/glm-flash-window-development-v5-state/tasks/task-artifacts/task_2d36a542-895a-4610-a871-e2e43c82d35b/detail-views/iteration-0/attempt-1/id-window-900x1200x140-overview.png) 可见双扇、框、玻璃、把手及窗台，左侧人物仍在；上缘及窗台下缘贴近或部分超出画面边界。此观察保留服务器现有 QA 结论，同时说明 PNG 存在与尺寸合格不替代完整独立视觉评审。

保存任务为 `task_3d0d51de-da21-411d-bbbc-8c089b8e8e1e`，第 14 次调用于北京时间 **10:43:49.714** 返回成功。已核对签名日志文件存在、保存意图与回执来源一致，以及 [实际 SKP](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/glm-flash-window-development-v5-state/tasks/model-deliveries-v1/task_3d0d51de-da21-411d-bbbc-8c089b8e8e1e/model.skp) 的字节数和 SHA：`f0bc68bda36074865cbd3af2773892cdc026476d17d5da2f86e4c27ee8586d65`。本附录没有读取签名密钥或重新签发回执，密码学 HMAC 验证属于原服务器保存链。完整模型事件见 [v5 原始记录](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/glm-flash-window-development-v5/events.jsonl)。

第 16 次的字符串 snapshot 缺陷已作为后续代码修复：入口拒绝 task ID、数组、空对象、无效 totals，以及被忽略的 task/source_task_id；已通过 30 项隔离离线输入测试。这个修复不能追溯改写 v5 的错误返回，也不能为 v5 新增实机成绩。真实创建与保存已有各自有效证据，不依赖该无效诊断。

## 宿主诊断和磁盘重开

`capture-restoration-v4-diagnostic` 和 `capture-restoration-v5` 是宿主拍摄恢复诊断，均不计为普通模型运行。v4 诊断中相机、外观、模型 revision 已匹配，但相机朝向实例恢复仍被报告 `native_matrix_restore_failed`，因此总结果为 `restoration_failed`、server_verified=false；不能事后替它改判。v5 新诊断记录 `restored_exact_native_matrices`、同一实例真实返回和精确矩阵回读，并在两次连续刷新中匹配完整 revision，最终 `captured_and_restored`。

模型已保存后，宿主曾额外尝试再次从原创建来源交付，因当前 source_path 已变为交付路径，得到 `MODEL_IDENTITY_MISMATCH`。这是一次被阻止的宿主调用，没有第二份成功保存，不能替代或抹掉第 14 次已有的模型保存成果。

随后宿主通过 CUA `Cmd+W` 关闭已保存模型窗口，再 `Cmd+O` 打开同一交付 SKP。记录明确 `application_restarted=false`，所以是**文档关闭后从磁盘重开，不是退出并重启 SketchUp 应用**。北京时间 10:51:07 的新会话状态表明 document ID 和 runtime object ID 均已变化，路径是原交付文件，`model_modified=false`，完整模型 revision 与保存时完全相同：`sha256:88f7c3443da22962a73c0db4818196f4256af0c44d37fae81c6915625ccae703`。

重开后可见统计一致；附录还逐项比对外框、两扇框、两片外层玻璃和窗台的持久路径、定义、原生测量与局部 bounds，全部一致。记录见 [宿主磁盘重开回读](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/glm-flash-window-development-v5-state/host-disk-reopen.json)。但这组证据没有在重开后实际修改参数，也没有再次保存重开验证修改后的参数和同伴保持，不能宣告第 15 类通过。

## 固定验收条件与仍缺证据

两轮均严格使用 `window.development` 的相同用户 prompt，初始上下文只有该用户任务和四个 Gateway 描述；后续用户角色消息仅为工具结果，未插入仓库源码、人工教程或隐藏答案。prompt 哈希相同，工具描述哈希也相同。两轮服务端却分别标记 `development-v4-flat-example-capture-restoration` 与 `development-v5-inline-parameters-and-example`，公开回复和代码在开发中变化；相同四工具描述不证明运行了完全相同的服务器版本。

固定 suite 的 15 类、至少两个未见正例变体、负例、三模型、baseline/optimized 同 fixture 与同提示、质量/编辑/文件证据和 90% 要求均保持不变。这两轮只是同一模型的同一个开发窗任务；模板人物所在的当前文档不是一份已冻结、成对重建并校验哈希的正式空 fixture。没有新的 baseline 对照，也没有 holdout 或三模型完整矩阵。

可增加的开发事实是“**出现一次由普通模型自行创建、服务器 live quality pass 并保存的窗成果**”。仍缺：普通模型完整结果答复、独立编辑边界执行、明确开启能力交付、完整视觉评审、重开后参数修改及再次保存重开、其余任务类和模型的正式对照。两份 run-summary 均保留 `independent_quality_assessment=missing`、`live_runtime_acceptance=false`、`release_acceptance=false`；这些验收状态与 v5 几何/保存已成功可以同时成立。

此前五轮报告继续准确覆盖它自己的时间范围。本附录不改其历史“完整交付数 0”，也不把新窗的保存成功直接统计为正式完整交付率或接口提升百分比。

## 独立追加：第八轮强模型资产查询

`strong-asset-query-development-v2` 于北京时间 11:07:20–11:08:25 运行，请求模型为 `gpt-5.6-sol`，经 Alma 本机 `plugin:openai-codex-auth:openai-codex` 代理，使用 optimized 接口。任务只要求查询本地 chair 资产，报告文件、尺寸、轴向、原点、来源、许可及宽度是否不超过 900 mm，并保存 JSON；没有要求导入资产或修改当前模型。

**第二次工具调用已完成目录查询并保存两项结果 JSON；最终文字汇报没有完成。** 该轮共 8 次提供商请求、7 次实际工具尝试（2 次 start、5 次 artifact 读取），reported 输入 **88,599**、输出 **1,310**、合计 **89,909 token**，运行 **65.274 秒**，最终为 `token_limit`。全部 39 条事件由 1 次 session_start、各 8 次 request/response/usage、各 7 次 tool_call/tool_result 构成，记录见 [第八轮完整事件](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/strong-asset-query-development-v2/events.jsonl)。

查询任务 `task_d7393fbf-f5bc-4e41-9721-9df9be5a557d` 于 11:07:42.289 返回 completed，短回复展示第一项并标明 returned_count=2；服务器完整 [asset-query.json](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/strong-asset-query-development-v2-state/tasks/task-artifacts/task_d7393fbf-f5bc-4e41-9721-9df9be5a557d/asset-query.json) 已保存两项。只读复核两个 SKP 的当前字节数/SHA，并逐项匹配宿主先前源模型创建后的 native-inspection 实际 bbox 和 revision，可确认下表的历史原生尺寸与现存文件对应记录一致。

| 文件 | 实际源根外包尺寸 W×D×H，mm | 宽度 ≤900 | 当前文件字节数 | SHA-256 |
|---|---|---|---:|---|
| chair.skp | 726×689.224059×959.251362 | 是 | 345,669 | `e0cd8200c2a83108a6fa2b202572aafef3e1894fea9816919d7045365b958c21` |
| armchair.skp | 886×794.970633×1057.457266 | 是 | 348,155 | `144c37f670fb11881ac293dd9e8602b88268dcaa5fe030cd8dac442d6de122bb` |

两项目录均声明 mm、+Z 向上、原点 `[0,0,0]`、宽/深/高轴分别 +X/+Y/+Z、朝向 −Y；来源为项目作者创建的构造家具，许可记录为 `project source terms`。轴向、原点、来源和许可是目录元数据，不能将其写成此次模型运行的新原生测量或新的独立许可核验。历史原生 bounds 的最小点均为 `[17,48,0]`，所以源根原点不等于几何外包框最小点。查询保留 `native_geometry_verified=false`、`cold_reopen_verified=false` 和 `untrusted_catalog_claim_requires_live_inspection`；本附录没有打开、导入或重开这些 SKP，不替目录提高信任等级。

模型随后请求完整目录。虽然首次请求 `max_chars=20000`，五次读取各返回 512 字符；最后停在 **offset 2560 / total 4316**，尚余 **1756 字符**，第二项的尺寸部分尚未读到。最后一次提供商响应提出 offset 2560 和 3584 的两次读取，累计预算先触发，所以两次均未执行。准确计数为 **9 次模型提出调用、7 次实际执行**。该响应虽然标记 `stop_reason=end_turn`，内容只有两个 tool_use，没有最终文字回答；run-summary 的 model_claim 为空。七次已执行调用均 schema 合法，目录已查询、JSON 已保存，也不等于模型完成用户所需报告。

本轮预算为 12 次请求、24 次工具、累计 80,000 token、每次声明 2048、600 秒；累计阈值仍在整次响应返回后检查。Codex 插件会注入默认通用基础指令及固定 Alma 工具名称说明，实际传入的 schema 仍只有四个 Gateway 工具；旧 transport 的 `context_source` 不能证明上游没有默认基础提示。初始调用方消息只有本次用户任务，所有后续用户角色消息均为工具结果，无额外人工提示或仓库历史。代理回填模型名不证明具体底层权重版本，reported usage 可能对缺失字段补零；插件不保证传入的 2048 是实际输出硬上限。用户现有套餐授权保持有效，没有新增购买，实际账单未核验。

宿主已在这轮之后修改短回复投影：最多三项资产直接返回，重复轴向、来源和许可放入共用字段；宿主报告 chair 两项回复 3477 字符、全部三项 3725 字符。**这是后续代码修正及宿主测量，尚未新跑模型。** 它不改变本轮分页事实，也不能为本轮补上最终回答或完整验收成绩。

本轮是独立的 asset_query.development，source_revision 为 `development-v6-native-catalog-inline-query`；没有 baseline 同条件配对、两变体完整矩阵或独立完整结果评审，仍不是固定 suite 第 5 类正式通过。此次新增事实限于真实可用目录、两项历史原生尺寸有据且均 ≤900、查询 JSON 已保存；缺口是模型最终报告、当前导入/重开测量（本任务本就不允许导入）及正式对照证据。不得把 token_limit 写成“没有查询/没有保存 JSON”。

补充报告所覆盖的这三轮合计为 **40 次提供商请求、41 次实际工具尝试、414,129 输入 + 11,102 输出 = 425,231 reported token、437.676 秒**。这只是新增三轮记录的算术合计，不含此前五轮、宿主准备或诊断，也不构成成功率或收费统计。

## 独立追加：第九轮完成资产查询答复

`glm-flash-asset-query-development` 请求 `glm-5.3-flash`，经 Alma `zai-coding-plan`，于北京时间 11:15:27–11:16:56 运行，最终 **model_finished**。逐条核对全部 **45 条事件**：1 次 session、各 9 次 provider request/response/usage、各 8 次 tool_call/tool_result，以及 1 次 model_final。用量为 **64,292 输入 + 2,919 输出 = 67,211 reported token**，运行 **89.236 秒**。所有 8 次实际调用均 schema 合法，9 次提供商请求均 HTTP 200，无客户端自动重试；请求/回填模型和用量仍保持上述代理证据边界。[原始事件与最终答复](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/glm-flash-asset-query-development/events.jsonl) 保留完整过程。

**该轮自行取得两项 chair 目录、完成最终报告，并给出系统已保存的 JSON 产物句柄。** 第一次工具调用直接使用 discover/assets/query=chair，短回复同时包含两项可用文件、726 mm 和 886 mm 宽度及共用轴向/来源/许可。模型仍选择读取完整结果 artifact，随后七页分别返回 **923、954、962、933、970、948、810 字符**，完整读完 6500 字符。它不是每页固定 923 字符，也不是该轮没有分页。

最终答复列出的两项 W/D/H 与保存目录一致（保留到三位小数），正确计算 **726≤900、886≤900**，报告根轴 +Z 向上、+X/+Y/+Z 尺寸轴、原点 `[0,0,0]`、−Y 朝向、来源与 `project source terms`，并给出完整结果与资产清单两个可读句柄。该轮的 [保存资产清单](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/glm-flash-asset-query-development-state/tasks/task-artifacts/task_0a109548-d86a-45fe-a941-19a61d6b7dfd/asset-query.json) 对应 task `task_0a109548-d86a-45fe-a941-19a61d6b7dfd`。没有导入或模型修改调用。答复保留 `preflight_only` 和目录需实际检查的界限；其中“原生几何未经实测核验”应理解为本次只读查询没有重新实测，历史宿主 native-inspection 的已记录测量仍存在。

初始调用方消息只有相同的 asset_query.development 用户任务，后续仅工具结果，实际只提供四个 Gateway 工具，未加仓库历史或人工提示。此次 source_revision 为 `development-v7-inline-complete-asset-records`，工具说明哈希也与第八轮不同；预算为 12 请求 / 24 工具 / 80,000 token / 每次声明 2048 / 600 秒。模型与代码条件同时发生变化，不能据这两轮计算改进因果或成功率。可记录“出现一次由普通模型自行完成目录查询、JSON 产物和准确最终报告的开发结果”；固定 suite 第 5 类两变体、三模型和 baseline 配对仍未齐备，run-summary 保持 independent_quality_assessment=missing、live_runtime_acceptance=false、release_acceptance=false。

新增四轮（v4、v5、第八、第九）合计 **49 次提供商请求、49 次工具尝试、478,421 输入 + 14,021 输出 = 492,442 reported token、526.912 秒**。这仍是开发记录的算术合计，不含最早五轮或宿主动作，不是正式通过率和账单。

## 独立宿主验证：按真实窗 bounds 取景

宿主在 v5 结束后，将 common task 的 overview 改为依据真实根 bounds 自动正交取景；此次只对已有 v5 交付文件额外拍摄，没有重新建窗，也没有改写 v5 冻结的视图要求。`overview-native-bounds-v2` 于北京时间 11:18:22 生成 **1600×1000** 图，native bounds 为 **970×270×1225 mm**（含窗台），结果 `captured_and_restored`、server_verified=true。PNG SHA 为 `6008e3ff53b6b135d7d2c367c0b66c6545c30602042cfbadc764fb1c984d6013`，文件字节已复核；只读查看 [新 overview](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/overview-native-bounds-v2/window-native-bounds-overview.png) 可见整窗和窗台四周留有空白，未再裁切，左侧 Sree 保留。此为定性查看，没有赋予新的模型质量分数。

前后完整 revision 均为原 v5 保存时的 `sha256:88f7c3443da22962a73c0db4818196f4256af0c44d37fae81c6915625ccae703`，model_modified 前后均 false；相机、显示状态和 Sree 原生矩阵恢复成功，并有两次连续 revision 匹配。[capture.json](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/model-accessibility-live-2026-09-08/overview-native-bounds-v2/capture.json) 记录细节。

宿主说明这次 before 是安装原生资产/生命周期改动、完整重启 SketchUp 后重新打开原 v5 SKP 得到的状态。补充来源明确区分：before/after 文件直接证明原交付路径与相同 revision，应用进程重启本身由当时宿主操作记录说明。这不将旧 `host-disk-reopen.json` 的 application_restarted=false 改成 true，也不把后来宿主取景、重启或验证当作 v5 模型当时自行完成的操作。重开后实际参数修改和再次保存重开的必要证据仍须另行获得。
