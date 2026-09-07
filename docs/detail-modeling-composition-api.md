# Agent 设计组合与本地家具资产

`compose-design.mjs` 执行明确的设计计划：Agent 决定摆放、尺寸、材料和取景，模块负责检查与编译。它不会根据场景名称选用一段预制 DSL，也不会自行决定一个生活区或前场方案。

## 家具资产接口

`buildFurnishingAsset(kind, { id, parameters })` 位于 `src/detailed-modeling/furnishing-assets.mjs`，返回 `parts`、`root_id`、`root`、`materials`、`requirements`、参数、来源、许可与配方哈希。四类 `kind` 为：

| kind | 主要参数，单位 mm | 几何构成 |
| --- | --- | --- |
| reading_chair | width、depth、seat_height、back_height | 复用四条倾斜木腿、框架、112 mm 厚曲面座垫、倾斜靠垫、两道真实包边和扶手 |
| side_table | radius、height | 分离底板、内嵌桌面、带孔边缘、复用三条桌腿、带安装孔的固定板及紧固件 |
| pendant_light | radius、shade_height、drop | 3 mm 厚开放灯罩、环形收边、支撑杆、灯泡、灯座、吊线、顶盘和出线孔 |
| potted_plant | height、pot_height、pot_radius | 12 mm 厚空心盆壁、底部排水孔、土面、枝干、复用两种有 1.2 mm 厚度的曲面叶片与叶脉 |

`buildFurnishingAssetBundle({ kind, id, parameters, origin })` 返回完整 `dsl`、`part_graph`、`profile`、`parts_mapping`、`detail_spec` 和 `views`。材料必须使用返回的声明；除既有 17 色之外，明确新增 `Detail_Fabric`。这些构件是项目自行编写的构造资产，没有下载或采购外部模型。

家具的存在不自动意味着真实 SKP 资产已经入库。原生构建、导出、文件哈希、局部视图和 SKP 重新导入均需另行验证，再登记到本地 catalog。

## 组合计划接口

`composeDesign(baseBundle, compositionPlan)` 要求基准包含 PartGraph v2；单独提供旧 DSL 会被拒绝。`compositionPlan` 可为对象或 JSON 字符串，结构包括：

- `version: 1`、`id`、`brief`：方案身份和 Agent 的设计判断。
- `additions`：家具可写 `asset_kind: "reading_chair"`，既有配方可写 `family: "wall_junction"`；也支持明确的 `family: "furnishing" | "recipe"` 配合 `asset_kind`。每项需有 `id`、参数及非空 `instances`。
- `instances`：每个放置有 `id`、`origin` 与可选 `transform`。支持平移、Z 轴旋转，以及既有 `mirror: "x" | "y" | "z"` 或不重复轴数组格式（不支持 `{axis:...}` 对象格式）。构造顺序为局部镜像负比例→Z 旋转→原点与平移；根和嵌套引用使用同一个原生组件放置方法，叶子路径与空腔局部尺寸保持不变。其他变换应使用真实 shape 坐标表达，不能静默丢弃。
- `explicit_parts`：每项提供独立 `id`、`role`、`material`、`shape.primitive` 与 `shape.parameters`。可给多个 `instances`；未给时以零根变换保留 shape 中已经明确的坐标。
- `materials`：新增材料声明。基准材料优先于配方默认色；显式材料声明若与既有同名定义不同则拒绝，要求采用不同名称。
- `views`：计划必须明确给出相机。计划视图排在前面，基准的局部近景继续保留。不会继承已经不适合新组合的旧整体取景。
- `required_voids`：明确编写的空腔或通道要求，追加到基准要求之后。每项保留完整 `instance_path`、局部 `bounds_mm`、`search_scope` 与可选 `boundary_checks`；同名、未知实例、无效尺寸或任意排除路径会被拒绝，不能覆盖或删去基准要求。

构件返回的 `required_voids` 必须以其 `root_id` 作为路径首元素。组合器为每个放置实例展开这些要求，把首元素替换为该实例 ID，并把要求 ID 改为 `实例ID:原要求ID`。局部坐标不预先旋转或平移；原生检查根据真实实例变换解释这些坐标。重复放置的两个实例各自验收，不能共用一次通过结果。组合时使用质量门的字段校验；任务开始后仍由服务端独立冻结规格，编译本身不是实机证据。

返回值含重新编译的 DSL、PartGraph、材料 profile、逐实例细节规格、部件映射、相机、`brief`、完整 `composition_plan` 和计数报告。所有新增叶子实例重新生成细节要求；同一共享定义的两个实例不能由其中一个替代验收。

`saveComposedDesign(bundle, outputDirectory)` 只写入尚不存在的目录，保存 DSL、图、材料、细节规格、视图、映射、brief 和原设计计划。目录已存在会失败，不覆盖之前的审核或实机产物。

## 本轮的具体 Agent 输入

`examples/detailed-modeling/agent-compositions/kitchen-living-plan.json` 在精细厨房右侧增加生活区，明确两把共享阅读椅、边桌、双吊灯、盆栽、延伸墙面和地板。

`examples/detailed-modeling/agent-compositions/entry-court-plan.json` 增加前场铺装、平台支撑、三级踏步、踏面、路缘和重复花盆。组合模块读取这些具体参数，测试验证实际几何变化、共享实例、基准保护与局部视图保留。

上述内容只证明设计输入与编译执行的关系。空间使用效果、结构合理性、净空、排水连通、材质表现与最终局部细节仍需 Agent 在 SketchUp 中检查和修改。
