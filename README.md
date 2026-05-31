# 复现 Claude SketchUp Cloud MCP 功能

## 目标

在 Alma 里复现 Claude 官方 SketchUp Connector 的核心体验：用户用自然语言描述 3D 模型，Alma 生成受限建模 DSL，执行后拿到结构化 snapshot，再迭代修正，最终导出可用模型文件。

当前 MVP 走自建本地路线：**安全 JSON DSL + 本地 Node bridge + stdio MCP server + SketchUp Ruby 队列插件 + mock runtime**。

2026-05-27 验收复盘后，项目状态调整为：**技术预览闭环已验证，正式发布暂停**。主线 runtime、Expert Mode、mock/queue 回归和打包链路可继续作为基础能力使用；阶段 7 已补 `target_id + face` 的受控 feature operations、queue active model 防护，以及 `boolean_union` / `boolean_difference` / `boolean_intersect` / `manifold_check` / `manifold_repair` 组成的 CAD boolean/manifold 能力；Image Structured Modeler 已补齐 observation/model-plan/review evidence graph、`review.semantic_fusion` 跨图语义融合层、交互式 corrections workbench，以及 `blind_recess` / `convex` 到真实 feature operations 的第一版映射。正式发布仍需要用新 boolean/manifold 能力复跑更多产品类验收。

2026-05-29 起，下一阶段计划不是重写 runtime，而是重构 runtime 之上的产品建模架构：`ObservationSet -> EvidenceGraph -> ProductProfile -> PartGraph -> FeatureMappingPlan -> JSON DSL -> Layout QA + Reference Visual QA`。R1/R2 已落地 root `ProductProfile` / `PartGraph` schema、`vehicle_ambulance` profile、救护车 part graph、part graph compiler，并让救护车验收 DSL 从 `profile + part graph` 生成。R3 已加入 Reference Visual QA：救护车样例现在有独立的 silhouette/keypoint/extent/area/relative-placement/orientation 参考视觉规则，correction suggestions 指回 PartGraph 字段。R4 已完成子项目技术预览闭环：ambulance image evidence 可生成 seed/no-seed PartGraph、Reference Visual QA correction patch 和质量报告，并在 observations 中记录 mirror-risk orientation hints。R5 已完成三样本 mock + live queue 批量报告：ambulance、Switch 手柄、Fuji X-T10 相机都已进入 `ProductProfile -> PartGraph -> DSL -> Layout QA + Reference Visual QA` 和 fallback-ratio 产品样本报告，并保存 queue `.skp` artifacts。R6 已完成当前收口边界：no-seed 参数提案、proposal-to-patch authoring、参数提案 review UI、proposal-applied mock/queue 复验链，以及 REST3D 启发的 PartGraph physical consistency QA；ambulance、Switch、Fuji 三样例都记录支撑/贴合/接地等物理关系，并能在部件漂移时把 correction suggestion 指回 PartGraph target。R7 已先接入 GPT Image 生成的建筑群三视角图，跑通 `building_group` ObservationSet -> EvidenceGraph -> known-element scale anchors -> review-gated massing PartGraph -> DSL -> mock/live queue Layout QA + Reference Visual QA，并保存建筑群 queue `.skp`；当前还新增了 roofline / facade / opening 的 review-gated feature-intent proposals、accepted subset patch 和 mock/live queue proposal QA 链。正式发布仍暂停，因为还需要继续降低模板/视觉辅助比例。详细计划见 [Product Modeling Architecture Refactor Plan](docs/product-modeling-architecture-refactor-plan.md)。

## 已知官方形态

官方 SketchUp Connector 是一个 Cloud SketchUp MCP server，不是本地 SketchUp 桌面控制器。

暴露工具：

- `get_docs`：返回 SDK 文档。
- `build_model`：在云端模型 session 中执行 Python 建模代码。
- `save_model`：保存模型并返回 `.skp` 下载链接。

官方 endpoint：

- MCP endpoint：`https://api.sketchup.com/mcp/v1/sketchup/mcp`
- OAuth protected resource metadata：`https://api.sketchup.com/mcp/v1/sketchup/.well-known/oauth-protected-resource`
- Authorization server：`https://api.sketchup.com/mcp/v1/identity`

认证特征：

- OAuth Authorization Code + PKCE
- Dynamic Client Registration
- Bearer token
- Refresh token

## MVP 工具接口

```text
get_docs() -> { docs }
build_model({ code, runtime, timeoutMs? }) -> { snapshot }
reset_model({ runtime, timeoutMs? }) -> { snapshot }
save_model({ path?, keep_session?, runtime, timeoutMs? }) -> { file_path, snapshot }
validate_model({ code?|snapshot?, runtime?, spec?, includePreview? }) -> { report, preview }
validate_reference_model({ code?|snapshot?, runtime?, spec?, includePreview? }) -> { report, preview }
```

`runtime` 支持：

- `mock`：默认离线 runtime，不需要打开 SketchUp，用于 Alma 迭代、测试和 snapshot 校验。
- `queue`：把请求写入 `~/.sketchup-mcp-replica/queue`，由 SketchUp Ruby 插件执行并返回真实 SketchUp snapshot。

## 项目结构

