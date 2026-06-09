# SketchUp 官方 Cloud MCP / 本地 Replica 功能差距总结

更新时间：2026-05-27

本文用于发布稿事实核对。结论先行：本项目已经复刻了官方 SketchUp Cloud MCP 的核心交互闭环（`get_docs` / `build_model` / snapshot / `save_model`），但它不是官方云端 Python SDK 的完整替代品。本项目定位是：用更安全、可测试的 JSON DSL，在本地 mock runtime 和 SketchUp queue runtime 中复现主要建模体验。

## 术语边界

### 推荐说法

- **官方能力**：Claude 官方 SketchUp Connector 暴露的是 Cloud SketchUp MCP server。
- **官方建模接口**：`build_model` 在云端模型 session 里执行受限 Python 建模代码。
- **官方保存接口**：`save_model` 保存云端 session 并返回 `.skp` 下载链接。
- **本项目能力**：本地安全 JSON DSL replica，提供 Node bridge、stdio MCP server、mock runtime、SketchUp Ruby queue plugin。
- **本项目保存接口**：本地 `mock` 保存 JSON artifact，`queue` 保存真实本地 `.skp` 文件路径。
- **本项目单位**：JSON DSL 对用户暴露统一使用 mm；SketchUp 插件内部再换算。
- **官方单位**：官方 Python SDK 文档约束里使用 inches。

### 避免说法

- 不要说“官方 Connector 控制本地 SketchUp 桌面版”。它是 Cloud SketchUp MCP server。
- 不要说“我们已经实现官方 SDK”。准确说法是“复刻核心 MCP 工具体验，并覆盖一批安全 DSL 能力”。
- 不要说“我们支持任意 Python / Ruby / JS 建模”。本项目故意只接受 JSON DSL。
- 不要把 `mock` runtime 的 snapshot 当成真实 SketchUp 几何证明；真实 `.skp` 需要 `queue` runtime + SketchUp 插件验证。
- 不要把官方 `save_model` 的下载 URL 和本项目 `file_path` 混为一谈。

## 已经对齐或增强的能力

| 能力 | 官方 Cloud MCP | 本项目状态 |
|---|---|---|
| `get_docs` | 返回 Python SDK 文档 | 已实现，返回本地 JSON DSL 文档 |
| `build_model` | 执行受限 Python 建模代码 | 已实现，但只接受安全 JSON DSL |
| `save_model` | 返回 `.skp` 下载 URL | 已实现，本地返回 `file_path` 和 `file_size_bytes` |
| session | 云端模型 session，可多次 build | mock/queue runtime 都支持连续 build，`reset_model` 可显式清空 |
| snapshot | totals / groups / materials / bounding_box | 已实现，并增强 `warnings`、`warning_summary`、`vertices`、`resolution_hint` |
| 材质 | solid color，官方环境无内置 `.skm` | 支持 color、alpha、texture、SketchUp 2025+ PBR 字段记录/应用；`texture_transform`、`uv_project_planar`、`uv_project_box` 和 `image_plane` 已有第一切片 |
| 基础几何 | Python 中用 GeometryInput/Group 等构建 | JSON DSL 支持 box、prism、mesh、panel_with_openings、cylinder |
| 曲面 helper | 官方文档给出 loft/sweep/dome/bowed 等 Python pattern | 已做 JSON DSL：`lofted_solid`、`swept_path`、`domed_surface`、`bowed_panel` |
| 建筑 helper | 官方可用 Python 自建 | 已做高层 DSL：level、floor_slab、footprint_slab、wall、wall_path、curved_wall、roof_footprint、hip_roof、parapet_path、curtain_wall、column_grid、path_surface、terrain_mesh、parking_stall_array、door、window、stairs、railing、gable_roof、shed_roof |
| 组件复用 | ComponentDefinition / ComponentInstance | 已支持 `component_definition` / `component_instance` |
| 相机与场景 | Camera / Scene | 已支持 `camera` / `scene` |
| 表现层 | Style / RenderingOption / ShadowInfo | 已支持 style、shadow、rendering_options 的常用子集 |
| QA | snapshot 暴露异常信号 | 已增强结构化 warning、体积报告、golden examples 回归 |
| 能力基线 | 官方文档由云端 SDK 能力决定 | `src/capabilities.mjs` 已收敛为单一 operation registry，`get_docs` 支持矩阵、runtime `operation_support`、schema、component-scope 和 contract tests 都从这里派生；queue runtime 通过插件 `get_capabilities` 握手回传插件版本、SketchUp 版本、Ruby 版本和 operation 支持状态，并用 `runtime.compatibility` 标记 manifest/插件漂移 |

