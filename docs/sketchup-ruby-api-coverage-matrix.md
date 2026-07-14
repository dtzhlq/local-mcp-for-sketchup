# SketchUp Ruby API Coverage Matrix

更新时间：2026-07-13

本文记录主线 MCP 对官方 SketchUp Ruby API / 官方风格 Python facade 的覆盖情况。目标不是完整复刻 Ruby extension API，而是让 Agent 建模时最高频的对象模型、集合、几何、材质、组件、视图和选择调用能安全编译到本项目 JSON DSL，并能被 mock / queue runtime 验证。

命名说明：表格里的 R2/R3 是本仓库 restricted Python facade 的内部迭代标签，不是 SketchUp 官方 Ruby/Python API 版本，也不是完整兼容等级。`official-api` fixture 与 npm script 名称暂作内部兼容标识保留。

官方参考入口：

- https://ruby.sketchup.com/
- https://ruby.sketchup.com/Sketchup/Model.html
- https://ruby.sketchup.com/Sketchup/Entities.html
- https://ruby.sketchup.com/Sketchup/Face.html
- https://ruby.sketchup.com/Sketchup/Group.html
- https://ruby.sketchup.com/Sketchup/ComponentInstance.html
- https://ruby.sketchup.com/Sketchup/Material.html
- https://ruby.sketchup.com/Sketchup/View.html

## 覆盖原则

- **优先支持建模表达**：`Model`、`Entities`、`Face`、`Group`、`ComponentDefinition`、`ComponentInstance`、`Material`、`Layer`、`Pages`、`RenderingOptions`、`ShadowInfo`、`Selection`。
- **先 facade，后 runtime**：能安全转成已有 DSL 的先转译；需要真实几何效果的再补 mock / queue runtime。
- **fail-closed**：UI、Observer、Extension 管理、文件/网络、动态反射、任意 Ruby/Python runtime 仍不开放。
- **几何效果优先**：`Face#pushpull`、受控 `Face#followme`、`Face#mesh` -> mesh op、`Entities#add_faces_from_mesh/fill_from_mesh` 都必须能进入 mock / queue runtime；mock / queue 拓扑计数允许不同，但 bbox、实体效果和 warning gate 必须可验证。

## API Coverage