```text
src/bridge.mjs           # 工具接口实现
src/cli.mjs              # CLI 入口
src/http-server.mjs      # HTTP bridge，可选
src/mcp-server.mjs       # stdio MCP server，可接入支持 MCP 的客户端
src/model-qa.mjs         # 无 GUI 的语义布局 QA、正交 SVG/HTML preview 和 correction suggestions
src/reference-visual-qa.mjs # 参考视觉 QA：silhouette/keypoint/extent/area/relative placement + PartGraph correction targets
src/mock-runtime.mjs     # 离线可验证 runtime
src/queue-runtime.mjs    # SketchUp 插件队列 runtime
src/geometry.mjs         # mock runtime operation modules 兼容聚合导出入口
src/model-state.mjs      # mock runtime 空 session/model state
src/operation-utils.mjs  # mock runtime 通用归一化、transform、camera、QA metadata helper
src/material-operations.mjs # mock runtime material/PBR/texture 字段记录
src/primitive-operations.mjs # mock runtime mesh/prism/cylinder 和 profile vertices helper
src/profile-operations.mjs # mock runtime panel/openings/profile/roof helpers
src/surface-operations.mjs # mock runtime loft/shell/sweep/screw/domed/bowed helpers
src/product-operations.mjs # mock runtime box/product helpers
src/architecture-operations.mjs # mock runtime level/floor/wall/stairs/railing helpers
src/demo-operations.mjs  # mock runtime demo room helper
src/component-operations.mjs # mock runtime component_definition / component_instance
src/view-operations.mjs  # mock runtime camera/scene/style/shadow/rendering options
src/snapshot.mjs         # mock runtime snapshot、warning summary 和 bbox QA helper
src/object-operations.mjs # mock runtime 对象编辑、metadata、texture transform 操作
src/object-identity.mjs  # mock runtime 对象身份/引用 helper
src/object-operation-utils.mjs # object operation 字段归一化 helper
src/boolean-operations.mjs # mock runtime solid boolean / manifold check-repair metadata
src/expert-compiler.mjs # Expert Mode v1 受限脚本 -> JSON DSL compiler
sketchup_plugin/         # SketchUp Ruby 插件
sketchup_plugin/alma_sketchup_mcp/operation_registry.rb # 由 src/capabilities.mjs 生成的 Ruby runtime contract 表
sketchup_plugin/alma_sketchup_mcp/object_operations.rb # Ruby queue runtime 对象编辑/metadata/texture transform
sketchup_plugin/alma_sketchup_mcp/materials.rb # Ruby queue runtime 材质/PBR/贴图 helper
sketchup_plugin/alma_sketchup_mcp/geometry_operations.rb # Ruby queue runtime 共享 geometry/entity helper
sketchup_plugin/alma_sketchup_mcp/primitive_operations.rb # Ruby queue runtime mesh/prism/cylinder
sketchup_plugin/alma_sketchup_mcp/product_operations.rb # Ruby queue runtime box/product helper
sketchup_plugin/alma_sketchup_mcp/profile_operations.rb # Ruby queue runtime panel/profile/roof helper
sketchup_plugin/alma_sketchup_mcp/surface_operations.rb # Ruby queue runtime loft/shell/sweep/domed/bowed helper
sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb # Ruby queue runtime SketchUp solid boolean / manifold check-repair
sketchup_plugin/alma_sketchup_mcp/demo_operations.rb # Ruby queue runtime demo room helper
sketchup_plugin/alma_sketchup_mcp/architecture_operations.rb # Ruby queue runtime 建筑 helper：level/floor/wall/stairs/railing
sketchup_plugin/alma_sketchup_mcp/component_operations.rb # Ruby queue runtime component_definition / component_instance
sketchup_plugin/alma_sketchup_mcp/view_operations.rb # Ruby queue runtime camera/scene/style/shadow/rendering options
sketchup_plugin/alma_sketchup_mcp/snapshot.rb # Ruby queue runtime snapshot/count/material/tag 快照
examples/demo-room.json  # 基础房间 demo DSL
examples/pbr-materials-slice.json # 材质贴图 / PBR demo DSL
examples/style-shadow-slice.json # 样式 / 阴影 / 渲染选项 demo DSL
examples/golden-architecture.json # 建筑向 golden regression DSL
examples/golden-product.json # 产品/工业设计向 golden regression DSL
examples/structured-product-helpers.json # 结构化产品 helper capability slice
examples/editing-transform-profile.json # 阶段2 P0 编辑/变换/profile capability slice
examples/component-transform-composition.json # component instance transform composition slice
examples/transform-chain-regression.json # 连续 transform_object 叠加/pivot/local-axis regression slice
examples/transform-local-matrix.json # local_matrix 和 matrix decomposition regression slice
examples/metadata-organization-slice.json # Tags / attributes / classification metadata capability slice
examples/profile-edge-cases.json # 通用 profile 凹多边形/多洞 regression slice
examples/appearance-texture-slice.json # texture transform / image plane appearance slice
examples/text-3d-slice.json # true font-outline text_3d capability slice
examples/boolean-manifold-slice.json # CAD boolean / manifold capability slice
examples/model-qa/building-group-massing.json # R7 building group massing Layout QA spec
examples/reference-visual-qa/ambulance-reference.json # ambulance Reference Visual QA spec
examples/reference-visual-qa/switch-controller-reference.json # Switch Reference Visual QA spec
examples/reference-visual-qa/fuji-camera-reference.json # Fuji camera Reference Visual QA spec
examples/reference-visual-qa/building-group-massing.json # R7 building group massing Reference Visual QA spec
examples/expert-parametric-fixture.js # Expert Mode v1 参数化 fixture 示例
test/mock-validation.mjs # 离线验证
test/expert-compiler.mjs # Expert Mode compiler / mock build regression
alma-skill/              # Alma skill 原型说明
```

## 安装与验证

首次拉取后安装 npm 依赖：

```bash
npm install
```

基础验证：

```bash
npm test
npm run demo
npm run save
npm run registry:check
npm run plugin:check
```

也可以直接调用 CLI：

```bash
node src/cli.mjs get_docs
node src/cli.mjs get_capabilities --runtime mock
node src/cli.mjs get_capabilities --runtime queue --timeout-ms 60000
node src/cli.mjs reset_model --runtime mock
node src/cli.mjs build_model --runtime mock --code-file examples/demo-room.json
node src/cli.mjs save_model --runtime mock --path output/mock-model.json
node src/cli.mjs compare_snapshots --expected-file output/mock-a.json --actual-file output/mock-b.json --tolerance-mm 1 --max-faces 5000 --max-artifact-size-bytes 50000000
node src/cli.mjs compare_model --code-file examples/demo-room.json --expected-runtime mock --actual-runtime mock --max-faces 5000
node src/cli.mjs compare_model --code-file examples/demo-room.json --expected-runtime mock --actual-runtime mock --max-faces 5000 --format markdown --output-file output/mock-parity-report.md
node src/cli.mjs validate_model --code-file examples/acceptance-switch-controller.json --spec-file examples/model-qa/switch-controller-demo.json --preview-dir output/model-qa/switch-controller-reference --format markdown --output-file output/model-qa/switch-controller-reference/report.md
node src/cli.mjs validate_reference_model --code-file examples/acceptance-ambulance-reference.json --spec-file examples/reference-visual-qa/ambulance-reference.json --preview-dir output/reference-visual-qa/ambulance-reference --format markdown --output-file output/reference-visual-qa/ambulance-reference/report.md
node src/cli.mjs validate_reference_model --code-file examples/acceptance-switch-controller.json --spec-file examples/reference-visual-qa/switch-controller-reference.json --preview-dir output/reference-visual-qa/switch-controller-reference --format markdown --output-file output/reference-visual-qa/switch-controller-reference/report.md
node src/cli.mjs compile_expert --code-file examples/expert-parametric-fixture.js --format dsl --seed 7
node src/cli.mjs build_expert_model --runtime mock --code-file examples/expert-parametric-fixture.js --seed 7
npm run qa:mock
npm run qa:model-layout
npm run qa:reference-visual
npm run qa:physical-consistency
npm run qa:product-samples
npm run qa:product-samples:queue
npm run image-structured:qa-building-group
npm run qa:expert:mock
npm run qa:identity:mock
# 打开 SketchUp 插件后，把 actual-runtime 改成 queue：
node src/cli.mjs compare_model --code-file examples/demo-room.json --expected-runtime mock --actual-runtime queue --timeout-ms 60000 --max-faces 5000 --format markdown --output-file output/live-demo-room-report.md
npm run qa:queue
npm run qa:expert:queue
npm run qa:identity:queue
npm run qa:budget:mock
npm run qa:budget:queue
# qa:queue 默认使用 180s queue timeout，并启用 --face-tolerance 1 --edge-tolerance 3，用于吸收 SketchUp sweep/railing 的轻微拓扑计数差异。
# queue runtime 绑定单个 SketchUp 进程，qa:queue / qa:expert:queue / qa:budget:queue 应串行执行。
```

Golden examples 用于稳定回归建筑向与产品/工业设计向能力：

