# 普通模型首次连接、创建与保存交付

通过原有四个 Gateway 工具完成发现、预检、创建、保存和状态恢复：`start_agent_task`、`resume_agent_task`、`submit_agent_task_input`、`read_agent_artifact`。完成必要质量审查并保存后，交付文件即可结束；第 8 节重开仅在用户明确要求持久化/恢复专项时执行。保存返回 `cold_reopen_verified=false` 表示未验证，不表示必须接着测试。

实际支持边界见 [15 类任务表](model-accessibility-support-2026-09-11.md)。接口及离线检查通过不等于三模型实机验收完成；[量化验收说明](../benchmarks/model-accessibility/README.md)现为后续可选专项，不是日常使用前置条件。

下列 JSON 使用 `tool` 和 `arguments` 表示一次工具调用。包含 `<…>` 的值必须替换为前一步服务器返回的真实标识；示例尺寸用于演示，实际任务应使用用户明确给出的设计值。新设计使用自己的构件 ID 和幂等键，重试同一请求时保留原值。

## 1. 发现入口

```json
{"tool":"start_agent_task","arguments":{"intent":"discover","instruction":"查看可以完成的建模任务","inputs":{"topic":"start"}}}
```

随后使用同一工具的 `discover` 意图，按需要展开 `inputs`：

| inputs | 返回内容 |
| --- | --- |
| `{"topic":"tasks"}` | 窗、门、柜体、台面水槽、内置资产放置目录 |
| `{"topic":"tasks","kind":"window","detail":"parameters"}` | 必填、默认值、范围、依赖和轴向 |
| `{"topic":"tasks","kind":"window","detail":"examples"}` | 与实现一致的最小例子及缺参负例 |
| `{"topic":"assets","query":"chair"}` | 本地资产的来源、许可及可用性 |
| `{"topic":"workflows","task_name":"edit_single"}` | 扁平短响应：合法下一步、最小输入模板及审查/质量边界；旧名 `resize_single` 仍兼容 |
| `{"topic":"workflows"}` | 全部 15 类的 `task_names`；选择一类后，核心输入无需读取结果文件 |
| `{"topic":"parameter_sources","runtime":"queue"}` | 当前文档的可信参数来源、真实根目标及支持参数；可选 `query` 过滤，不授予修改权限 |
| `{"topic":"connect","runtime":"queue"}` | 只读检查 SketchUp、当前模型和连接，返回 `connection_task_id` |

单类工作流直接给出 `next_call` 和（修改类的）`call_template`。`template_only:true` 表示设计值、目标、来源任务和幂等键仍须替换为实际信息；它不代表已获批准或质量通过。排列、镜像仍需先计算明确的变换，不能把专家准备描述成通用自动排列功能。

其他长响应提供 `presentation.full_result_artifact`；仅在需要完整证据时，通过第四个工具分页读取：

```json
{"tool":"read_agent_artifact","arguments":{"task_id":"<原响应 task_id>","handle":"<presentation.full_result_artifact>","offset":0,"max_chars":1500}}
```

正文在 `result.artifact.content`。后续使用返回的 `next_offset`，直到 `eof=true`；拼接正文后读取完整 `result`。文件句柄与任务绑定，不需要模型访问本地源码或路径。

## 2. 明确设计输入并预检

构件尺寸和位置均以毫米表示。+X 为宽、+Y 为深、+Z 向上，门窗和柜体正面朝 -Y。先按局部坐标生成，再绕 Z 旋转，最后平移到世界坐标 `origin_mm`。各任务的几何原点、构造默认值和支持范围以参数契约为准。

```json
{
  "tool":"start_agent_task",
  "arguments":{
    "intent":"preflight_model",
    "instruction":"检查这扇窗的尺寸和构造输入",
    "inputs":{
      "task":{
        "version":1,"kind":"window","id":"study-window-01","units":"mm",
        "parameters":{"width_mm":1600,"depth_mm":130,"height_mm":1300},
        "placement":{"origin_mm":[0,0,0],"rotation_z_deg":0}
      }
    }
  }
}
```

