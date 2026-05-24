# SketchUp 官方 Cloud MCP / 本地 Replica 功能差距总结

更新时间：2026-05-14

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
| 建筑 helper | 官方可用 Python 自建 | 已做高层 DSL：level、floor_slab、wall、door、window、stairs、railing、gable_roof、shed_roof |
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
- `examples/text-3d-slice.json`：真实字体轮廓 capability slice，覆盖顶层与 component_definition 内嵌 `text_3d`。
- `npm test` 会读取 golden examples 和主线 capability slices，只用 mock runtime 验证，不依赖打开 SketchUp。
- 主线基线还会校验 `get_docs` 输出的 capability manifest 矩阵、snapshot 中的 runtime capability descriptor、queue 插件握手 descriptor 注入、schema/component-scope contract、descriptor 漂移时的结构化 compatibility issue、带 top issues / recommendations / budget 检查的 snapshot diff report，以及 `compare_model` 一键 mock/queue 对照骨架。

最近一次验证：

- text_3d：live SketchUp Bridge 已加载 `queue-plugin-0.1.0-text-3d.1` / manifest `2026-05-phase4-text-3d-slice`，compatibility `ok`，issues 为空；`examples/text-3d-slice.json` queue 构建成功，主文字 snapshot 为 `kind: text_3d`、153 faces / 423 edges、warnings 0；`npm run qa:queue` 9 个默认样例 pass，`npm run qa:budget:queue` 4 个预算样例 pass。
- runtime module split：Ruby queue runtime 和 JS mock runtime 已完成主边界/operation-family 边界拆分；当前 contract 输出 manifest/mock/Ruby dispatch 均为 `64`，component_definition registry/dispatch 均为 `42`。
- transform matrix decomposition：live SketchUp Bridge 已加载 `queue-plugin-0.1.0-transform-matrix-decomposition.1` / manifest `2026-05-phase2-matrix-decomposition-slice`，compatibility `ok`，issues 为空；mock `matrix` / `local_matrix` snapshot 和 Ruby queue transform metadata 均包含 translation、basis axes、scale、shear、determinant 和 mirrored 分解字段；`examples/transform-local-matrix.json` queue 单例 diff 0，`npm run qa:queue` 9 个默认样例 pass。
- performance budget：`npm run qa:budget:mock` / `npm run qa:budget:queue` 已覆盖 architecture/product/structured/appearance 四个发布样例；queue 真实 SKP size 当前均低于 5MB 阈值。
- release packaging：`npm run plugin:check` / `npm run plugin:install` / `npm run plugin:package` 已固化 Ruby 插件文件清单、安装检查和 `.rbz` 打包入口。
- registry/runtime contract：Ruby `operation_registry.rb` 由 `src/capabilities.mjs` 生成，`registry:check` 已纳入测试和插件检查；Node queue runtime 通过 lock 文件串行化同一个 SketchUp file queue。
- golden architecture：39 groups / 447 faces / 819 edges / 216 vertices / 2 scenes / 2 levels。
- golden product：7 groups / 16 instances / 1088 faces / 1730 edges / 400 vertices / 4 component definitions / 2 scenes。
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

- 更复杂的 transform 分解仍需继续补（例如 Euler/非仿射报告与 live queue 对照细化）；当前 `transform_object` 已支持 translate、rotateX/Y/Z、模型空间 `axis + angle`、本地轴 `local_axis + local_angle`、SketchUp-compatible 16-number `matrix`、本地坐标系 `local_matrix`、scale、mirror，以及默认 origin / 对象中心 / 显式坐标 pivot，并已为 matrix/local_matrix snapshot 增加 translation、basis axes、scale、shear、determinant 和 mirrored 分解元数据。
- 更完整的 sweep / frame 控制；当前 `pipe_between_points` 已支持任意 3D 点管线，旧 `swept_path` 仍偏 MVP，主要适合沿 X 的管线。
- 非轴向墙、坡地、多层复杂楼梯、可参数化窗门族库。
- 任意选边 CAD fillet/chamfer（当前 `fillet` / `chamfer` 已进入第二阶段产品 DSL 基线，但稳定 slice 只处理盒体/面板 XY footprint 的垂直边圆角与倒角）。
- 更通用的 profile/surface 建模；`face_with_holes` / `profile_extrude` 已进入简单闭合多边形 outer + holes 第一切片，并覆盖凹多边形、多洞和竖向 profile 的 mock/queue 对照；`loft_between_profiles` 与 `shell_from_front_side_profiles` 已进入第二阶段产品壳体/握把基线，但更复杂曲面和自动修复仍需继续补。
- 任意 solid boolean、真实 cylinder wrap/projection（当前 `boolean_cutout` 已有矩形板 + 矩形贯穿孔安全 slice；`face_on_cylinder`、`recess` / `slot` / `screw_hole` 已有视觉贴片、凹槽、长圆槽与孔位标记）。
- 真实字体轮廓 text emboss/engrave 的 boolean 贴合仍待后续；当前新增 `text_3d` 已能在 queue runtime 通过 SketchUp `Entities#add_3d_text` 生成独立真实字体轮廓，`text_emboss` / `text_engrave` 仍是确定性的简化文字块视觉标记。
- 真正的 solid boolean / manifold 检查 / 自动修复。

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

- `projects/image-structured-modeler/` 已定义方向、schema 和 Switch 手柄 model plan 示例。
- 还没有实现自动图像校正、轮廓提取、关键点识别、overlay review、plan-to-DSL 编译器。

## 发布稿建议结论

可以这样概括：

> 官方 SketchUp Connector 的本质是一个云端 SketchUp MCP：模型在云端 session 里，用受限 Python SDK 构建并保存 `.skp`。这个项目没有复刻云端 Python SDK 本身，而是把体验拆成本地可控链路：自然语言 → 安全 JSON DSL → mock snapshot 快速 QA → SketchUp Ruby queue runtime 生成真实 `.skp`。它牺牲了任意 Python API 的表达力，换来更高的安全性、可测试性和可回归性。

更短的版本：

> 已做到：核心 MCP 工具闭环、安全 DSL、真实 `.skp` 本地输出、snapshot QA、材质/PBR、建筑 helper、产品 golden examples。没做到：官方云端认证/session/download、完整 Python SDK 命名空间、完整 SketchUp API、通用几何/布尔/倒角、图像到结构化模型自动化。