```bash
node src/cli.mjs build_model --runtime mock --code-file examples/golden-architecture.json
node src/cli.mjs build_model --runtime mock --code-file examples/golden-product.json
node src/cli.mjs build_model --runtime mock --code-file examples/structured-product-helpers.json
node src/cli.mjs build_model --runtime mock --code-file examples/editing-identity.json
node src/cli.mjs build_model --runtime mock --code-file examples/editing-transform-profile.json
node src/cli.mjs build_model --runtime mock --code-file examples/transform-chain-regression.json
node src/cli.mjs build_model --runtime mock --code-file examples/metadata-organization-slice.json
node src/cli.mjs build_model --runtime mock --code-file examples/profile-edge-cases.json
node src/cli.mjs build_model --runtime mock --code-file examples/appearance-texture-slice.json
node src/cli.mjs build_expert_model --runtime mock --code-file examples/expert-parametric-fixture.js --seed 7
npm run qa:expert:mock
```

`npm test` 会自动加载 golden examples、主线 capability slices 和 Expert Mode fixture，检查 scene、materials、component 复用、结构化 warnings、resolution hint、runtime contract、Expert compiler 限制和 snapshot QA 字段。

## MCP stdio 接入

本项目自带一个最小 MCP stdio server，当前暴露 `get_docs`、`get_capabilities`、`build_model`、`compile_expert`、`build_expert_model`、`reset_model`、`save_model`、`compare_snapshots`、`compare_model`、`validate_model` 和 `validate_reference_model`：

```bash
node src/mcp-server.mjs
```

如果要加到 Alma MCP 配置里，可以新增一个本地 server，命令指向当前仓库里的 `src/mcp-server.mjs`：

```json
{
  "mcpServers": {
    "SketchUp Modeler Local": {
      "command": "node",
      "args": [
        "/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/src/mcp-server.mjs"
      ]
    }
  }
}
```

## HTTP bridge（可选）

```bash
npm run server
curl http://127.0.0.1:3977/health
curl -X POST http://127.0.0.1:3977/tools/build_model \
  -H 'content-type: application/json' \
  -d "$(jq -n --rawfile code examples/demo-room.json '{runtime:"mock", code:$code}')"
```

## SketchUp 插件安装

自动安装到 SketchUp 2026 Plugins 目录：

```bash
npm run plugin:install
```

`plugin:install` 会复制主文件和 `alma_sketchup_mcp/` 子模块，并对安装后的 Ruby 文件执行语法检查。打包 `.rbz` 用：

```bash
npm run plugin:package
```

然后：

1. 打开 SketchUp 2026。
2. 菜单选择 `Extensions/Plugins -> Alma SketchUp MCP -> Start Bridge`。
3. 回到项目目录运行：

```bash
node src/cli.mjs build_model --runtime queue --code-file examples/demo-room.json --timeout-ms 60000
node src/cli.mjs save_model --runtime queue --path "$PWD/output/demo-room.skp" --timeout-ms 60000
```

更完整的 queue 手动验收和排障见 `docs/queue-runtime-ops.md`；性能和 SKP size 预算见 `docs/performance-budgets.md`；技术预览打包检查见 `docs/release-checklist.md`。

队列 runtime 不执行 shell，也不 eval Ruby；它只把 JSON 请求写到队列，由插件解析受控 DSL。

## 安全 DSL

`build_model` 接受 JSON 字符串，不接受任意 Ruby、JavaScript 或 shell。

```json
{
  "version": 1,
  "units": "mm",
  "operations": [
    { "op": "reset" },
    { "op": "material", "name": "Wall_Paint", "color": "#efe7dc" },
    { "op": "material", "name": "Brushed_Metal_PBR", "color": "#8a8178", "workflow": "pbr_metallic_roughness", "alpha": 1, "texture": { "path": "textures/brushed-metal-albedo.jpg", "width": 1200, "height": 1200 }, "pbr": { "metallic_factor": 0.85, "roughness_factor": 0.32, "normal_style": "opengl", "normal_scale": 1, "textures": { "metallic": "textures/brushed-metal-metallic.jpg", "roughness": "textures/brushed-metal-roughness.jpg", "normal": "textures/brushed-metal-normal.jpg", "ao": "textures/brushed-metal-ao.jpg", "opacity": "textures/brushed-metal-opacity.jpg" } } },
    { "op": "box", "name": "Box_1", "origin": [0, 0, 0], "size": [1000, 1000, 1000], "material": "Wall_Paint" },
    { "op": "panel_with_openings", "name": "Front_Wall", "origin": [0, 0, 0], "plane": "xz", "size": [5000, 3000], "thickness": 120, "openings": [{ "name": "Door", "x": 600, "y": 0, "width": 900, "height": 2100 }], "material": "Wall_Paint" },
    { "op": "gable_roof", "name": "Main_Roof", "origin": [0, 0, 3000], "width": 5000, "depth": 7000, "rise": 1200, "overhang": 300, "material": "Roof" },
    { "op": "lofted_solid", "name": "Turned_Post", "origin": [0, 0, 0], "profile": [[0, 80], [500, 120], [1000, 70]], "segments": 10, "material": "Post", "smooth": "all" },
    { "op": "swept_path", "name": "Rail", "path": [[0, 0, 900], [1200, 0, 900], [1800, 0, 1200]], "radius": 45, "segments": 8, "material": "Post", "smooth": "all" },
    { "op": "domed_surface", "name": "Padded_Cushion", "origin": [0, 0, 0], "width": 1800, "depth": 900, "thickness": 140, "crown_height": 220, "segments_x": 8, "segments_y": 8, "material": "Fabric", "smooth": "all" },
    { "op": "bowed_panel", "name": "Curved_Back_Wall", "origin": [0, 1200, 0], "width": 1800, "height": 1200, "thickness": 100, "bow_depth": 260, "segments_x": 8, "segments_z": 8, "material": "Wall_Paint", "smooth": "all" },
    { "op": "level", "name": "Level_1", "elevation": 0, "height": 3000 },
    { "op": "floor_slab", "name": "Level_1_Slab", "origin": [0, 0, 0], "width": 3600, "depth": 2400, "thickness": 160, "material": "Concrete" },
    { "op": "wall", "name": "Front_Wall", "start": [0, 0, 160], "end": [3600, 0, 160], "height": 2600, "thickness": 120, "openings": [{ "name": "Door_Opening", "x": 400, "y": 0, "width": 900, "height": 2100 }], "material": "Wall_Paint" },
    { "op": "door", "name": "Entry_Door", "origin": [425, -45, 160], "plane": "xz", "width": 850, "height": 2050, "thickness": 40, "material": "Post" },
    { "op": "window", "name": "Front_Window", "origin": [1925, -35, 1080], "plane": "xz", "width": 850, "height": 720, "thickness": 24, "material": "Glass" },
    { "op": "stairs", "name": "Entry_Stairs", "origin": [0, -900, 0], "steps": 4, "width": 1400, "tread_depth": 300, "riser_height": 160, "direction": "y", "material": "Concrete" },
    { "op": "railing", "name": "Front_Railing", "path": [[0, -940, 640], [1800, -940, 640]], "height": 900, "rail_radius": 35, "post_radius": 30, "post_spacing": 600, "material": "Post" },
    { "op": "scene", "name": "Hero_View", "camera": { "eye": [7000, -9000, 5200], "target": [2500, 2500, 1800], "up": [0, 0, 1], "fov": 35 } },
    { "op": "style", "name": "Presentation", "display_edges": true, "profiles": true, "profile_width": 2, "display_watermarks": false, "face_style": "shaded_with_textures", "background_color": "#f7f4ed", "sky_color": "#cfe8ff", "ground_color": "#d8d0bf" },
    { "op": "shadow", "display": true, "time": "2026-05-08T14:30:00+08:00", "light": 80, "dark": 35, "use_sun_for_shading": true },
    { "op": "rendering_options", "edge_display_mode": 1, "draw_hidden_geometry": false, "display_color_by_layer": false, "transparency": true }
  ]
}
```

