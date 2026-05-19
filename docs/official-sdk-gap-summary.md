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
| 材质 | solid color，官方环境无内置 `.skm` | 支持 color、alpha、texture、SketchUp 2025+ PBR 字段记录/应用 |
| 基础几何 | Python 中用 GeometryInput/Group 等构建 | JSON DSL 支持 box、prism、mesh、panel_with_openings、cylinder |
| 曲面 helper | 官方文档给出 loft/sweep/dome/bowed 等 Python pattern | 已做 JSON DSL：`lofted_solid`、`swept_path`、`domed_surface`、`bowed_panel` |
| 建筑 helper | 官方可用 Python 自建 | 已做高层 DSL：level、floor_slab、wall、door、window、stairs、railing、gable_roof、shed_roof |
| 组件复用 | ComponentDefinition / ComponentInstance | 已支持 `component_definition` / `component_instance` |
| 相机与场景 | Camera / Scene | 已支持 `camera` / `scene` |
| 表现层 | Style / RenderingOption / ShadowInfo | 已支持 style、shadow、rendering_options 的常用子集 |
| QA | snapshot 暴露异常信号 | 已增强结构化 warning、体积报告、golden examples 回归 |
| 能力基线 | 官方文档由云端 SDK 能力决定 | 第一阶段新增 `src/capabilities.mjs` manifest，`get_docs` 可生成 mock/queue 支持矩阵，snapshot 附带 runtime capability descriptor；queue runtime 通过插件 `get_capabilities` 握手回传插件版本、SketchUp 版本、Ruby 版本和 operation 支持状态，并用 `runtime.compatibility` 标记 manifest/插件漂移 |

## 本项目已经验证的回归样例

- `examples/golden-architecture.json`：建筑向 golden regression，覆盖 level、slab、wall/openings、door/window、stairs、railing、gable/shed roof、scene、style/shadow/rendering。
- `examples/golden-product.json`：产品/工业设计向 golden regression，覆盖 component reuse、mesh shell、domed/bowed surfaces、lofted_solid、swept_path、cylinder、transform、resolution hints。
- `examples/structured-product-helpers.json`：结构化产品 helper capability slice，覆盖 `slot_array`、`rib`、`standoff_boss`，避免继续把所有新能力塞进 product golden。
- `examples/editing-transform-profile.json`：阶段 2 P0 capability slice，覆盖对象二次编辑、通用变换、对象中心 pivot、受控带洞 profile。
- `npm test` 会读取两个 golden examples，只用 mock runtime 验证，不依赖打开 SketchUp。
- 第一阶段基线还会校验 `get_docs` 输出的 capability manifest 矩阵、snapshot 中的 runtime capability descriptor、queue 插件握手 descriptor 注入、descriptor 漂移时的结构化 compatibility issue、带 top issues / recommendations / budget 检查的 snapshot diff report，以及 `compare_model` 一键 mock/queue 对照骨架。

最近一次验证：

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

- Layer / Tag 管理。
- ArcCurve / Curve 原生曲线。
- Texture / Image / ImageRep 的完整贴图、嵌入图像、UV mapping 流程。
- 完整 Style API。
- 完整 RenderingOption / ShadowInfo key 枚举与版本差异处理。
- 文件版本枚举 `SUModelVersion` 与指定版本保存。
- attributes / metadata / scenes pages 的更完整字段。

### 4. 几何能力仍缺不少

当前 JSON DSL 适合安全、可回归的结构化建模，但还不是通用 CAD/SketchUp 几何层。重要缺口：

- 通用 4x4 transform matrix、任意轴旋转与本地坐标轴编辑；当前 `transform_object` 已支持 translate、rotateX/Y/Z、scale、mirror，以及默认 origin / 对象中心 / 显式坐标 pivot。
- 更完整的 sweep / frame 控制；当前 `pipe_between_points` 已支持任意 3D 点管线，旧 `swept_path` 仍偏 MVP，主要适合沿 X 的管线。
- 非轴向墙、坡地、多层复杂楼梯、可参数化窗门族库。
- 任意选边 CAD fillet/chamfer（当前 `fillet` / `chamfer` 已进入第二阶段产品 DSL 基线，但稳定 slice 只处理盒体/面板 XY footprint 的垂直边圆角与倒角）。
- 更通用的 profile/surface 建模；`loft_between_profiles` 与 `shell_from_front_side_profiles` 已进入第二阶段产品壳体/握把基线，但前者要求各截面点数一致，后者生成对称壳体且需要视觉 QA 检查轮廓顺序/比例。
- 任意 solid boolean、真实 cylinder wrap/projection（当前 `boolean_cutout` 已有矩形板 + 矩形贯穿孔安全 slice；`face_on_cylinder`、`recess` / `slot` / `screw_hole` 已有视觉贴片、凹槽、长圆槽与孔位标记）。
- 真实字体轮廓 text emboss/engrave（当前 `text_emboss` / `text_engrave` 已进入第二阶段产品 controls 基线，但只是确定性的简化文字块视觉标记，非 true font outline / boolean cut）。
- 真正的 solid boolean / manifold 检查 / 自动修复。

### 5. QA 还需要更聪明

已做结构化 warning，但还没有做到“可发布级质量判断”：

- bbox overlap 还不能区分“预期接触/嵌入”和“真实碰撞”。
- queue runtime 的退化面、非平面、SketchUp fill 失败分类还不够细。
- 大模型还缺 face budget / vertex budget / SKP size budget 的硬性阈值。
- mock snapshot 和真实 queue snapshot 还没有自动 golden 对照报告。
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