## 本项目已经验证的回归样例

- `examples/golden-architecture.json`：建筑向 golden regression，覆盖 level、slab、wall/openings、door/window、stairs、railing、gable/shed roof、scene、style/shadow/rendering。
- `examples/golden-product.json`：产品/工业设计向 golden regression，覆盖 component reuse、mesh shell、domed/bowed surfaces、lofted_solid、swept_path、cylinder、transform、resolution hints。
- `examples/structured-product-helpers.json`：结构化产品 helper capability slice，覆盖 `slot_array`、`rib`、`standoff_boss`，避免继续把所有新能力塞进 product golden。
- `examples/editing-transform-profile.json`：阶段 2 P0 capability slice，覆盖对象二次编辑、通用变换、对象中心 pivot、模型空间任意轴旋转、本地轴旋转、4x4 matrix、受控带洞 profile。
- `examples/component-transform-composition.json`：component instance transform composition slice，覆盖组件实例上的模型轴、本地轴和 matrix 编辑组合。
- `examples/transform-chain-regression.json`：连续 `transform_object` regression slice，覆盖 group 和 component instance 上的 center pivot、本地轴、模型轴、平移和 matrix 叠加。
- `examples/metadata-organization-slice.json`：阶段 4 组织/元数据 capability slice，覆盖 `tag`、`assign_tag`、`attribute`、`classification`。
- `examples/profile-edge-cases.json`：通用 profile regression slice，覆盖凹多边形 outer、多洞、`xz` 竖向 face profile 和 component_definition 内嵌 profile。
- `examples/appearance-texture-slice.json`：表现层 regression slice，覆盖 `texture_transform`、`uv_project_planar`、`uv_project_box`、顶层 `image_plane` 和 component_definition 内嵌 `image_plane`。
- `examples/text-3d-slice.json`：真实字体轮廓 capability slice，覆盖顶层与 component_definition 内嵌 `text_3d`，以及 font-outline `text_emboss` / `text_engrave` marker。
- `examples/feature-editing-slice.json`：阶段 7 主线 feature slice，覆盖 `target_id + face` 的 `cut_hole`、`cut_slot`、`cut_recess`、`add_boss`、`add_raised_rib`。
- `examples/boolean-manifold-slice.json`：阶段 7 CAD boolean/manifold slice，覆盖 `boolean_difference` -> `boolean_union` -> `boolean_intersect` -> `manifold_check` -> `manifold_repair`。
- `examples/building-geometry-slice.json`：建筑几何 mock-first slice，覆盖 `footprint_slab`、非轴向 `wall`、`wall_path`、既有 roof helper 和 axis-aligned wall openings 兼容。
- `examples/building-geometry-r2-aggressive.json`：建筑几何 R2 aggressive slice，覆盖带洞 footprint/site slab、斜墙/折线墙 openings、曲墙、幕墙、柱网、任意 footprint roof、hip roof、女儿墙、道路、terrain 和停车位尺度锚点。
- `examples/expert-parametric-fixture.js`：Expert Mode v1 参数化 fixture，覆盖受限脚本编译为 JSON DSL、组件阵列、seeded random、`vec` helper 和 `text_3d`。
- `npm test` 会读取 golden examples、主线 capability slices 和 Expert Mode fixture，只用 mock runtime 验证，不依赖打开 SketchUp。
- 主线基线还会校验 `get_docs` 输出的 capability manifest 矩阵、snapshot 中的 runtime capability descriptor、queue 插件握手 descriptor 注入、schema/component-scope contract、descriptor 漂移时的结构化 compatibility issue、带 top issues / recommendations / budget 检查的 snapshot diff report、`compare_model` 一键 mock/queue 对照骨架、stdio MCP server 的 `tools/list` / `tools/call` Expert Mode 路径，以及 `qa:expert:*` 的 Expert 编译/runtime/artifact/budget 发布回归。

