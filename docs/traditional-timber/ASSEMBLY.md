# 通用中式装配入口（v0.4.2）

`traditional_assembly` 将柱网或路径、构件族、连接和参数编译为 PartGraph，再沿已有原子创建、来源持久化、审阅替换和读回流程执行。旧 `traditional_timber` 固定殿堂保留自己的规则和验收范围。当前证据见 [发布验收](../RELEASE_ACCEPTANCE.md)；示例见 [输入目录](../../examples/traditional-assembly/README.md)。

0.4.2 增加显式插删跨及原生接头表面间距检查；对应最终安装包与实机证据见 [0.4.2 发布验收](../RELEASE_ACCEPTANCE.md)。抽样表面间距不等于完整碰撞、无穿透或结构安全认证。

最小参考和自绘关系示意见 [参考说明](REFERENCES.md)。它们不为默认工程尺寸提供历史精度认证。

## 单根与共享实例

通过 `start_agent_task` 依次调用：

1. `intent: "discover"`，`inputs: {"topic":"tasks","kind":"traditional_assembly","detail":"parameters"}`，读取族、单位和约束。
2. `intent: "preflight_model"`，`inputs: {"task": <示例对象>}`，只编译、检查参数依赖及普通资源预算。
3. `intent: "discover"`，`inputs: {"topic":"connect","runtime":"queue","timeout_ms":120000}`，读取当前文档的新鲜连接。
4. `intent: "create_model"`，稳定 `idempotency_key`，`inputs` 包含同一 `task`、`runtime: "queue"`、返回的 `connection_task_id` 和 `timeout_ms: 120000`。

`task` 外层沿用 version/kind/id/units/parameters/placement（或 instances）。`assembly` 的结构由 [schema](../../schema/traditional-assembly-v1.schema.json) 限定：

```json
{
  "version": 1,
  "mode": "contemporary_chinese",
  "layout": {
    "kind": "path",
    "width_parameter": "width_mm",
    "segments": [{"id":"run","direction_deg":0,"bay_lengths_parameter":"bay_lengths_mm"}]
  },
  "assemblies": [
    {"id":"frame","family":"path_frame"},
    {"id":"roof","family":"roof_unit","parameters":{"type":"gable"}},
    {"id":"eave","family":"eave_unit"}
  ],
  "connections": [
    {"from":"frame.bearing","to":"roof.bearing","relation":"contact"},
    {"from":"roof.roof_surface","to":"eave.roof_surface","relation":"alignment"}
  ],
  "parameter_bindings": {
    "frame":{"column_height_mm":"column_height_mm"},
    "roof":{"rise_mm":"rise_mm","eave_projection_mm":"eave_mm"}
  },
  "representation":{"tile_detail":"surface"}
}
```

所有顶层参数必须实际用于布局、族绑定或显式几何引用；不会接受一组未使用的装饰参数。布局开间为正数数组，单跨最多 10000、总长最多 60000、宽深最多 12000 mm。路径为正交方向，相邻两段仅支持同标高、等宽的 90° 转角。单根只使用一个框架、屋顶和檐部求解器。

| 族 | 当前支持 |
| --- | --- |
| `frame_grid` / `path_frame` | 柱线、梁、檩与支承；转角节点柱坐标去重 |
| `roof_unit` | 双坡、单檐方攒尖、平顶；方攒尖需要明确的单跨方形四柱网格 |
| `eave_unit` | 同源屋面域中的椽、边檐和封檐 |
| `bracket_layer` | 无栱或简化工程承座；命名历史铺作须另有可定位来源 |
| `enclosure_opening` | 矩形/32 段近似圆的真实穿洞，可绑定柱间墙段 |
| `joinery_panel` | 普通格栅、两扇板门；门五金和雕花简化 |
| `rail_seat` / `site_piece` | 栏杆、坐凳、台基/步道、花池 |
| `explicit_geometry` | 有明确形状、坐标和可选端口的受限几何；不代替来源推断 |