当前支持的 operation 以 `src/capabilities.mjs` 的 manifest 为单一真源；`get_docs` 会从该 manifest 生成 mock/queue 支持矩阵，避免文档和 runtime 能力漂移。

- 基础：`reset`、`material`、`box`、`room`、`level`。
- 编辑：`delete`、`rename`、`set_material`、`set_visibility`、`transform_object`；编辑操作优先支持 `target_id` 稳定引用，旧的 `name` 引用仍可用；`transform_object` 支持 translate、rotateX/Y/Z、模型空间 `axis + angle`、本地轴 `local_axis + local_angle`、SketchUp-compatible 16-number `matrix`、本地坐标系 `local_matrix`、scale、mirror，以及 `pivot: "origin"`（默认）、`pivot: "center"` 和显式 `[x,y,z]`；matrix/local_matrix snapshot 会附带 decomposition metadata。
- 几何：`prism`、`mesh`、`face_with_holes`、`profile_extrude`、`panel_with_openings`、`boolean_cutout`、`boolean_union`、`boolean_difference`、`boolean_intersect`、`manifold_check`、`manifold_repair`、`fillet`、`chamfer`、`cylinder`、`loft_between_profiles`、`shell_from_front_side_profiles`、`lofted_solid`、`face_on_cylinder`、`pipe_between_points`、`swept_path`、`domed_surface`、`bowed_panel`。
- 产品 helper：`rounded_box`、`beveled_panel`、`recess`、`engraved_line`、`text_emboss`、`text_engrave`、`text_3d`、`slot`、`slot_array`、`rib`、`standoff_boss`、`button_on_panel`、`analog_stick`、`screw_hole`。
- 建筑 helper：`floor_slab`、`wall`、`door`、`window`、`stairs`、`railing`、`gable_roof`、`shed_roof`。
- 组织/元数据：`tag`、`assign_tag`、`attribute`、`classification`。
- 表现/贴图：`texture_transform`、`uv_project_planar`、`uv_project_box`、`image_plane`。
- 变换：`transform.translate`、`transform.rotateZ`，可用于 mesh 类几何和组件实例；`origin` 仍是首选定位字段。
- 复用：`component_definition`、`component_instance`。
- 视图：`camera`、`scene`。
- 表现：`style`、`shadow`、`rendering_options`。

坐标规则：

- 单位统一用毫米（mm）；SketchUp 插件内部会换算到 SketchUp 原生长度单位，snapshot 再回写为毫米。
- X = 宽，Y = 深，Z = 高。
- 每个 group / component instance 必须命名；可额外提供稳定 `id`（兼容别名：`object_id`、`objectId`、`guid`），snapshot 会回传 `id`。同一个 entity scope 内 `id` 和 `name` 都必须唯一；后续编辑建议用 `target_id`，避免 rename 导致引用漂移。如果编辑操作同时传 `target_id` 和 `name`，两者必须指向同一个对象。
- 材质按名称查重后复用；旧写法 `{ "op": "material", "name": "Wall_Paint", "color": "#efe7dc" }` 仍可用。
- `material` 支持 `alpha`、基础 `texture`（路径字符串或 `{ "path", "width", "height" }`）和 SketchUp 2025+ 的 `workflow: "pbr_metallic_roughness"`。
- PBR 字段支持 `pbr.metallic_factor`、`pbr.roughness_factor`、`pbr.ao_strength`、`pbr.normal_style`、`pbr.normal_scale`、`pbr.textures.{metallic,roughness,normal,ao,opacity}`。
- `text_3d` 在 queue runtime 使用 SketchUp Ruby `Entities#add_3d_text` 生成真实字体轮廓，支持 `font`、`align`、`bold`、`italic`、`filled`、`height` 和 `extrusion/depth`；mock runtime 回传稳定的估算 bbox 与 `Text3D` metadata，用于离线 contract/QA。
- `queue` runtime 会把贴图路径交给 SketchUp Ruby API；建议使用绝对路径。贴图文件不存在时跳过贴图并写入 warning，不会中断建模。
- `style` 负责常用表现层：边线、轮廓线、轮廓线宽、水印开关、`face_style`、背景/天空/地面色。
- `shadow` 负责阴影开关、ISO-8601 时间、明暗强度和是否用太阳做全局着色。
- `rendering_options` 负责更接近 SketchUp Ruby `model.rendering_options` 的键：`edge_display_mode`、`draw_hidden_geometry`、`display_color_by_layer`、`transparency`、`draw_back_edges`、`draw_ground`、颜色和 render/face mode。不同 SketchUp 版本缺失的 key 会产生 warning，不中断建模。

## Snapshot schema

```json
{
  "runtime": {
    "name": "mock",
    "version": "mock-runtime-0.1.0",
    "capability_version": "0.1.0-capabilities.5",
    "manifest_version": "2026-05-phase7-boolean-manifold",
    "dsl_version": 1,
    "supported_operations": ["reset", "material", "box"],
    "operation_support": {
      "box": {
        "status": "supported",
        "stability": "stable",
        "schema": { "required": ["op", "name", "origin", "size"], "optional": ["id", "object_id", "objectId", "guid", "material", "transform.translate", "transform.rotateZ"] },
        "component_scope": { "status": "supported" }
      }
    },
    "compatibility": {
      "ok": true,
      "level": "ok",
      "checked_against": { "manifest_version": "2026-05-phase7-boolean-manifold", "capability_version": "0.1.0-capabilities.5", "dsl_version": 1 },
      "issues": []
    }
  },
  "totals": { "faces": 0, "edges": 0, "vertices": 0, "groups": 0, "instances": 0 },
  "groups": [
    {
      "name": "Wall_North",
      "kind": "wall",
      "faces": 6,
      "edges": 12,
      "vertices": 8,
      "resolution_hint": { "segments_x": 8, "segments_y": 6 },
      "bounding_box": { "min": [0, 0, 0], "max": [3000, 120, 2400], "w": 3000, "d": 120, "h": 2400 },
      "material": "Wall_Paint",
      "features": [],
      "boolean_operations": [],
      "manifold": null
    }
  ],
  "manifold_checks": [],
  "instances": [],
  "component_definitions": [],
  "scenes": [],
  "levels": [],
  "materials": [{ "name": "Wall_Paint", "color": "#efe7dc" }],
  "material_names": ["Wall_Paint"],
  "style_state": null,
  "shadow_state": null,
  "rendering_options": null,
  "bounding_box": { "min": [0, 0, 0], "max": [4500, 3000, 2400], "w": 4500, "d": 3000, "h": 2400 },
  "warnings": [{ "type": "geometry.bbox_collision", "severity": "warn", "category": "geometry", "relation": "collision", "message": "...", "source": "group:A|group:B" }],
  "warning_messages": ["..."],
  "warning_summary": { "total": 1, "by_severity": { "error": 0, "warn": 1, "info": 0 }, "by_category": { "geometry": 1 } },
  "artifact_size_bytes": 12345,
  "view_state": null
}
```