最近一次验证：

- mainline phase7 boolean/manifold slice：manifest 已推进到 `2026-05-phase7-boolean-manifold` / capability `0.1.0-capabilities.5` / plugin `queue-plugin-0.1.0-phase7-boolean-manifold.3`；已通过 `node --check`、`ruby -c`、`npm test`、`npm run registry:check`、`npm run plugin:check`、`npm run qa:mock`、`npm run qa:expert:mock`、`npm run qa:budget:mock`、`npm run test:image-structured`、`git diff --check`、`npm run plugin:install`、`npm run plugin:package`、mock boolean slice 构建、live queue capability handshake、boolean mock-vs-queue 单例和救护车 queue 重跑。contract 输出 manifest/mock/Ruby dispatch 均为 `74`，component_definition registry/dispatch 均为 `42`。live `examples/boolean-manifold-slice.json` queue 单例在 solid boolean tolerance 下 Verdict `pass` / Total Diffs `0`；救护车重跑 queue layout QA Verdict `pass` / issues `0`，roof service panel boolean 结果为完整 bbox `420 x 330 x 26 mm` 且 manifold `ok`。
- mainline building geometry R2 aggressive slice：manifest 推进到 `2026-06-building-geometry-r2-aggressive` / capability `0.1.0-capabilities.7` / plugin `queue-plugin-0.1.0-building-geometry-r2.1`；当前主线新增/扩展带洞 footprint slab、非轴向 wall openings、wall_path openings、curved_wall、roof_footprint、hip_roof、parapet_path、curtain_wall、column_grid、path_surface、terrain_mesh 和 parking_stall_array。mock 与 Ruby dispatch / component_definition dispatch 已接入，contract 输出 `85 / 85 / 85` 和 `53 / 53`；已通过 `npm test`、`npm run qa:mock`、`npm run plugin:check`、`npm run plugin:install`、aggressive mock build、live queue capability/build/save 和 `git diff --check`。queue `examples/building-geometry-r2-aggressive.json` snapshot 为 12 groups / 411 faces / 772 edges / 422 vertices / warnings 0，并保存 `output/building-geometry-r2-aggressive.skp`（190,893 bytes）。queue 对部分场地/幕墙 helper 仍按 partial/minimal contract 处理，不声明所有拓扑与 mock 完全同构。
- mainline building geometry R3 quality slice：manifest 推进到 `2026-06-building-geometry-r3-quality` / capability `0.1.0-capabilities.8`。operation 数保持 `85`；`curtain_wall` 从最小墙带升级为 module grid，支持 `row_count`、`panel_thickness`、vertical mullions、horizontal rails 和 panel cells，mock/Ruby queue contract 均标记为 supported。
- mainline phase7 feature slice：manifest 已推进到 `2026-05-phase7-feature-slice` / capability `0.1.0-capabilities.4` / plugin `queue-plugin-0.1.0-phase7-feature-slice.1`；已通过 `npm test`、`npm run qa:mock`、`npm run qa:expert:mock`、`npm run qa:budget:mock`、`npm run plugin:check`、`npm run plugin:install`、`npm run plugin:package`、mock capability handshake、live queue capability handshake 和 feature mock-vs-queue 对照。live queue 回报 SketchUp `26.2.242`，compatibility `ok`，issues 为空；feature queue 对照 `OK: true`，仅余 SketchUp pushpull 拓扑计数 warning。
- image-structured feature mapping slice：compact remote 已把 `blind_recess` / `convex` 编译为 `cut_recess` / `add_boss` / `add_raised_rib`，并通过 `manual-corrections.feature-regression.json` 验证 visual fallback 可切到真实 `cut_recess`。live queue snapshot/diff 已刷新：compact remote queue snapshot 为 3 groups / 369 faces / 1035 edges / 690 vertices / 2 scenes，SKP `182920` bytes，warning gate pass；Switch queue snapshot 为 24 groups / 4 instances / 1776 faces / 2964 edges / 1244 vertices / 2 scenes，SKP `254234` bytes，warning gate pass。
- image-structured semantic fusion / corrections workbench slice：`model-plan.review.semantic_fusion` 已记录 per-part status、decision、confidence、semantic evidence、feature mapping signals 和 review flags；review HTML 已新增 Semantic Fusion 与 Corrections Workbench，可选择建议 patch、编辑、校验、复制和下载 corrections JSON。当前剩余发布阻塞集中在把主线 CAD boolean/manifold 用到更多产品样例复验。
- release acceptance 基线：最近一次 live SketchUp Bridge 记录为 `queue-plugin-0.1.0-phase5-closeout.1` / manifest `2026-05-phase5-closeout-slice` / capability `0.1.0-capabilities.3`，compatibility `ok`，issues 为空；当时 `npm run plugin:check`、`npm test`、`npm run qa:mock`、`npm run qa:expert:mock`、`npm run qa:budget:mock`、`npm run qa:queue`、`npm run qa:expert:queue`、`npm run qa:budget:queue` 和 `git diff --check` 均通过。
- queue QA：最新 `npm run qa:queue` 10 个默认样例均 `OK: true`，聚合 `review` 来自既有 mock/queue 拓扑差异 warning；`npm run qa:expert:queue` pass；`npm run qa:budget:queue` 4 个发布预算样例 pass，真实 SKP artifact 均低于 5MB 阈值。
- Expert Mode v1：`src/expert-compiler.mjs` 使用 AST 白名单解释器把受限脚本编译成标准 JSON DSL，再复用现有 runtime；`test/expert-compiler.mjs` 覆盖拒绝 `require`、超 loop/operation limit、缺 required field、component 内非法 op 和 `while`。`qa:expert:mock` / `qa:expert:queue` 已接入并通过 Expert 发布回归；queue snapshot 为 19 compiled ops、739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances、warnings 0，SKP artifact 为 167582 bytes。
- runtime module split：Ruby queue runtime 和 JS mock runtime 已完成主边界/operation-family 边界拆分；当前 contract 输出 manifest/mock/Ruby dispatch 均为 `85`，component_definition registry/dispatch 均为 `53`。
- transform matrix decomposition：mock `matrix` / `local_matrix` snapshot 和 Ruby queue transform metadata 均包含 translation、basis axes、scale、shear、determinant、mirrored、affine/non-affine reasons、homogeneous perspective terms 和 Euler XYZ degrees；该能力已纳入 phase5 closeout 验收。
- performance budget：`npm run qa:budget:mock` / `npm run qa:budget:queue` 已覆盖 architecture/product/structured/appearance 四个发布样例；queue 真实 SKP size 当前均低于 5MB 阈值。
- release packaging：`npm run plugin:check` / `npm run plugin:install` / `npm run plugin:package` 已固化 Ruby 插件文件清单、安装检查和 `.rbz` 打包入口。
- registry/runtime contract：Ruby `operation_registry.rb` 由 `src/capabilities.mjs` 生成，`registry:check` 已纳入测试和插件检查；Node queue runtime 通过 lock 文件串行化同一个 SketchUp file queue。
- golden architecture：39 groups / 447 faces / 819 edges / 446 vertices，SKP artifact 213514 bytes。
- golden product：24 groups / 12 instances / 1528 faces / 2570 edges / 1118 vertices / 4 component definitions，SKP artifact 258040 bytes。
- `save_model` 会返回 `file_size_bytes`，snapshot 会注入 `artifact_size_bytes`。