普通预算为 50000 面 / 120000 边 / 90000 顶点，并沿用 100 操作及 200 叶实例门槛。预估按展开计算；实际资源按当前完整原生修订统计，包括模型内已存储的旧定义。组合超限时减少细节或规模。`surface` 为连续瓦垄，`light`/`detailed` 仍受同一预算。

## 参数依据与修改

`assembly.parameter_sources` 对每个参数记录 `documented`、`derived`、`selected` 或 `simplified`；本版默认构件尺寸为 [项目工程选择](../../data/traditional-timber/contemporary-chinese-v1.json)。照片和关系参考不产生绝对尺寸。`documented` 必须提供非空 `source_refs`；材份输入另声明 `unit: "fen"` 和明确 `fen_mm`，几何转换为 mm，角度与无量纲值保持各自单位。

创建来源保存输入计划、解析参数、参数/族依据、规则内容哈希、渲染版本和原生完整子树指纹。`discover` 的 `topic: "parameter_sources"` 返回原创建任务、实际根路径和支持的参数名。修改请求示例：

```json
{
  "runtime":"queue",
  "timeout_ms":120000,
  "parameter_edit":{
    "creation_task_id":"发现返回的原创建任务 ID",
    "scope":"single",
    "targets":[{"entity_path":"发现返回的实际根路径"}],
    "changes":{"bay_lengths_mm":[3000,3300,3000,3000]}
  }
}
```

用 `intent: "modify_design_parameters"` 和稳定幂等键提交。跟随返回的连接和执行动作；授权由服务端信任通道读取，客户端不提交批准凭证。替换选中根的新定义，保留其世界放置、旧定义、共享副本及范围外对象。手工修改、来源/规则/渲染版本漂移会拒绝覆盖。普通 `changes` 仍拒绝改变数组长度；插删跨使用下面的显式结构修改。

### 显式插入或删除一跨

在同一 `modify_design_parameters` 入口中，`parameter_edit.structure_change` 与 `changes` 互斥。索引从 0 开始，插入位置允许为原跨数（末端追加），删除位置必须是已有跨。例如在四跨直廊的第二跨之前插入一跨：

```json
{
  "runtime":"queue",
  "parameter_edit":{
    "creation_task_id":"发现返回的原创建任务 ID",
    "scope":"single",
    "targets":[{"entity_path":"发现返回的实际根路径"}],
    "structure_change":{"operation":"insert_bay","segment_id":"run","bay_index":1,"length_mm":3000}
  }
}
```

删除使用 `{"operation":"remove_bay","segment_id":"run","bay_index":1}`，不传 `length_mm`。`segment_id` 必须取自保存的计划；矩形柱网使用 `"grid"`。一次仅改一处，保留 1–16 跨；新增跨宽用 mm。原有连接、跨度、普通资源预算仍由完整重编译检查，执行继续使用原创建来源、新鲜修订、指定根替换、原审批和任务恢复机制。`scope:"single"` 保留其他共享实例，`scope:"all"` 仍要求显式列出全部同定义实例。

当前支持单一直线路径或矩形柱网，以及双坡/平顶。柱梁、屋顶、檐部和栏杆坐凳随布局重新求解；使用显式 `segment_id` / `bay_index` 的墙洞和门窗保留构件 ID，并将原跨索引迁移到新位置。删除有附属构件的跨会返回具体构件 ID，必须先明确处理附属构件。独立坐标放置的门窗、自定义几何/梁、参数绑定的跨索引、多段转角路径和方攒尖等暂不自动迁移。带 `scene_id` 的场景成员还需要外部连接迁移，当前明确拒绝；普通独立根或同定义共享实例不受此项限制。

`inputs.budgets` 可限制 `max_operations`、`max_affected_instances` 和 `recursive_limit`，不能超过服务端策略；预算会冻结并传给内部审阅任务。实际替换根数超限或递归读回不完整时，在暂存几何前拒绝。该参数修改入口不支持用 `max_faces` / `max_edges` 作为写入前硬上限，传入会明确拒绝；修改后仍须执行独立资源与几何质量验证。