mock snapshot 会额外给出零面组、bounding box 碰撞等结构化 warning，方便 Alma 自动迭代修正。`geometry.degenerate` 表示零面/退化面，`geometry.bbox_collision` 表示真实体积穿插；bbox 仅接触会被识别为 contact 关系但默认不作为噪声 warning 输出。`runtime` 是第一阶段能力基线描述，记录执行 runtime、manifest 版本、DSL 版本和 operation 支持状态；`runtime.compatibility` 会把实际 runtime descriptor 和当前 manifest 对照，暴露 `ok`、`level` 和结构化 `issues`，用于发现插件版本漂移或缺失 operation；`warning_messages` 是兼容快速扫描的字符串列表；`warning_summary` 汇总 severity/category；`materials` 是带字段对象列表，`material_names` 是兼容快速检查的名称列表；表现层状态记录在 `style_state`、`shadow_state` 和 `rendering_options`。

## Snapshot diff report

`compare_snapshots` 用于后续 mock/queue 对照和 golden regression 报告。它接受两个 snapshot JSON（也兼容 `{ "snapshot": ... }` 包装对象），输出：

```json
{
  "ok": false,
  "level": "error",
  "verdict": "fail",
  "tolerance_mm": 1,
  "budgets": { "max_faces": 5000, "max_artifact_size_bytes": 50000000 },
  "summary": { "total": 3, "by_severity": { "error": 1, "warn": 1, "info": 1 }, "by_type": { "groups.missing": 1 } },
  "top_issues": [{ "type": "groups.missing", "severity": "error", "path": "groups", "message": "groups item missing: Wall_A", "name": "Wall_A" }],
  "recommendations": ["Inspect missing named objects first; downstream totals and bounding boxes may be secondary effects."],
  "diffs": []
}
```

当前离线骨架先比较 runtime compatibility、totals（不含 `vertices`，因为 mock/queue 顶点统计语义不同）、artifact size、materials、component definitions、groups、instances、feature metadata、scenes、levels 和整体 bounding box；可选 topology tolerance 支持 `--face-tolerance`、`--edge-tolerance`、`--group-tolerance`、`--instance-tolerance`，用于显式吸收 SketchUp 真实拓扑和 mock 估算之间的小差异；可选 budget 支持 `max_faces`、`max_edges`、`max_vertices`、`max_groups`、`max_instances`、`max_artifact_size_bytes`。后续真实 queue 对照时可以继续扩展退化面、预期接触/碰撞和 SKP size budget 分析。

`compare_model` 是更高层的一键对照：同一份 DSL 先用 `expected_runtime` 构建，再用 `actual_runtime` 构建，随后复用 `compare_snapshots` 产出 QA report。默认是 `mock -> queue`；纯离线可显式传 `--actual-runtime mock`，打开 SketchUp 插件后再改回 `queue`。CLI 默认输出 JSON；加 `--format markdown --output-file output/report.md` 可保存人类可读 Markdown 报告。`scripts/generate-qa-reports.mjs` 会批量跑默认 golden set（demo room、golden architecture、golden product），为每个样例输出 JSON/Markdown，并生成 `index.md` 总览；快捷命令是 `npm run qa:mock` 和 `npm run qa:queue`。Node 侧 queue runtime 会通过 `~/.sketchup-mcp-replica/queue-runtime.lock` 串行化 SketchUp file queue 访问；bridge 会在同一生命周期内缓存已验证 runtime descriptor，显式 `get_capabilities` 仍会强制 live handshake。如需调大等待时间，可设置 `ALMA_SKETCHUP_QUEUE_LOCK_TIMEOUT_MS=<毫秒>`。

`validate_model` 是补充在 snapshot 之上的无 GUI 语义布局 QA：它可以直接构建 DSL，也可以校验已有 snapshot；`spec.rules` 支持 `contacts`、`allowed_collisions`、`inside`、`support` 和 `separation` 规则，规则目标可用精确名称或正则。报告会返回 `issues`、`correction_suggestions`，并生成 top/front/right 正交 SVG 与 HTML preview。`npm run qa:model-layout` 默认跑 Switch 手柄、救护车、Fuji 相机和儿童房四份验收样例，输出到 `output/model-qa/`。救护车验收 DSL 可用 `npm run acceptance:generate-ambulance` 从 `examples/product-profiles/vehicle_ambulance.json` + `examples/part-graphs/ambulance-reference.part-graph.json` 重建；Switch 验收 DSL 可用 `npm run part-graph:compile-switch` 从 `examples/product-profiles/game_controller_switch.json` + `examples/part-graphs/switch-controller-reference.part-graph.json` 重建；Fuji 相机验收 DSL 可用 `npm run part-graph:compile-fuji-camera` 从 `examples/product-profiles/camera_fuji_x_t10.json` + `examples/part-graphs/fuji-camera-reference.part-graph.json` 重建。三个产品样例都应通过通用 part graph compiler，避免基于旧 JSON 继续手改。

`validate_reference_model` 是 layout QA 之后的参考视觉 QA：它复用正交 preview renderer，忽略 `reference_image` 图板，只检查生成模型自身在参考视图里的 silhouette aspect、keypoint、extent ratio、area ratio、relative placement 和 orientation/chirality。报告结构与 `validate_model` 保持一致，但 correction suggestions 使用 `action: "update_part_graph"`，目标路径指向 `parts[...].shape.parameters...`。救护车规则在 `examples/reference-visual-qa/ambulance-reference.json`，Switch 规则在 `examples/reference-visual-qa/switch-controller-reference.json`，Fuji 相机规则在 `examples/reference-visual-qa/fuji-camera-reference.json`，`npm run qa:reference-visual` 会输出 JSON/Markdown/preview 到 `output/reference-visual-qa/`。当前 ambulance 规则已经从旧 seed geometry 切到参考图锚定门槛；旧快照会失败，新 PartGraph/DSL 通过 mock 和 queue 的 layout/reference QA。Switch 与 Fuji 规则验证了 layout QA 之外的关键点、占比、相对位置和左右手性门槛；新增回归会把 Switch 左右摇杆镜像对调，并要求 `reference.orientation_order` 失败。

`npm run qa:product-samples` 是 R5/R6 产品样本质量入口：它会检查 ProductProfile + PartGraph 编译结果是否与 acceptance DSL 一致，再跑 layout QA、Reference Visual QA 与 PartGraph physical consistency QA，并按样本输出 `real_feature_op`、`structured_primitive`、`visual_helper`、`box_approximation`、`profile_default`、`needs_review` 等 fallback ratio。当前默认覆盖 ambulance、Switch 与 Fuji 相机，mock 报告输出到 `output/product-sample-qa/`；`npm run qa:physical-consistency` 会单独输出物理一致性报告到 `output/physical-consistency-qa/`；`npm run qa:product-samples:queue` 会跑同一组 live queue gate，并保存 `.skp` artifacts 到 `output/product-sample-qa/queue/artifacts/`。当前三样例 physical consistency gate 全部通过：ambulance 26 条物理关系、Switch 25 条、Fuji 30 条。Fuji 已补镜头分段/镜头盖夹片、前脸 FUJIFILM/X-T10 文字、顶部拨盘标记和后背独立按钮，Reference Visual QA 会检查这些 detail，physical consistency QA 也覆盖镜头环、镜头盖夹片、拨盘标记、快门按钮、肩带扣、后目镜、后背屏幕和独立按钮，防止这类小构件再次悬浮；当前 fallback ratios 为 `real_feature_op 0.091`、`structured_primitive 0.667`、`box_approximation 0.03`、`visual_helper 0.212`，属于 R5/R6 可回归的第三产品样例，但仍不是最终照片级相机建模质量。