## 还没做到的官方能力 / 明确差距

### 1. 云端 Connector 与认证体系

官方侧有云端 MCP endpoint、OAuth Authorization Code + PKCE、Dynamic Client Registration、Bearer token、Refresh token、云端 session 和 `.skp` 下载 URL。

本项目目前没有做：

- 官方 OAuth / DCR 认证流程。
- 云端 hosted MCP endpoint。
- 云端 session 管理与下载 URL。
- 多用户/多租户隔离。

当前替代方案是本地 Node bridge + stdio MCP server + queue runtime。

### 2. 完整 Python SDK 执行环境

官方 `build_model` 是“执行 Python code against the model”，并预加载很多对象：`model`、`SUPoint2D/3D`、`SUTransformation`、`SUColor`、`Face`、`Edge`、`Material`、`Layer`、`ArcCurve`、`Curve`、`Camera`、`Scene`、`Style`、`Texture`、`Image`、`ImageRep`、`GeometryInput`、`LoopInput`、`Group`、`ComponentDefinition`、`ComponentInstance`、各种 Rendering/Shadow enum 等。

本项目没有暴露这些 Python 类，也不支持：

- 任意 Python 代码片段。
- 用户自定义 helper function。
- 通过 `dir()` / `list(ro.keys())` 动态枚举 API。
- 设置 `result = {...}` 返回任意自定义 Python 数据。
- 直接使用 `GeometryInput` / `LoopInput` 构造任意带洞、多 loop 或复杂拓扑。