| 官方类 / API 面 | 当前状态 | 本项目映射 | 本轮变化 |
|---|---:|---|---|
| `Sketchup::Model` | partial | `model.reset`、`model.units`、`model.add_*`、`model.entities/materials/layers/definitions/pages/selection/active_view/rendering_options/shadow_info` facade | 新增集合属性和官方式入口 |
| `Sketchup::Entities` | partial | `add_face` -> `geometry_input`、`add_edges/add_line` -> explicit geometry edges、`add_curve/add_arc/add_circle` -> curve ops、`add_group` -> `Group` facade、`add_instance` -> component instance、`add_3d_text` -> `text_3d`、`add_faces_from_mesh/fill_from_mesh` -> `mesh` | R3 新增 mesh/fill facade 到 runtime |
| `Sketchup::Face` | partial | `vertices/edges/loops/outer_loop/normal/plane/area`、`reverse`、material/back_material/metadata、`pushpull`、`followme`、`mesh`、`position_material/clear_texture_position/texture_positioned` | R3 新增 followme 受控 sweep、Face.mesh、position_material intent 和 runtime 应用尝试 |
| `Sketchup::Edge` | partial | `start/end/vertices/length/to_indices` | 保持 P0.1 |
| `Sketchup::Loop` | partial | `vertices/edges/is_outer/to_indices` | 保持 P0.1 |
| `Sketchup::Group` | partial | `Group(...).entities.add_face`、`set_attribute`、`transform_by`、`to_component/make_unique/explode` safe no-op / facade return | 新增 group entities facade 和 post ops |
| `Sketchup::ComponentDefinition` | partial | `model.definitions.add`、`definition.entities.add_face`、`add_geometry/add_operation`、`create_instance/add_instance` | 新增 definitions collection facade |
| `Sketchup::ComponentInstance` | partial | direct constructor、`model.entities.add_instance`、`move_to`、`transform_by`、`set_attribute`、`make_unique/explode` safe facade | 新增 object attribute/tag/material mapping |
| `Sketchup::Material` / `Materials` | partial | `Material(...)`、`model.materials.add`、`materials.count/keys/values/[]/unique_name` | 新增 collection behavior |
| `Sketchup::Layer` / `Layers` | partial | `Layer(...)`、`model.layers.add`、entity `layer=` -> `assign_tag` | 新增 collection behavior |
| `Sketchup::Pages` / `Page` | partial | `model.pages.add(...)` -> `scene`、`scene.update` safe facade、`transition_time`、`set_visibility`、`set_drawingelement_visibility`、scene-local rendering/shadow/style intent | R3 新增 Page 高级字段第一刀 |
| `Sketchup::Camera` / `View` | partial | `Camera(...)`、`look_at/set_eye`、`model.active_view.write_image` -> `image_reference`、`zoom_extents/refresh/invalidate` safe no-op | 新增 active_view facade |
| `Sketchup::RenderingOptions` | partial | constructor + `keys/each_key/each_pair` + `options["key"]` set/get -> `rendering_options` op | 新增 key-value facade |
| `Sketchup::ShadowInfo` | partial | constructor + `keys/each_key/each_pair` + `shadow["key"]` set/get -> `shadow` op | 新增 key-value facade |
| `Sketchup::Selection` | partial | `model.selection.add/remove/clear/replace/count/to_a` -> runtime `selection` op + snapshot selection；queue selection 识别 `Group` / `ComponentInstance` / top-level or active-context `Face` / `Edge` | Face/Edge 已支持识别、bbox 和几何摘要及 persistent_id 目标引用；任意子实体局部编辑仍未覆盖 |
| `Sketchup::AttributeDictionary` | partial | `entity.set_attribute/get_attribute/delete_attribute` -> `attribute` op / compile-time return | 新增 object method mapping |
| Solid boolean methods | partial | `boolean_union/difference/intersect` DSL and group/component solid ops through existing runtime | 未扩展到 arbitrary face/edge selection |
| Texture / UV | partial | `Texture/Image/ImageRep` facade、`image_reference`、`image_plane`、`face_uv` metadata、`Face#position_material` mapping | R3 新增 Face#position_material 和 face_uv 的 queue apply attempt；仍非完整 UVHelper |
| UI / Tools / Observers / Extension Manager | unsupported | blocked | 不进入主线建模表达目标 |
| Dynamic reflection / arbitrary runtime | unsupported | blocked | `dir/globals/locals/import/file/network` 继续阻断 |

## 当前验证入口

- `examples/python-sdk-official-api-coverage-fixture.py`
- `examples/python-sdk-official-api-expression-r3-fixture.py`
- `test/python-sdk-compiler.mjs`
- `output/python-sdk-official-api-coverage-mock.json`
- `npm run qa:official-api-r3:mock`
- `npm run qa:official-api-r3:queue`
- `node test/python-sdk-compiler.mjs`：`official_api_r3_operations=12`，mock snapshot 为 5 groups / 16 faces / warnings 0
- R3 live queue：`output/python-sdk-official-api-expression-r3-queue.json` 为 5 groups / 10 faces / 29 edges / 25 vertices / selection 1 / scene 1 / warnings 0，并保存 `output/python-sdk-official-api-expression-r3.skp`。

## 仍待覆盖

- `Face#get_UVHelper`、`uv_tile_at`、投影贴图和更完整的 Texture/ImageRep 数据面。
- `Page#update(flags)` 的完整 flags 语义、section plane、axes/environment 字段。
- `EntitiesBuilder`、`intersect_with`、`transform_by_vectors` 等更偏底层/高性能的 Entities API。
- `all_connected`、`classify_point`、`coplanar_with?` 等几何查询只适合继续做受控 query facade，不进入任意 Ruby runtime。