规划产物附 `topology_migration`，列出旧→新跨索引、站点与柱实例 ID，以及保留的构件 ID 和迁移的绑定；生成序号不能作为跨结构修改永久不变的子实体身份。新来源保存完整计划和迁移记录，后续尺寸修改沿新跨数继续。原生修改回执只证明受控替换成功；新的质量核验逐根重编译各自当前来源，未修改的共享根保留自己的结构要求，并以实际根边界生成一张总览。新验证任务签名绑定来源、编辑哈希及新规格，原创建证据保持不变，不能把旧结构验收套到新结构。

用户已明确授权开发测试模型和本项目目录中的开发模型直接修改，无需逐次批准。服务端可配置 `executionPolicy.development_model_auto_approval`：必须有 `authorization_ref`、明确的 `allowed_model_keys`（尚未保存的测试文档）或 `allowed_roots`（项目内模型）、`allowed_risks` 和普通实例预算。默认关闭；普通任务输入和模型内容不能启用。命中范围的计划返回 `execution_mode: "development_authorized"`、`user_action_required: false`，不创建批准凭证或本地批准页。执行仍须新连接、相同文档/修订、完整范围核对和可信提交回执；允许保存时目标路径也必须在配置目录内。

CLI/MCP 启动环境可使用 `ALMA_SKETCHUP_DEVELOPMENT_MODEL_AUTO_APPROVAL=1`、`ALMA_SKETCHUP_DEVELOPMENT_AUTHORIZATION_REF`、`ALMA_SKETCHUP_DEVELOPMENT_MODEL_ROOTS`（系统路径分隔符）和/或 `ALMA_SKETCHUP_DEVELOPMENT_MODEL_KEYS`（逗号分隔）。风险及预算分别用 `ALMA_SKETCHUP_DEVELOPMENT_ALLOWED_RISKS`、`ALMA_SKETCHUP_DEVELOPMENT_MAX_AFFECTED_INSTANCES`；允许保存需 `ALMA_SKETCHUP_DEVELOPMENT_ALLOW_SAVE=1`。这些是用户授权后的服务器启动配置，不能通过任务的 `inputs` 注入；未配置时原审批策略继续有效。

若已暂存定义、尚未执行的原子任务需要接入这项授权，服务端只可重新准备同一子任务与同一组操作。它先验证原始来源指纹及材料，保留旧修订/计划哈希，写入签名恢复日志，再绑定当前完整修订；不会覆盖原始基线、重复暂存或重放结果未知的写入。已开始执行或已有提交回执的任务只走原恢复流程。

## 多个独立根的场景

`preflight_model` 和 `create_model` 接受 `inputs.scene_plan`：version=1、稳定 id、units=mm、1–8 个独立 `traditional_assembly` 根、显式世界连接和一张明确的总览相机。`c-courtyard.json` 是完整输入。预检仅传 `scene_plan`；创建传 `scene_plan`、显式 `runtime`、可选 `timeout_ms` 和外层稳定幂等键。

场景创建器按顺序为每个根创建独立公共任务，保存每个 `creation_task_id`、实际路径和原生参数基线。各子任务暂缓视图与整体质量接受；全部几何就绪后，公共 `verify_model` 汇总当前可信子来源、主要装配、真实洞口及资源，捕获一张场景总览。`mock_geometry_created` 只表示 mock 分派完成，`quality_accepted` 保持 false。原生 `quality_accepted` 还需检查图中可见关系和选定接头。

响应受限时从 `read_agent_artifact` 读取返回的分派记录。它的 `roots` 列出每个原创建任务；整个场景没有统一的原子全场更新承诺。`connections` 声明同标高、最大 2000 mm 的步道间隙或重合对齐；自动检查是坐标与已声明根的检查，路径是否实际落在步道几何中仍需原生核对。