这是有意取舍：安全 JSON DSL 比官方 Python 环境表达力低，但更容易验证和限制。

### 3. 完整 SketchUp API 面

本项目只覆盖常用建模、材质、视图和表现层子集，还没有完整 SketchUp API：

- Layer / Tag 更完整管理；基础 Tags/Layers 第一切片已支持创建、赋值和 snapshot 回传。
- ArcCurve / Curve 原生曲线。
- Texture / Image / ImageRep 的完整贴图、嵌入图像、UV mapping 流程。
- 完整 Style API。
- 完整 RenderingOption / ShadowInfo key 枚举与版本差异处理。
- 文件版本枚举 `SUModelVersion` 与指定版本保存。
- scenes pages 的更完整字段；基础 Tags、attribute dictionaries 和 classification metadata 已有第一切片。

### 4. 几何能力仍缺不少

当前 JSON DSL 适合安全、可回归的结构化建模，但还不是通用 CAD/SketchUp 几何层。重要缺口：

- `transform_object` 已支持 translate、rotateX/Y/Z、模型空间 `axis + angle`、本地轴 `local_axis + local_angle`、SketchUp-compatible 16-number `matrix`、本地坐标系 `local_matrix`、scale、mirror，以及默认 origin / 对象中心 / 显式坐标 pivot；matrix/local_matrix snapshot 已包含 translation、basis axes、scale、shear、determinant、mirrored、affine/non-affine reasons、homogeneous perspective terms，并在纯正向旋转兼容时回传 Euler XYZ degrees。
- 更完整的 sweep / frame 控制；当前 `pipe_between_points` 已支持任意 3D 点管线，旧 `swept_path` 仍偏 MVP，主要适合沿 X 的管线。
- 非轴向墙、坡地、多层复杂楼梯、可参数化窗门族库。
- 任意选边 CAD fillet/chamfer（当前 `fillet` / `chamfer` 已进入第二阶段产品 DSL 基线，但稳定 slice 只处理盒体/面板 XY footprint 的垂直边圆角与倒角）。
- 更通用的 profile/surface 建模；`face_with_holes` / `profile_extrude` 已进入简单闭合多边形 outer + holes 第一切片，并覆盖凹多边形、多洞和竖向 profile 的 mock/queue 对照；`loft_between_profiles` 与 `shell_from_front_side_profiles` 已进入第二阶段产品壳体/握把基线，但更复杂曲面和自动修复仍需继续补。
- 更复杂的 cylinder wrap/projection（当前 `boolean_cutout` 已有矩形板 + 矩形贯穿孔安全 slice；`boolean_union` / `boolean_difference` / `boolean_intersect` 已支持顶层实体组 solid boolean；`face_on_cylinder`、`recess` / `slot` / `screw_hole` 仍是视觉贴片、凹槽、长圆槽与孔位标记）。
- `text_3d` 已能在 queue runtime 通过 SketchUp `Entities#add_3d_text` 生成独立真实字体轮廓；`text_emboss` / `text_engrave` 默认仍是确定性的简化文字块视觉标记，也可用 `mode: "font_outline"` / `outline: true` 走真实字体轮廓 marker。仍未做 solid boolean union/subtraction 贴合。
- Solid boolean / manifold 已有主线第一版：`manifold_check` 会回传对象级 report，`manifold_repair` 会执行基础 cleanup / seal-bbox 记录；后续仍需扩展到更复杂曲面、文字贴合和产品大样例。