预检检查参数、声明的引用与依赖、操作和资源预算。它不创建 SketchUp 几何；当前文档的真实对象冲突、原生版本能力和授权仍需执行管线核验，近景、外观及文件结果须在执行后验证。

## 3. 连接并创建

在已经打开且可编辑的测试文档中连接；连接不会创建、打开、清空或授权修改模型：

```json
{"tool":"start_agent_task","arguments":{"intent":"discover","instruction":"只读连接当前测试文档","inputs":{"topic":"connect","runtime":"queue"}}}
```

保存返回的 `connection_task_id` 和到期时间。完整签名保存在服务器内，不从短响应重建或修改签名。创建使用刚才预检的同一份 `task`：

```json
{
  "tool":"start_agent_task",
  "arguments":{
    "intent":"create_model",
    "instruction":"在明确位置创建这扇参数窗并按冻结质量要求检查",
    "idempotency_key":"study-window-01-create-v1",
    "inputs":{
      "runtime":"queue",
      "connection_task_id":"<刚才连接的 connection_task_id>",
      "task":{
        "version":1,"kind":"window","id":"study-window-01","units":"mm",
        "parameters":{"width_mm":1600,"depth_mm":130,"height_mm":1300},
        "placement":{"origin_mm":[0,0,0],"rotation_z_deg":0}
      }
    }
  }
}
```

`mock` 用于离线验证，不能产生原生 SKP 交付。使用 `queue` 还必须符合主机已有执行策略。不要混用 `inputs.task` 与 `code/detail_spec/views/spec`；编译后的几何和冻结质量规格由服务器生成。已有专家调用仍可直接传完整 `session_contract`，与 `connection_task_id` 二选一。

保留创建响应的 `task_id`。`task_state` 表示执行状态；`quality_status`、`quality_accepted` 和 `evidence_level` 表示质量及证据。只有服务器记录 `completed`、`pass`、`true`、`live_runtime`，且保留冻结详细规格与完整原生 revision 的创建任务，才满足下一步保存入口的来源条件。

## 4. 保存为实际 SKP

创建会改变模型 revision，保存前重新执行第 3 步的只读连接，取得当前文档的新鲜 `connection_task_id`。然后提交独立交付任务：

```json
{
  "tool":"start_agent_task",
  "arguments":{
    "intent":"deliver_model",
    "instruction":"将已通过原生质量检查的创建结果保存为独立 SKP",
    "idempotency_key":"study-window-01-delivery-v1",
    "inputs":{
      "runtime":"queue",
      "source_task_id":"<已通过质量检查的创建 task_id>",
      "connection_task_id":"<创建后重新连接的 connection_task_id>"
    }
  }
}
```

服务器核对来源会话、文档、模型身份、当前 revision 和冻结质量结论，在自己的任务存储中分配唯一新 `model.skp`。保存的是完整当前文档，当前文档路径会切换到这个交付文件；已有源文件不被覆盖。此入口不接受任意 `path`、覆盖选项、补充修改操作或调用方声称的质量通过。

成功结果包含 `saved=true`、文件 `sha256` / `bytes`、交付 `artifact.handle` 和 `evidence_level=live_saved_file`。保存任务有独立 `task_id`，请同时保留创建与保存两个标识。短响应若被压缩，按第 1 步读取完整结果。SKP 的 opaque 句柄是交付文件引用，不是原始本地路径或新的修改许可。

`cold_reopen_verified=false` 与 `release_acceptance=false` 会明确返回。保存不会自动关闭或重开；第 8 步的独立重开任务可核验真实文档关闭与磁盘重开。原生外观和后续参数修改仍须独立证据。

## 5. 在原任务中恢复

任何响应中断或执行结果不确定，先查询原任务。创建中断使用创建 `task_id`，保存中断使用保存 `task_id`：

```json
{"tool":"resume_agent_task","arguments":{"task_id":"<发生中断的原 task_id>"}}
```

不要换幂等键重新创建或保存。保存有持久签名意图和完成凭据：已有完成凭据时，`resume` 仅核验文件与凭据并补齐返回；只有 SKP 文件或未完成意图时返回待核查状态，绝不会再调用一次原生保存。没有保存凭据的普通待输入任务，`resume` 也不会发起首次保存。