创建失败或响应不确定时，`resume_agent_task` 使用原场景任务 ID，不创建新根、不换键重放。场景计划创建后不可改写。只修改目标根的原创建来源；成功修改后以新幂等键启动：

```json
{"intent":"verify_model","inputs":{"scene_id":"sample-c-courtyard","runtime":"queue","timeout_ms":120000}}
```

这样会冻结更新后的所有子来源；重放旧场景创建任务只返回旧记录，不能代替新核验。交付使用已接受的场景 `verification_task_id` 作为 `deliver_model` 的 `source_task_id`，附新连接；服务端生成唯一保存路径。修改后沿用旧证明会被来源哈希检查拒绝。保存为交付步骤，未安排关闭重开。

场景保存意图和回执同时签名记录每个根的原创建任务、来源哈希、参数修订和独立冻结规格。保存后的 `parameter_sources` 发现会列出各根的 `saved_source_continuations`、实际目标和 `saved_delivery_task_id`；已重新绑定一个根时，其余保存来源继续可见。继续修改仍须对确切交付文件、完整原生修订和原始子树指纹做预检；发现索引不等于关闭重开验收或重新建立几何基线。

来源较多时，短响应给出 `returned_source_count`、`returned_saved_source_count` 和 `full_result_artifact`，内联列表只是预览。通过公共 `read_agent_artifact` 按返回 offset 读到 EOF，取得所有原创建任务、完整目标和保存任务；不可把预览长度当作来源总数。

保存后第一次修改场景根之前，服务器在同一完整保存修订下读取所有成员，核对各根原始指纹，然后一次完成所有来源的文件身份续接。这样后续只修改一个根时，其余根仍可从原创建记录继续。此步只更新来源身份和索引，不暂存定义或改写模型；中途元数据写入失败由签名子检查点继续，全组完成记录持久化后才允许进入参数编辑。已完成的身份续接不会因后续合法局部修改而重放；选中根的手工或外部变化仍会阻止覆盖。

## 缺项、质量与恢复边界

双层、六角或歇山等缺少本版求解器的输入返回 `compilation_gap`、`execution_started:false`、`quality_accepted:false` 和需要明确接受的简化提案；不会自动生成替代形制。`song_informed` 模式仅保存用户提供的可定位参数依据，模式名称不产生历史精度认证。

`traditional-assembly-summary.v1` 要求完整原生修订、两层主要装配摘要、边界/路径/指纹、普通资源统计、真实洞口与受信任视图回执。编译器预期尺寸和同源连接不是原生距离量测；隐藏榫卯、结构容量、完整碰撞与任意屋顶拓扑没有得到认证。A/B/C 的限定接头、视觉结果和修改保护检查分别写入开发记录。

质量报告的 `connection_checks` 是声明连接的编译预期，`connection_evidence_level` 保持 `compiler_expected_coordinates`。新增 `native_joint_measurements` 只检查冻结规格选定的柱梁、梁檩、檩椽构件对，其独立的 `native_joint_evidence_level` 才表示这些抽样是否取得原生表面间距证据；缺失或不支持的量测保留 `unverified` / `unsupported`，不能升级全部声明连接。短响应的 `joint_summary` 汇总这组抽样及其证据等级，完整修订、规格哈希和逐项明细通过返回的制品句柄读取。表面距离在容差内只证明选定表面足够接近；距离为零仍可能相交，不证明无穿透、完整碰撞通过或承载能力。

提交后收尾失败继续同一任务和可信回执；结果未知先只读核对。没有可信回执时不自动重写，不自动删除队列锁。源码更新不等于当前已安装服务更新：先连接并检查实际 `assembly-merkle.v2` / 原子创建能力，再运行新入口。

若已有相机朝向组件的存储矩阵与当前视角不一致，新的截图前检查返回 `detail_capture_camera_facing_source_unsettled`；先处理当前视角/修订差异，再重新审阅或核验，不能以截图后的快照静默替换保护基线。此保护的源码/Ruby 夹具结果与当前已安装插件状态分别记录在开发记录中。