Image Structured Modeler 的 ambulance no-seed skeleton 现在会在 PartGraph 中输出 `parameter_proposals`：每条提案记录目标 PartGraph path、当前值、建议值、置信度、图像尺度/bbox/keypoint 依据和 `review_required` 状态。当前 no-seed skeleton 覆盖 7 个 profile-required parts、20 条提案，全部保持 review-gated；seed generated PartGraph 记录 45 条提案，质量报告会统计 `parameter_proposals`、`parameter_proposal_parts` 和 `review_required_parameter_proposals`。图像 observation 现在也会记录 `orientation_hints`，包括 `image_x_right_y_down` 坐标约定、mirror risk、semantic anchors 和 `review_required`，用于显式标出左右/前后镜像风险，避免把 CV 视角分类直接当成模型手性事实。`npm run image-structured:proposal-patch-ambulance` 会读取 `parameter-proposal-review.accepted.json`，把已接受 proposal 转成 `correction-patch.parameter-proposals.json`，并生成应用后的 `part-graph.proposal-applied.json`。`npm run image-structured:proposal-review-ambulance` 会生成 `projects/image-structured-modeler/examples/ambulance/proposal-review/index.html`，用于勾选 proposal 并导出 accepted proposal JSON。`npm run image-structured:proposal-review-chain-ambulance` 会把 review -> patch -> `output.proposal-applied.json` -> mock QA 串起来；`npm run image-structured:proposal-review-chain-ambulance:queue` 会用 live SketchUp queue 复验并保存 `output/image-structured-ambulance-proposal-applied.skp`。当前只接受 body/cab 两项 proposal 时，该链路应输出 `review_required: true`，layout/reference QA fail，physical consistency pass，防止把部分确认的 no-seed skeleton 误升格为完整产品 acceptance。

R7.0 建筑群输入基线入口是 `npm run image-structured:analyze-building-group`：它读取 `test/建筑群/` 的三张 GPT Image 合成航拍图，使用 `projects/image-structured-modeler/examples/building-group/view-hints.json` 固定 top/oblique 视角，输出 `examples/building-group/observations.json` 和 `review-overlays/*-overlay.png`。当前 evidence graph 只确认厂区输入证据：site boundary、蓝顶主厂房、仓库排、罐区、utility building、office、parking lot 和 internal roads；尺度与 orientation/north-up 仍需要 review。

R7 known-element scale + massing 入口是 `npm run image-structured:build-building-group`：它会重跑建筑群分析，从停车位宽度/深度、停车车道和人行横道等已知要素估算厂区尺度，生成 `examples/building-group/part-graph.massing.json` 和 `output.massing.json`。当前估算约为 `130m x 98m`，并保留 4 个 scale anchor marker；所有 massing shape proposal 都是 `review_required: true`，用于避免把 bbox-derived 厂区体块误当成最终建筑 acceptance。`npm run image-structured:qa-building-group` 会输出 mock layout/reference QA 到 `projects/image-structured-modeler/examples/building-group/layout-qa/` 和 `reference-visual-qa/`，当前均为 `pass` / 0 issues。

R7 建筑群 live queue gate 是 `npm run image-structured:qa-building-group:queue`：它会跑 queue layout/reference QA，输出到 `layout-qa-queue/` 和 `reference-visual-qa-queue/`，并保存 `output/image-structured-building-group-massing.skp`。当前 live snapshot 为 14 groups / 256 faces / 452 edges / 224 vertices / 2 scenes，SKP `208737` bytes，两项 QA 均为 `pass` / 0 issues。记录见 `projects/image-structured-modeler/examples/building-group/QUEUE_VERIFICATION.md`。

R7 建筑细节 proposal 第一刀是 `npm run image-structured:proposal-review-chain-building-group`：`part-graph.massing.json` 会给主厂房、仓库排、utility building 和 admin office 生成 5 条 review-gated `feature_intents` proposals，覆盖 roofline ribs、facade rhythm、loading/service doors、window bands 和 louver/slot candidates。当前 fixture 只接受 `primary_blue_roof_hall` 的 detail subset，生成 `correction-patch.detail-proposals.json`、`part-graph.detail-proposal-applied.json`、`output.detail-proposal-applied.json`、`proposal-review/index.html` 和 `proposal-qa/report.json`；mock compile/layout/reference/physical consistency 均为 `pass`。`npm run image-structured:proposal-review-chain-building-group:queue` 已通过 live queue，并输出 `proposal-qa-queue/report.json`，保存 `output/image-structured-building-group-detail-proposal-applied.skp`（221357 bytes，14 groups / 334 faces / 668 edges / 368 vertices）。

## Expert Mode v1

Expert Mode 是 JSON DSL 的受限生成层：脚本先经过 `src/expert-compiler.mjs` 的 AST 白名单解释器编译成标准 JSON DSL，再交给现有 `build_model`。它不会直接调用 SketchUp API，也不会绕过 operation registry。

当前支持变量、函数、`for` / `for...of`、数组、`Array.map/filter/flatMap/reduce/concat`、基础 `Math`、`range`、`clamp`、`lerp`、`rad` / `deg`、`rand` / seeded `random`、`vec` helper 和批量 `component_instance`。默认限制为 2000 operations、10000 loop iterations、50000 statement steps、5MB 输出和 1000ms 编译 timeout。

```bash
node src/cli.mjs compile_expert --code-file examples/expert-parametric-fixture.js --format dsl --seed 7
node src/cli.mjs build_expert_model --runtime mock --code-file examples/expert-parametric-fixture.js --seed 7
```

详细限制见 `docs/expert-mode.md`。

## 安全限制

- 单次 `build_model` 默认最多接受 2000 个 `operations`，mock runtime 和 SketchUp Ruby 插件保持一致。
- 可信的大型模型可在启动 Node/SketchUp 前设置 `ALMA_SKETCHUP_MAX_OPERATIONS=<正整数>` 临时调高限制；SketchUp 插件会读取启动进程时的环境变量。
- 复杂图纸仍建议拆成多次增量 `build_model`：第一批包含 `reset`、材质、楼层和主体；后续批次不带 `reset`，继续追加门窗、室内墙体、细部构件。

## 当前 MVP 状态