若确定尚未执行且状态为 `awaiting_input`，按返回的字段要求补交输入。例如保存任务缺少来源或新鲜连接：

```json
{
  "tool":"submit_agent_task_input",
  "arguments":{
    "task_id":"<待输入的保存 task_id>",
    "idempotency_key":"study-window-01-delivery-input-v1",
    "input":{
      "source_task_id":"<已通过质量检查的创建 task_id>",
      "connection_task_id":"<新鲜连接的 connection_task_id>"
    }
  }
}
```

这次提交使用稳定幂等键，重发时保持一致。创建任务缺设计输入时可用同一工具提交修正后的完整 `task`；创建开始后尺寸与质量要求已冻结，不能这样重编译。质量尚未通过且仍为 `awaiting_input` 的创建任务，可在受审查编辑之后提交 `reverify`。已 `completed` 的创建任务不接受新的修改或 reverify 输入；后续参数修改须另走绑定真实设计任务的编辑流程，旧质量结论不能用于修改后的保存。单部件连续自动修正最多三轮，耗尽后保留成果与原因。

错误区分 `self_correctable`、`design_input`、`user_approval`、`runtime_blocked`；具体问题位置见 `error.details.issues`（有该字段时）。连接回执和模型文字中的“批准”不授予编辑权限。`MODEL_REVISION_MISMATCH` 说明已验收模型被改变，不能仅重连后借用旧质量结论保存。

## 6. 其余 11 类工作流的真实边界

`discover` 的 `topic=workflows` 已列出全部 15 类；前四类返回可预检的完整构件输入。以下是其余 11 类的实际范围。单类响应中的 `call_template` 只给结构和示例值，必须填入实际来源、目标和设计值；提案、批准、原生执行与质量通过仍是不同状态。

| task_name | 当前可用范围与仍需条件 |
| --- | --- |
| `asset_query` | 四工具可用 `discover/assets` 查询默认本地目录；自定义 `catalog_path` 仍是 `query_assets` 专家参数。配方源码不是可导入 SKP。 |
| `asset_place` | 四工具的 `reviewed_existing_model_edit` + `inputs.asset_edit.mode=place` 从服务端原生资产目录加载完整根；SHA 校验、原尺寸旋转及放置在同一受审事务内完成。旧名 `asset_import` 兼容。 |
| `array_align` | 需计算轴、锚点和间距；已有对象走明确目标的审查编辑，没有通用 align/array intent。 |
| `edit_single` | `modify_design_parameters` 使用 `parameter_edit:{creation_task_id,scope:"single",targets,changes}`；只替换唯一实例定义并保留同伴，需要可信创建基线、新鲜连接与主机审查。 |
| `edit_linked` | 同一公开参数结构使用 `scope:"all"`，`targets` 必须列出真实共享定义的完整实例集合；缺失、嵌套或人工分歧基线会阻止。 |
| `asset_replace` | 同一 Gateway intent + `asset_edit.mode=replace` 从服务端目录加载 SKP 并替换唯一根实例；保留身份、矩阵及同伴，不接受任意文件路径。旧名 `replace_asset` 兼容。 |
| `mirror_layout` | 明确目标、世界镜像平面、pivot 和移动/复制语义后审查执行；原语不能随意添加组件镜像字段。 |
| `native_pbr` | 四工具使用 `apply_native_appearance` 准备并执行受审 PBR/UV 应用；需要服务端素材目录、真实 `.style` 与原生读回。原生显示和视觉效果仍需检查。 |
| `native_hdr` | 同一 `apply_native_appearance` intent 创建 HDR 环境和新场景，保持几何；需要真实 HDR/风格文件、批准和原生场景回读，不覆盖同名场景。 |
| `local_repair` | 有原任务时先 resume；新增缺件和已有对象修改分流，保留冻结要求、人工修改及三轮上限。 |
| `save_reopen_resume` | `deliver_model` 保存已通过 queue 创建/冻结验证的成果，`reopen_delivered_model` 按第 8 步关闭确切交付文档并从磁盘重开；参数来源须再显式恢复。旧名 `save_reopen` 兼容。 |

