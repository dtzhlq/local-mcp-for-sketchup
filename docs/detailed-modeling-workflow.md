# 主 MCP 精细建模工作流

本轮沿用四个 Gateway。创建执行成功后继续读取真实几何、局部视图与冻结规范，质量通过才结束创建任务。本文记录新接口的使用方法；实际验收状态见 `detail-modeling-implementation-checklist.md`。

## 创建与局部修正

`start_agent_task` 的 `inputs.detail_spec` 使用 version 1，冻结内容包括：

- `required_parts`：每个叶子实例的完整 `instance_path`、尺寸、材质、可见性、最少面数和真实几何检查；共享定义的每个实例分别检查。
- `required_voids`：必须保持净空的局部空间，以及需要真实实体支撑的边界。按冻结路径查询原生三角面和闭合实体，不能传客户端快照来获得通过。
- `required_views`：视图 id、尺寸、目标部件及近景类型；绑定实例的相机可稳定重拍。
- `resource_budget`：`max_faces`、`max_edges`、`max_vertices`。原生 `resource_totals` 统计隐藏几何、裸几何和闲置定义；共享定义只计一次，实例展开成本另报。资源数量不计为细节成绩。

创建范围中的定义、材质和对象由服务端分配名称。原生事务开始前再检查命名资源确实不存在，包括没有放置实例的闲置定义和材质。事务失败回滚；既有命名资源不被覆盖。

结果分别记录执行状态和 `quality_status`。质量失败、检查异常或证据缺失保留未完成项；`submit_agent_task_input` 使用单数 `input` 提交局部创建代码或 `reverify`。恢复、重试和重新检查读取已保存操作记录，不重放原模型。初次构造不占自动修正次数；每个失败部件最多连续三轮自动修正。冻结规范不能通过删除要求、升高预算或传入自称通过的记录来更改。

事务提交后的已有对象修改进入现有编辑计划、授权及回执路径。装配参数修改创建新版定义，只替换明确选中的根实例；通过受信回执重新绑定原冻结部件路径。单实例和全部关联实例是不同范围；检测到人工修改需要协调。

## 空腔与洞口

`inspect_detail_regions` 是只读操作。每条 query 包含 `id`、`instance_path`、`bounds_mm.min/max`、`search_scope` 和可选 `boundary_checks`。

坐标属于锚点实例的局部坐标系。`assembly` 检查指定宿主的完整子树，适合安装了窗或门的宿主墙洞；`scene` 检查整个场景在该局部空间中的真实几何，适合柜腔、水槽和排水孔。接口不接受排除对象名单。

`boundary_checks` 的 `side` 为 min/max x/y/z，`offset_mm` 从净空指定侧向外移动。检查该处整片薄截面位于实际闭合实体内，不能只凭一个中心点证明整段门框或盆底。墙体各构造层分别检查进深，另外检查完整洞深是否贯通。接触板外缘的门洞是缺口，不能要求或冒充内部孔环。

构件配方的 `required_voids` 以配方根为路径起点。组合器按每个实际放置根展开路径和唯一 id。构件及场景的 v2 规范覆盖全部叶子实例；旧 `detail-spec.json` 和历史任务保持原样。

## 局部视图与外观

`capture_detail_views` 默认保持原有当前视图语义，返回每张原生图像、相机、版本、尺寸及恢复结果。指定 `scene_ref` 时才执行受控场景切换：要求存在原选中场景，关闭过渡后捕获，最后恢复场景、相机、环境、风格、显示选项、阴影、可见性与模型轴，并记录修改状态变化。无法完整恢复的二点透视或 PhotoMatch 相机明确拒绝。

原生 PBR 使用各通道开关和 getter。normal/AO 先载入贴图再启用，零值保留；不支持的字段记录明确结果。`texture_transform` 使用实际面 UV，支持平面和盒状映射、毫米尺寸、方向、重复与前后面选择。

HDR/EXR 使用原生 environment 导入、更新和激活操作。各场景绑定独立环境对象及真实 `.style`；Photoreal 必须从实机风格取得并核对画面，不能由未验证字段推断。`scripts/run-detail-appearance-live.mjs` 保留预览、应用、捕获、保存重开的完整证据与源文件哈希。

## 输入与验收产物

- `src/detailed-modeling/sample-matrix.mjs`：八类构件的基准、尺寸变化、镜像旋转嵌套样片输入。它们是测试夹具，不是 Agent 通用建模能力证明。
- `examples/detailed-modeling/agent-compositions/`：厨房生活区及入口前场的明确设计输入、放置决策和近景。组合器将其编译为 PartGraph；实际构造、缺陷修正与保存重开仍需 MCP 执行并保留回执。
- `query_assets`：八类构件加四类家具灯具资产，或指定本地目录清单。外部清单中的来源与哈希只能保持记录关联，不能自行认证原生几何；返回 `recorded_evidence_matches_file` 与未验证状态。

几何验收保留中性显示近景和剖视；材质环境验收单独保存。两套最终 SKP、变化任务、原生外观及保存重开全部通过前，本轮不标为完成。

## Scoped geometry inspection

Detailed-modeling extension: read-only `adopt_open_model` supports explicit `recursive_roots` (maximum 32 top-level pid paths), reporting partial-scene scope separately from requested-root completeness. `inspect_detail_regions` supports `coordinate_space: model` for conservative separation checks inside a measured pairwise intersection box; the original default remains `anchor_local`. These reads never authorize an existing-model mutation.

`inspect_detail_regions` also accepts `mode: pair_separation` with two distinct explicit assembly paths (`instance_path`, `comparison_instance_path`). Native leaf bounds prune pairs; triangle clipping and closed-solid containment establish absence of interior overlap. Boundary contacts use a fixed 0.000001 mm numerical tolerance. Open/ambiguous geometry and potential penetration stay unverified. Readback binds both paths, full model revision, method and coverage counts; no metadata contact label grants a pass.