- 当前只能声明为技术预览：儿童房、救护车、Switch 手柄和 Fuji 相机验收说明系统能表达和保存结构化展示模型；主线已补受控面级 feature operations、CAD boolean/manifold 和 active model 防护，子项目已补 graph-based semantic fusion、corrections workbench 和 R4 evidence/correction loop。救护车已完成第一轮参考图锚定 PartGraph refit，Switch 和 Fuji 已进入 R5 ProductProfile/PartGraph/Reference Visual QA 样本报告，三样本 mock + live queue 批量报告已通过；R6 proposal review 链路已证明部分接受的 no-seed proposal 会被 mock/queue QA 留在 review-gated 状态；R7 已接入建筑群输入 evidence/overlay、known-element scale anchors、review-gated massing PartGraph、mock/live queue layout/reference QA，以及 roofline/facade/opening detail proposal -> patch -> mock/live queue QA 链。照片/多图到可编辑模型仍需要继续推进更多产品边界样例，以及降低模板/视觉辅助比例。
- `get_docs`、`build_model`、`reset_model`、`save_model`、`validate_model`、`validate_reference_model` 已完成 Node bridge、CLI、HTTP bridge 和 stdio MCP server 入口。
- `mock` runtime 已支持基础房间、墙洞面板、棱柱、mesh、通用 profile face/extrude（简单闭合多边形 outer + holes）、圆角盒/倒角面板、凹槽、长圆槽、刻线、text_3d bbox metadata、font-outline `text_emboss/text_engrave` metadata、面板按钮、摇杆、螺丝孔位、受控 `cut_hole` / `cut_slot` / `cut_recess` / `add_boss` / `add_raised_rib` feature metadata、`boolean_union` / `boolean_difference` / `boolean_intersect` 结果记录与 `manifold_check` / `manifold_repair`、屋顶 helper、圆柱、旋转体、扫掠管、domed/bowed 曲面、楼层/楼板/墙/门窗/楼梯/栏杆、Tags/attributes/classification 元数据、texture_transform/image_plane 表现层、组件定义/实例、基础 transform、对象任意模型轴旋转、本地轴旋转、模型空间 4x4 matrix、本地坐标系 local_matrix、matrix/local_matrix decomposition metadata（含 affine/non-affine 与 Euler 报告）、相机、scene、材质 texture/PBR 字段记录、style/shadow/rendering options 表现层状态和 snapshot 校验；bridge 会在 snapshot 中附加 runtime capability descriptor。
- `queue` runtime 已能把请求交给 SketchUp Ruby 插件，插件侧实现同一套 DSL 的真实建模、基础 transform、对象任意模型轴旋转、本地轴旋转、4x4 matrix、本地坐标系 local_matrix、transform metadata 回传（含 affine/non-affine 与 Euler 报告）、通用 profile face/extrude、Tags/attributes/classification 元数据、texture_transform/image_plane 表现层、圆角盒/倒角面板、凹槽、长圆槽、刻线、真实字体轮廓 text_3d、font-outline `text_emboss/text_engrave`、面板按钮、摇杆、螺丝孔位、受控 face pushpull feature operations、SketchUp solid boolean operations、manifold 检查/修复 metadata、domed/bowed 曲面、楼层/楼板/墙/门窗/楼梯/栏杆、材质 color/alpha/texture/SketchUp 2025+ PBR、style/shadow/rendering options、scene 和 `.skp` 保存；`reset_model` / `build_model` / `save_model` / `snapshot` 已统一使用 active model 防护；snapshot 中的 queue runtime descriptor 来自已安装插件，并通过 `runtime.compatibility` 对照当前 manifest。
- Expert Mode v1 已接入 CLI/bridge：受限脚本通过 AST 白名单解释器编译成 JSON DSL，再复用现有 mock/queue runtime；`examples/expert-parametric-fixture.js` 覆盖参数化组件阵列、`range().map(...)`、seeded random、`vec` helper 和 `text_3d`，新增扩展 helper 覆盖数组 `filter/flatMap/reduce`、`clamp/lerp/rad/deg` 与 `vec.cross/norm/distance`，并已通过 live queue 单例构建，warnings 0。
- MCP stdio server 已暴露 Expert Mode 工具：`compile_expert` 和 `build_expert_model`，客户端可以直接请求受限脚本编译或编译后构建。
- Expert Mode 发布回归已接入并通过 `npm run qa:expert:mock` / `npm run qa:expert:queue`，输出编译、runtime build、artifact 保存、warnings 和预算报告；queue SKP artifact 保存到 `output/qa-reports/expert-queue/artifacts/expert-parametric-fixture.skp`。
- 离线测试 `npm test` 已覆盖核心 DSL、建筑 DSL、产品/工业设计 golden examples、snapshot totals/QA、材质、PBR 字段、表现层状态、组件、相机、保存流程、queue capability handshake 注入、descriptor 漂移检测、带 top issues / recommendations / budget 检查的 snapshot diff report、Markdown QA report、`compare_model` 一键对照骨架，以及 `validate_model` 语义布局 QA 和 `validate_reference_model` 参考视觉 QA。
- `mock` runtime 的 session 写入使用文件锁和临时文件原子 rename；并行运行 `npm test` 与 `npm run qa:mock` 时会串行化同一 session 的读写，避免半写 JSON 污染。
- JS mock runtime 已完成主边界模块拆分：session/model state 位于 `src/model-state.mjs`；通用归一化和 transform helper 位于 `src/operation-utils.mjs`；material/PBR/texture、primitive、profile、surface、product、architecture 和 demo helper 分别位于对应 `*-operations.mjs`；component_definition/instance 位于 `src/component-operations.mjs`；camera/scene/style/shadow/rendering 位于 `src/view-operations.mjs`；对象编辑和身份引用位于 `src/object-operations.mjs` / `src/object-identity.mjs`；snapshot、warning summary 和 bbox QA 位于 `src/snapshot.mjs`；`src/geometry.mjs` 仅保留兼容聚合导出。
- Ruby queue runtime 已完成模块拆分：runtime contract 表由 `src/capabilities.mjs` 生成到 `sketchup_plugin/alma_sketchup_mcp/operation_registry.rb`；对象编辑、Tags、attributes、classification、texture transform 和 `transform_object` 位于 `object_operations.rb`；材质、PBR 和贴图 helper 位于 `materials.rb`；共享 geometry/entity helper 位于 `geometry_operations.rb`；mesh/prism/cylinder 位于 `primitive_operations.rb`；box/product helper 位于 `product_operations.rb`；panel/profile/roof helper 位于 `profile_operations.rb`；loft/shell/sweep/domed/bowed helper 位于 `surface_operations.rb`；受控面级特征位于 `feature_operations.rb`；solid boolean / manifold 位于 `boolean_operations.rb`；demo room 位于 `demo_operations.rb`；建筑、组件、view 和 snapshot 分别位于对应模块，均由主插件文件 `require_relative` 加载。

## 下一步

### 当前 P0