所有单类工作流的下一步和模板均使用原有四工具。排列、镜像仍要求明确目标及计算后的变换；不能把说明或只读提案算作修改已执行。可复制任务文件位于 [examples/model-accessibility](../examples/model-accessibility/)，完整验收仍要求实际几何、近景、编辑边界和文件生命周期证据。


## 7. PBR / HDR 外观的四工具流程

主机先配置 `ALMA_SKETCHUP_APPEARANCE_CATALOG_PATH`（有来源、许可及真实素材哈希的目录 JSON）与 `ALMA_SKETCHUP_APPEARANCE_STYLE_PATH`（实际导出的 `.style`）。客户端只提交目录预设名和设计参数，不能传任意文件路径、代码或批准 token。`discover/workflows` 的 `task_name=native_pbr` 或 `native_hdr` 返回这些参数和可用范围。

下面为已有唯一根板件 `P` 准备木材 PBR 审阅；矩阵和几何保持，明确的非共享子容器分别写入真实通道与双面 UV：

```json
{"tool":"start_agent_task","arguments":{"intent":"apply_native_appearance","instruction":"只给 P 应用木材，保持其他对象，准备原生回读、近景和独立 SKP。","idempotency_key":"pbr-P-wood-750-v1","inputs":{"runtime":"queue","appearance":{"kind":"native_pbr","target":"P","preset":"wood","texture_size_mm":[750,750],"rotation":30}}}}
```

HDR 使用相同 intent，替换 `appearance` 即可。此处强度明确写入 `skydome_exposure` 与 `reflection_exposure`，新场景保存当前相机：

```json
{"kind":"native_hdr","environment":"studio","rotation":30,"intensity":1,"scene_name":"验收外观"}
```

准备结果为 `awaiting_review`，包含实际目标、素材、操作、保存效果及本地批准链接。在可信本地页面批准后，执行第 2 步 `discover/connect` 获取新鲜连接，提交原外观任务：

```json
{"tool":"submit_agent_task_input","arguments":{"task_id":"<原外观 task_id>","idempotency_key":"pbr-P-wood-750-submit-v1","input":{"connection_task_id":"<新鲜 connection_task_id>"}}}
```

服务端冻结原输入、素材 SHA、完整模型 revision 和批准 binding；原生回读、UV 与无关对象保持检查通过后，严格恢复截图并保存服务端唯一新 SKP。任何不确定响应只对原任务 `resume_agent_task`；已开始的 build/capture/save 不会自动重放。只有持久完成凭据齐全时才能只读补齐交付。

结果的 `quality_accepted=false` 是有意保留的验收边界：文件已保存不代表视觉及冷重开已通过。真实 `.style` 的名字不能证明 Photoreal 已启用；`capture_current_display:true` 仅把主机已经启用的当前原生显示保存进新风格。若预置风格未能提供要求的原生显示，须保留具体结果并由主机完成显示设置与视觉复核，再实际关闭、磁盘重开并比较原生材质像素和场景绑定。


## 8. 关闭交付文档并从磁盘重开

`saved_delivery_task_id` 可指向第 4 步的 `deliver_model` 保存任务，或第 7 步已经保存完成的 `apply_native_appearance` 任务；外观任务无需再调用 `deliver_model`。服务端分别验原保存签名链，客户端不能提供路径或拼装保存证明。较早外观凭据若未签入保存后的文档状态，会明确拒绝重开，不从当前模型补造历史证据。外观重开只证明同一 SKP 的文档生命周期，不提供参数来源或视觉质量通过。

当前文档必须仍是该任务保存的确切文档，完整 revision 与文件 SHA/字节未变且 `modified?=false`。此功能要求兼容的 macOS 原生插件，不能用于任意文件或丢弃未保存修改。先按第 3 步重新连接，再执行：

```json
{
  "tool":"start_agent_task",
  "arguments":{
    "intent":"reopen_delivered_model",
    "instruction":"关闭刚才保存的确切交付文档，并从同一 SKP 文件重开，核验原文档已关闭及文件和模型 revision 保持。",
    "idempotency_key":"study-window-01-reopen-v1",
    "inputs":{
      "runtime":"queue",
      "saved_delivery_task_id":"<第 4 步保存或第 7 步外观保存 task_id>",
      "connection_task_id":"<保存后重新连接的 connection_task_id>"
    }
  }
}
```