### 5. QA 还需要更聪明

已做结构化 warning，但还没有做到“可发布级质量判断”：

- bbox overlap 还不能区分“预期接触/嵌入”和“真实碰撞”。
- queue runtime 的退化面、非平面、SketchUp fill 失败分类还不够细。
- 大模型已有第一版 face / vertex / SKP size budget 阈值和 `run-performance-budgets.mjs` 报告；后续还需要把阈值按发布目标和更大样例继续校准。
- mock snapshot 和真实 queue snapshot 已有自动 golden 对照报告；后续还需要更细的退化面、非平面、预期接触和性能 budget 分类。
- 曲面分辨率已有 `resolution_hint`，但还没有自动 LOD 建议。

### 6. 图片到结构化模型仍是上游子项目

本项目已经明确不走“点云/AI mesh 直接终局”，但图片理解还没有集成到主链路。

当前状态：

- `projects/image-structured-modeler/` 已有 Switch controller 和 compact remote 两条产品样例，覆盖 observations、manual corrections、model plan、DSL output、review report、mock snapshot、queue snapshot 和 warning budget。
- 已有 correction-driven regression：`manual-corrections.regression.json` 会验证人工修正进入 model plan 和 compiled DSL；`manual-corrections.feature-regression.json` 会验证 visual fallback 切到真实 feature op。
- 仍未并入主 MCP tool 链路；自动图像校正、轮廓提取、关键点识别、主线 CAD boolean/manifold 的产品样例复用和大样例复验仍属于后续 polish。

## 发布稿建议结论

可以这样概括：

> 官方 SketchUp Connector 的本质是一个云端 SketchUp MCP：模型在云端 session 里，用受限 Python SDK 构建并保存 `.skp`。这个项目没有复刻云端 Python SDK 本身，而是把体验拆成本地可控链路：自然语言 → 安全 JSON DSL → mock snapshot 快速 QA → SketchUp Ruby queue runtime 生成真实 `.skp`。它牺牲了任意 Python API 的表达力，换来更高的安全性、可测试性和可回归性。

更短的版本：

> 已做到：核心 MCP 工具闭环、安全 DSL、真实 `.skp` 本地输出、snapshot QA、材质/PBR、建筑 helper、产品 golden examples、主线 CAD boolean/manifold 第一版。没做到：官方云端认证/session/download、完整 Python SDK 命名空间、完整 SketchUp API、无限制 CAD kernel、图像到结构化模型自动化。