- [x] Queue active model 防护：`reset_model` / `build_model` / `save_model` / `snapshot` 统一走 `active_model_or_new`；Node queue save path 先解析为绝对路径。
- [x] 真实特征编辑第一 slice：新增 `cut_hole`、`cut_slot`、`cut_recess`、`add_boss`、`add_raised_rib`，接口以 `target_id + face + depth/through` 为核心，样例为 `examples/feature-editing-slice.json`。
- [x] CAD boolean/manifold：新增 `boolean_union`、`boolean_difference`、`boolean_intersect`、`manifold_check`、`manifold_repair`，queue runtime 调 SketchUp solid operations，mock/runtime snapshot 记录 boolean history 与 manifold reports，样例为 `examples/boolean-manifold-slice.json`。
- [x] Image Structured feature mapping 第一 slice：compact remote 已把 `blind_recess` / `convex` 编译为 `cut_recess` / `add_boss` / `add_raised_rib`，并通过 queue snapshot/diff 与 `feature_mapping_regression`。
- [x] Image Structured Modeler 图像侧语义融合：`model-plan.review.semantic_fusion` 已按 part 汇总跨视图 evidence、semantic labels、feature mapping、confidence、decision/status 和 review flags；Switch/compact remote 样例已刷新。
- [x] Image Structured Modeler R4 PartGraph 闭环：ambulance 图像证据已生成 seed/no-seed PartGraph、compiled DSL、Reference Visual QA report、CorrectionPatch 和 quality gate；`test:image-structured` 覆盖 contour/keypoint、跨图 matching、尺度校准、证据置信度和 correction patch 应用。
- [x] Ambulance visual-quality refit 第一轮：Reference Visual QA 已新增 `extent_ratios`，参考图锚定规则会让旧 seed 快照失败 17 项，新 PartGraph/DSL 通过 mock/queue layout QA + Reference Visual QA。
- [x] R5 Switch 样例扩展第一刀：新增 `game_controller_switch` ProductProfile、Switch PartGraph、compiled acceptance DSL、Reference Visual QA spec 和 `qa:product-samples` fallback-ratio 报告；Switch 已通过 ProductProfile -> PartGraph -> DSL -> Layout QA + Reference Visual QA。
- [x] R5/R6 三样本产品报告收口：新增 `camera_fuji_x_t10` ProductProfile、Fuji PartGraph、compiled acceptance DSL、layout QA spec、Reference Visual QA spec 和 `qa:product-samples:queue`；ambulance / Switch / Fuji 已通过 mock + live queue 产品样本批量报告，Fuji 当前为 33 parts，并补上镜头/文字/拨盘/后背按钮 detail gate。
- [x] R6 proposal review -> patch -> QA/queue 链：`image-structured:proposal-review-chain-ambulance` 和 `:queue` 会重建 accepted proposal patch、编译 proposal-applied DSL、运行 QA，并在 queue 版保存 `.skp`；当前 accepted subset 仍按预期输出 `review_required: true`。
- [x] Review/corrections authoring 工作台：review HTML 已支持选择建议 patch、编辑 JSON、校验、复制和下载 `manual-corrections.workbench.json`；自动写盘/重跑仍留作 CLI polish。

### 已验证通过（done）

- [x] SketchUp 2026 插件安装 + queue runtime → 真实 `.skp`（已验证：Calgary 语义 demo、Huggy Pro HPT 36 帐篷、Switch 手柄）。
- [x] mock / queue snapshot 对照（各 demo 均通过两边验证）。
- [x] dome/bowed panel、建筑高层 DSL、材质贴图+PBR、style/shadow/rendering。
- [x] component_definition / component_instance 基础复用。
- [x] component instance 上的 `transform_object` 组合验证：模型轴、本地轴、4x4 matrix。
- [x] Image Structured Modeler evidence graph + correction suggestions：observations/model-plan/review/per-image summary 已记录 `observed` / `inferred` / `template_prior` / `manual_confirmed`、missing views、feature fallback 和可复制 correction patch 骨架。
- [x] Image Structured Modeler semantic fusion + corrections workbench：`review.semantic_fusion` 已把跨视图证据融合为 per-part status/decision/confidence，review 页面已能交互生成 corrections JSON。
- [x] Image Structured feature mapping：compact remote queue snapshot `3 groups / 369 faces / 1035 edges / 2 scenes`，`add_boss ×6`、`add_raised_rib ×1`、`cut_recess ×5`，warning gate pass；Switch queue snapshot/diff 也已刷新并通过 warning gate。
- [x] snapshot QA 分类、曲面分辨率、文件体积字段。
- [x] golden examples：`examples/golden-architecture.json` 与 `examples/golden-product.json`。

### 从 Switch 手柄测试暴露的差距（产品/工业设计向）

手柄建模暴露了当前 DSL 偏向建筑体块、不够服务产品/工业设计的若干方向：

#### 形体类 DSL 缺口

- [x] `rounded_box` — 圆角长方体，产品外壳最常见形体
- [x] `beveled_panel` — 带倒角的薄壁面板，手持设备外壳
- [x] `fillet` / `chamfer` — 盒体/面板垂直边圆角与倒角（稳定 slice；任意选边 CAD 版本后续）
- [x] `loft_between_profiles` — 多截面放样，用于握把/手柄曲线
- [x] `face_with_holes` / `profile_extrude` — 通用 profile 第一切片：简单闭合多边形 outer + holes（mock/queue 对照通过）
- [x] `shell_from_front_side_profiles` — 从正脸闭合轮廓 + 侧面半深度曲线生成对称壳体（需要视觉 QA 检查轮廓顺序/比例）
- [x] `pipe_between_points` — 任意 3D 点管线，替代当前 `swept_path` 的 Y/斜向限制
- [x] `face_on_cylinder` — 在圆柱面上贴平按钮区域（视觉 helper，非 boolean / wrap）
- [x] `analog_stick` — 摇杆复合形体（默认轮廓 / 可自定义 profile）
- [x] `recess` — 可视化下沉凹槽 / 控制区托盘（非 boolean cut）
- [x] `slot` — 可视化长圆槽 / 开孔标记（非 boolean cut）
- [x] `boolean_cutout` — 安全 slice：矩形板上的矩形贯穿 cutout（非任意 solid boolean）
- [x] `boolean_union` / `boolean_difference` / `boolean_intersect` — 顶层实体组之间的 CAD solid boolean；queue runtime 的 difference 通过 SketchUp `Group#split` 明确保留 target-minus-tool 结果，mock runtime 记录确定性结果 metadata
- [x] `manifold_check` / `manifold_repair` — 对实体组执行 manifold report 与基础修复记录，snapshot 回传 `manifold_checks` 和对象级 `manifold`

#### 细节类 DSL 缺口

- [x] `button_on_panel` — 面板上凸起按钮（圆形 / 胶囊 / 圆角矩形）
- [x] `screw_hole` — 螺丝孔位 / 沉孔视觉标记（非 boolean cut）
- [x] `engraved_line` — 可视化刻线 / 拼缝 / 装饰槽
- [x] `text_emboss` / `text_engrave` — 默认简化凸起/凹陷文字与 logo 视觉标记；`mode: "font_outline"` / `outline: true` 可走 queue runtime 真实字体轮廓 marker（仍非 boolean cut）
- [x] `text_3d` — queue runtime 真实字体轮廓 3D text，mock runtime 稳定 bbox/metadata

#### 复用与性能

- 重复按钮/螺丝/LED 等应采用 `component_definition` + `component_instance`
- 早期 mesh 直接落 SKP 时手柄文件曾到 39MB；当前 Switch queue baseline 已通过产品 primitive / component 复用降到约 253KB，主线 `qa:budget:*` 会继续约束 face/vertex/SKP size
- [x] snapshot warning 分类：零面/退化面 `geometry.degenerate`、真实 bbox 碰撞 `geometry.bbox_collision`、接触关系内部识别但默认不输出噪声 warning

#### 图像辅助流程

- 不要从照片直接手写尺寸；应先生成可审查的 front/top/side 轮廓 overlay
- 提取外壳 silhouette、按钮中心点、摇杆/肩键/握把轮廓，再转参数模型
- → 由此立项 `projects/image-structured-modeler/`（详见该 README）

### 建筑向后续

- 多层楼、坡地、窗门族库细化、非轴向墙、参数化楼梯/栏杆
- golden examples 持续扩充到更多真实案例

### 文档/发布

- [x] 整理技术分析文章事实与术语，明确"官方云端 Python MCP"和"本地安全 JSON DSL 复刻"的边界：`docs/official-sdk-gap-summary.md`