重开任务的来源一经声明冻结。缺连接时可向同一个任务补交 `connection_task_id` 和稳定提交幂等键；不能换来源、传任意路径或重建签名。`resume_agent_task` 不会发起首次关闭。

服务端先写持久执行声明，关闭后要求原 native handle 已失效，再从已验签的文件重开。若返回 `pending_mdi_activation`，只激活已经打开的目标窗口，再 `resume_agent_task`；恢复仅读取当前状态和文件哈希，不再开关窗口。任何响应不确定都保留原 `task_id`，不得另起关闭请求；缺少原生返回的执行声明永不重放。

只有旧句柄失效、新 document/runtime object、同文件 SHA/字节、完整 revision 及未修改状态都通过，才返回 `document_close_reopen_verified=true` 和 `cold_reopen_verified=true`。这表示文档已关闭并从磁盘重开；`application_restarted=false`、`cold_application_restart=false`、`parameter_rebound=false` 和 `quality_accepted=false` 明确保留其余边界。已有完成凭据时，后续即使文档已更换，恢复也只验文件与凭据。

继续参数修改时，先取得新连接，再创建 `modify_design_parameters` 任务：`inputs.saved_delivery_task_id` 指向原保存任务，`inputs.parameter_edit.creation_task_id` 指向原创建任务，并明确 scope、targets 和 changes。服务端核验保存时的参数来源再准备修改。重开任务本身不自动恢复参数绑定，不替代后续尺寸、同伴保持或原生外观验收。

## 9. 参数修改（single/all）闭环示例与当前支持边界

参数修改的关键路径固定为：`discover(topic=parameter_sources) -> modify_design_parameters -> verify_model`。参数修改完成后必须回到 verify，才能进入下一步保存；仅当用户明确要求持久化重开恢复验收时，才执行第 8 节。

```json
{"tool":"start_agent_task","arguments":{"intent":"discover","instruction":"查询当前模型可执行的参数来源。","idempotency_key":"parameter-source-lookup-v1","inputs":{"topic":"parameter_sources","runtime":"queue","query":"A"}}}
```

```json
{"tool":"start_agent_task","arguments":{"intent":"modify_design_parameters","instruction":"仅调整 A 柜宽度为 900 mm。","idempotency_key":"edit-single-cabinet-900-verify","inputs":{"runtime":"queue","connection_task_id":"<step connect task_id>","parameter_edit":{"creation_task_id":"<creation task_id>","scope":"single","targets":[{"entity_path":"pid:12.3"}],"changes":{"width_mm":900}}}}
```

```json
{"tool":"start_agent_task","arguments":{"intent":"verify_model","instruction":"复核单实例参数修改后的冻结质量要求。","idempotency_key":"cabinet-single-verify-v1","inputs":{"runtime":"queue","creation_task_id":"<creation task_id>","parameter_task_id":"<modify_design_parameters task_id>"}}}
```

如果你要保持同伴定义一致，或切换到 all，`scope` 改为 `all` 并把 `targets` 列为全部共享实例；缺失任一同伴会被拒绝。验收后的 `verify_model` 若返回 `quality_accepted=false`，先按其 `next_action` 再提交同一 verify 任务的 `reverify:true`，或由同一 `submit_agent_task_input` 提供新鲜连接重试，不要新开任务。

日常流程里，`modify_design_parameters -> verify_model` 且 `deliver_model` 成功后可直接收口；不要把保存-重开-再验作为默认闭环。关闭重开验收只在用户明确要求“持久化与重开恢复”时执行。

当前版本仍未将以下项自动视为验收完成（仍保留 `quality_accepted=false`）：

- `modify_design_parameters` 的 `geometry_applied` 通过仅表示替换生效，不等于近景、外观或文件生命周期验收。
- 重开与保存后的参数继续修改需用 `inputs.saved_delivery_task_id` 明确绑定，不会自动从原参数任务回填参数源。
- 所有 PBR/HDR、冷重开和多模型常规可视化验收仍由原生重开/快照外的实机路径补齐。
