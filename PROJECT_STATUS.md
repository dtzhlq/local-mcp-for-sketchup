# SketchUp MCP Replica — 项目状态与计划

> 更新日期：2026-05-30
> 当前状态：技术预览闭环已验证；阶段 7 主线 feature slice、CAD boolean/manifold、子项目 semantic fusion / corrections workbench 与 feature mapping 第一刀已完成；ProductProfile / PartGraph / Reference Visual QA 管线已闭环，ambulance 第一轮参考图锚定 visual-quality refit 已完成并通过 mock/queue；R5 已完成 ambulance + Switch + Fuji 三样本 mock + live queue 产品报告并保存 queue `.skp` artifacts；R6 已给 ambulance no-seed skeleton 增加 review-gated 参数提案，打通 accepted proposal -> `part_graph_correction_patch` -> PartGraph 回写，补上参数提案 review UI，并把 proposal-applied mock/queue QA 复验链接上；REST3D 启发的 physical consistency QA 已扩到 ambulance、Switch、Fuji 三样例并进入产品样本 gate；Reference Visual QA 已新增 orientation/chirality 门禁，Image Structured observations 已记录 mirror-risk hints；正式发布继续暂停，下一轮进入 R7 建筑群照片建模，并继续压低模板/视觉辅助比例

---

## 1. 项目定位

用**安全 JSON DSL + 本地 Node bridge + stdio MCP server + SketchUp Ruby queue plugin** 复现 Claude 官方 SketchUp Connector 的核心体验。

**不是**官方 Cloud MCP（不做 OAuth、云端 session、download URL），**是**本地可控替代方案：安全、可测、可回归。

### 2026-05-27 验收复盘后的发布判定

本轮用儿童房、救护车、Switch 手柄和 Fuji 相机测试图做了更接近真实使用的验收。结论是：当前系统已经能稳定表达和保存“结构化展示模型”，但还不适合作为正式发布版本宣传为照片/多图到可编辑产品模型。

主要原因：

- 真实编辑能力已经补上阶段 7 主线闭环：`target_id + face + depth/through` 的受控 feature operations 之外，新增了顶层实体组的 `boolean_union` / `boolean_difference` / `boolean_intersect` 和 `manifold_check` / `manifold_repair`。它是本地 DSL 的 CAD boolean/manifold 能力，不等同于官方云端 Python SDK 或无限制 CAD kernel。
- 模型表达仍可能退化成“盒体/曲面/贴面组合”，遇到车顶筋线、门缝、凹槽、凸起、孔洞时，已经有第一版特征级编辑语义；救护车样例已用当前 feature/boolean/manifold 能力重跑并通过 live queue，但还需要更多产品样例复验。
- 图像理解还不能可靠判断凹/凸/贴花/开孔。救护车验收模型是人工综合多图后手写 DSL；它证明 MCP 能表达综合后的模型，不证明自动管线已有多图统一建模能力。
- Image Structured Modeler 的 Switch 链路目前是“多图输入 + 视角分类 + Switch layout prior 模板化生成”，不是跨图联合推理后反求几何。单图批量测试也能生成完整模型，进一步说明模板补全权重过高。
- Queue runtime 已补 active model 防护第一版；新 boolean/manifold 插件已完成 live capability handshake、queue 单例验证和救护车重跑。正式发布仍需要用这些能力重跑更多产品类验收。

因此当前发布状态仍为：**技术预览可演示，正式发布暂停**。主线受控 feature operations、CAD boolean/manifold 与 queue active model 防护已补齐；Image Structured Modeler 已补齐 observation/model-plan/review evidence graph、`review.semantic_fusion` 跨图语义融合层、交互式 corrections workbench，以及 compact remote 的真实 feature mapping 第一刀。R5 已让救护车、Switch 与 Fuji 进入 `ProductProfile -> PartGraph -> DSL -> Layout QA + Reference Visual QA` 样本报告，并通过 mock + live queue 批量 gate；R6 已把 ambulance no-seed 图像证据转成 review-gated 参数提案，把已接受提案转成 correction patch，提供 proposal review HTML 来导出 accepted proposal JSON，并新增 proposal-applied mock/queue 复验链来证明部分接受的 no-seed skeleton 仍会被 QA 留在 review-gated 状态。Physical consistency QA 已把 ambulance、Switch、Fuji 的支撑/贴合/接地关系加入 PartGraph gate，并通过漂移负例验证 `update_part_graph` correction target。Reference Visual QA 现在会显式检查 orientation/chirality，图像 observation 也会记录左右/前后 mirror-risk hints，避免把视觉识别里的左右判断静默传成模型布局。下一轮进入 R7 建筑群照片建模，并继续降低模板/视觉辅助比例。

---

## 2. 架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   MCP Client    │────▶│  mcp-server.mjs  │────▶│   bridge.mjs    │
│   (Alma/Claude) │     │  (stdio MCP)     │     │  (工具路由层)    │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                               ┌──────────────────────────┼──────────────────────────┐
                               │                          │                          │
                               ▼                          ▼                          ▼
                    ┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
                    │  mock-runtime   │        │ queue-runtime   │        │  capabilities   │
                    │  (离线可验证)    │        │ (SketchUp Ruby) │        │   manifest      │
                    │ operation mods  │        │  文件队列+JSON  │        │  docs.mjs       │
                    └─────────────────┘        └─────────────────┘        └─────────────────┘
                                                          │
                                                          ▼
                                               ┌─────────────────┐
                                               │ alma_sketchup_  │
                                               │   mcp.rb        │
                                               │ (SketchUp 插件)  │
                                               └─────────────────┘
```

### 核心文件地图

| 文件 | 职责 |
|---|---|
| `src/mcp-server.mjs` | stdio MCP server，暴露 9 个工具 |
| `src/bridge.mjs` | 工具路由层，mock/queue 分发、runtime descriptor 附加、compatibility check 和 bridge 生命周期内 descriptor cache |
| `src/mock-runtime.mjs` | 离线 runtime，解析 DSL operation → 调用 material / primitive / profile / surface / product / architecture / component / view / object operation modules |
| `src/queue-runtime.mjs` | 队列 runtime，写 JSON 请求到 `~/.sketchup-mcp-replica/queue/` |
| `src/geometry.mjs` | mock runtime operation modules 的兼容聚合导出入口 |
| `src/model-state.mjs` | mock runtime 空 session/model state |
| `src/operation-utils.mjs` | mock runtime 通用字段归一化、transform、camera、QA metadata helper |
| `src/material-operations.mjs` | mock runtime material/PBR/texture 字段记录 |
| `src/primitive-operations.mjs` | mock runtime mesh、prism、cylinder 和 profile plane/prism vertices helper |
| `src/profile-operations.mjs` | mock runtime panel/openings、boolean_cutout、profile face/extrude、roof helper |
| `src/surface-operations.mjs` | mock runtime loft/shell/sweep/screw/domed/bowed 等曲面 helper |
| `src/product-operations.mjs` | mock runtime box/product helper：rounded/recess/slot/rib/boss/image/text 等 |
| `src/architecture-operations.mjs` | mock runtime 建筑 helper：level、floor/wall/stairs/railing |
| `src/demo-operations.mjs` | mock runtime demo room helper |
| `src/component-operations.mjs` | mock runtime component_definition / component_instance 和 transform placement |
| `src/view-operations.mjs` | mock runtime camera/scene/style/shadow/rendering 操作 |
| `src/snapshot.mjs` | mock runtime snapshot、warning summary、bbox 合并和碰撞 warning |
| `src/model-qa.mjs` | 无 GUI 的语义布局 QA、正交 SVG/HTML preview、correction suggestions |
| `src/object-operations.mjs` | mock runtime 对象编辑、Tags、attributes、classification、texture transform、transform_object |
| `src/object-identity.mjs` | mock runtime 对象 id、target 引用、唯一性和 box/orientation 基础 helper |
| `src/object-operation-utils.mjs` | object operation 字段归一化和 snapshot attribute helper |
| `src/boolean-operations.mjs` | mock runtime solid boolean / manifold check-repair metadata |
| `src/expert-compiler.mjs` | Expert Mode v1 受限脚本 AST 解释器，编译为标准 JSON DSL |
| `src/capabilities.mjs` | 单一真源 operation registry，74 个 operation 的支持状态/稳定性/schema/component-scope |
| `src/snapshot-diff.mjs` | snapshot 对比 QA：totals、bbox、materials、groups、instances、levels、scenes |
| `sketchup_plugin/alma_sketchup_mcp.rb` | SketchUp 2026 Ruby 插件，读队列、执行 DSL、返回 snapshot |
| `sketchup_plugin/alma_sketchup_mcp/operation_registry.rb` | 由 `src/capabilities.mjs` 生成的 Ruby queue runtime operation support 表 |
| `sketchup_plugin/alma_sketchup_mcp/object_operations.rb` | Ruby queue runtime 对象编辑、Tags、attributes、classification、texture transform、transform_object |
| `sketchup_plugin/alma_sketchup_mcp/materials.rb` | Ruby queue runtime 材质、PBR、基础贴图与 image plane material helper |
| `sketchup_plugin/alma_sketchup_mcp/geometry_operations.rb` | Ruby queue runtime 共享 geometry/entity helper |
| `sketchup_plugin/alma_sketchup_mcp/primitive_operations.rb` | Ruby queue runtime mesh/prism/cylinder |
| `sketchup_plugin/alma_sketchup_mcp/product_operations.rb` | Ruby queue runtime box/product helper |
| `sketchup_plugin/alma_sketchup_mcp/profile_operations.rb` | Ruby queue runtime panel/profile/roof helper |
| `sketchup_plugin/alma_sketchup_mcp/surface_operations.rb` | Ruby queue runtime loft/shell/sweep/domed/bowed helper |
| `sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb` | Ruby queue runtime SketchUp solid boolean / manifold check-repair |
| `sketchup_plugin/alma_sketchup_mcp/demo_operations.rb` | Ruby queue runtime demo room helper |
| `sketchup_plugin/alma_sketchup_mcp/architecture_operations.rb` | Ruby queue runtime 建筑 helper：level/floor/wall/stairs/railing |
| `sketchup_plugin/alma_sketchup_mcp/component_operations.rb` | Ruby queue runtime component_definition / component_instance 和 transform placement |
| `sketchup_plugin/alma_sketchup_mcp/view_operations.rb` | Ruby queue runtime camera/scene/style/shadow/rendering 操作 |
| `sketchup_plugin/alma_sketchup_mcp/snapshot.rb` | Ruby queue runtime snapshot、计数、材质/tag 快照和 bbox warning |
| `docs/queue-runtime-ops.md` | Queue 手动验收清单、安装检查与故障排查 |
| `docs/performance-budgets.md` | 性能基准、face/vertex/SKP size 阈值和预算报告入口 |
| `docs/expert-mode.md` | Expert Mode v1 允许语法、禁止项、限制和验证方式 |
| `docs/release-checklist.md` | 技术预览打包检查、插件安装、queue 回归、RBZ 打包和提交切片建议 |
| `docs/product-modeling-architecture-refactor-plan.md` | 产品建模架构重构计划：ProductProfile / PartGraph / Reference Visual QA |
| `test/mock-validation.mjs` | 离线回归测试 |
| `test/expert-compiler.mjs` | Expert Mode v1 编译、mock build 和安全拒绝测试 |
| `test/mcp-server.mjs` | stdio MCP server tools/list 和 tools/call 回归测试 |
| `test/queue-runtime-lock.mjs` | queue runtime 跨进程串行锁和 timeout 清理测试 |
| `scripts/generate-ruby-operation-registry.mjs` | 从 JS operation registry 生成 Ruby runtime contract 表 |
| `scripts/generate-qa-reports.mjs` | 批量 golden example mock/queue 对照 |
| `scripts/generate-expert-qa-reports.mjs` | Expert Mode 发布回归：编译、runtime build、artifact 保存、warnings 和预算报告 |

---

## 3. 阶段完成状态

### ✅ 阶段 0 — 能力基线（已完成）
- Operation manifest（`capabilities.mjs`）
- Mock/queue 支持状态矩阵
- Snapshot schema + runtime descriptor + compatibility check
- Warning 分类（degenerate、collision、contact、missing texture 等）
- `docs/official-sdk-gap-summary.md` 明确与官方 Cloud MCP 的边界

### ✅ 阶段 1 — Runtime 同步骨架（基本完成）
- Queue capability handshake：插件回传版本、op 列表、compatibility
- `compare_model`：一键 mock-vs-queue 对照
- `validate_model`：无 GUI 的语义布局 QA，可生成正交 SVG/HTML preview 和 correction suggestions
- QA 报告生成（JSON + Markdown）
- 批量 golden regression：`npm run qa:mock` / `npm run qa:queue`

### ✅ 阶段 2 — DSL v1.1 核心表达力（技术预览残项已收口）

**已完成与验证状态：**
- `delete`、`rename`、`set_material`、`set_visibility`
- 对象身份第一切片：group / component instance snapshot 回传 `id`，编辑操作支持 `target_id`，旧 `name` 引用保持兼容
- 对象身份补强：mock/queue 创建侧强制同 scope 内 `id` / `name` 唯一；编辑操作同时传 `target_id` 和 `name` 时必须匹配同一对象
- `examples/editing-identity.json`：专门覆盖 `id -> rename -> set_material -> transform -> visibility/delete` 编辑链
- 对象身份 live queue 验收：`npm run qa:identity:queue` 已通过，mock/queue diff 为 0
- `transform_object`：translate、rotateX/Y/Z、任意模型空间 `axis + angle`、对象本地轴 `local_axis + local_angle`、SketchUp-compatible 16-number `matrix`、本地坐标系 `local_matrix`、scale、mirror；matrix/local_matrix snapshot 会回传 translation、basis axes、scale、shear、determinant、mirrored、affine/non-affine reasons、homogeneous perspective terms，并在纯正向旋转兼容时回传 Euler XYZ degrees
- `transform_object` pivot：默认 origin、`"center"`、显式 `[x,y,z]`
- `face_with_holes`、`profile_extrude` 通用 profile 第一切片：支持简单闭合多边形 outer + 多边形 holes，拒绝自交、触边和重叠洞；已通过 mock/queue 对照验证
- Operation contract 测试：manifest、mock runtime、Ruby queue runtime、component_definition dispatch 覆盖自动校验
- Operation registry / runtime contract 单一注册表化：`src/capabilities.mjs` 作为唯一 operation registry，manifest、runtime `operation_support`、schema、component-scope、docs matrix、contract tests 均从 registry 派生；当前 74 个 operation，42 个 component_definition-scoped operation

**待做（P1）：**
- [x] 二次编辑的 chain 支持：新增 `examples/transform-chain-regression.json`，连续多个 `transform_object` 叠加时的 center pivot、本地轴、模型轴、平移和 matrix 已通过 mock/queue 对照验证。
- [x] 通用 profile 扩展覆盖：新增凹多边形、多洞、竖向 profile、component_definition 内嵌 profile 和失败样例；已通过 mock/queue 对照验证。
- [x] 更完整 transform：模型轴、本地轴、模型空间 4x4 matrix、连续 chain、`local_matrix`、matrix decomposition、Euler/非仿射报告均已覆盖 mock 回归；queue runtime 同构写入 metadata，插件文件已安装，待 SketchUp 重启/Bridge 响应后做 live 单例复验。

### ✅ 阶段 3 — 高频几何 helper（大量提前完成）

**已完成并通过 mock/queue 验证：**
- `rounded_box`、`beveled_panel`、`fillet`、`chamfer`
- `recess`、`engraved_line`、`slot`、`slot_array`
- `text_emboss`、`text_engrave`
- `button_on_panel`、`analog_stick`、`screw_hole`
- `pipe_between_points`、`loft_between_profiles`
- `face_on_cylinder`、`shell_from_front_side_profiles`
- `boolean_cutout`（安全 slice：矩形板 + 矩形贯穿孔）
- `rib`、`standoff_boss`

**可选后续（不优先）：** `counterbore`、`through_hole`、`chamfered_prism`

### ✅ 阶段 4 — 组织、材质、视图（技术预览残项已收口）

**已完成：**
- `scene`、`style`、`shadow`、`rendering_options`
- `material`：color、alpha、texture、PBR（metallic/roughness/normal/ao/opacity）
- `tag` / `assign_tag`：SketchUp Tags/Layers 组织模型对象，已通过 mock/queue 对照验证；`reset` 会 purge 未使用 Tags，默认 `Untagged/Layer0` 不作为业务 tag 回传
- `attribute`：给 group / component instance 写入并回传 JSON-compatible metadata，已通过 mock/queue 对照验证
- `classification`：给 group / component instance 写入 BIM/classification metadata，snapshot 回传一等 `classification` 字段，并镜像到 SketchUp `Classification` attribute dictionary；已通过 mock/queue 对照验证
- `texture_transform` / `uv_project_planar` / `uv_project_box`：给 group / component instance 写入贴图投影、offset、scale、rotation metadata，snapshot 回传一等 `texture_transform` 字段，并镜像到 SketchUp `TextureTransform` attribute dictionary；已通过 mock/queue 对照验证
- `image_plane`：创建平面参考/贴图面，支持顶层与 component_definition 内嵌；已通过 mock/queue 对照验证
- `text_3d`：新增真实字体轮廓 3D text operation；queue runtime 调 SketchUp `Entities#add_3d_text`，mock runtime 回传稳定估算 bbox 与 `Text3D` metadata；已通过 mock/contract/plugin checks、live `get_capabilities`、`examples/text-3d-slice.json` queue 构建、全量 `qa:queue` 和 `qa:budget:queue`
- `text_emboss` / `text_engrave`：保留默认 block marker；新增 `mode: "font_outline"` / `outline: true`，queue runtime 走 SketchUp `Entities#add_3d_text` 生成真实字体轮廓 raised/recessed marker，mock runtime 回传稳定 bbox 和 `Text3D` metadata；仍不声明 solid boolean union/subtraction
- `component_definition` / `component_instance` 基础复用

**待做：**
- [x] 字体参数扩展与真实字体轮廓 emboss/engrave marker 已完成；solid boolean text union/subtraction 归入长期 CAD roadmap，不作为阶段 4/5 发布阻塞项。

### ✅ 阶段 5 — Expert Mode v1（技术预览收口完成）

允许受限脚本生成 JSON DSL，而非直接手写 DSL。形态：
- 允许：变量、函数、for 循环、数组、map/filter/flatMap/reduce、数学/向量 helper、seeded random、批量 component_instance
- 禁止：文件系统、网络、shell、import/require、eval、直接调用 SketchUp API、无限循环、超大 op 数

**已完成：**
- `src/expert-compiler.mjs`：基于 `acorn` parse 的 AST 白名单解释器，不执行原始脚本；脚本最后一个表达式必须输出 `operations` 数组或 `{ version, units, operations }`
- CLI/bridge：`compile_expert` 可输出标准 JSON DSL，`build_expert_model` 先编译再复用现有 `build_model`
- MCP tool 面：stdio server 的 `tools/list` 暴露 `compile_expert` / `build_expert_model`，`tools/call` 走同一 bridge 方法
- 内置 helper：`range`、seeded `random`/`rand`、`clamp`、`lerp`、`rad`、`deg`、`vec.add/sub/scale/mid/lerp/dot/cross/length/distance/norm/normalize`、扩展白名单 `Math` 函数、`dsl`
- 限制：`maxOperations`、`maxLoopIterations`、`maxStatements`、`maxOutputBytes`、`expertTimeoutMs`
- `examples/expert-parametric-fixture.js`：参数化底板 + component definition + 3x4 component instance 阵列 + `text_3d`
- `test/expert-compiler.mjs`：覆盖编译、mock build、seed 稳定性和拒绝 `require` / 超 loop / 超 op / 缺 required field / component 内非法 op / `while`
- `test/mcp-server.mjs`：启动真实 stdio MCP server 子进程，验证 `tools/list` 与 `tools/call compile_expert/build_expert_model`
- live queue 单例：SketchUp Bridge 重启后 `get_capabilities --runtime queue` compatibility `ok`；`build_expert_model --runtime queue --code-file examples/expert-parametric-fixture.js --seed 7` 构建成功，输出 `output/expert-parametric-queue.json`，snapshot 为 739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances，warnings 0
- 发布回归脚本：新增 `npm run qa:expert:mock` / `npm run qa:expert:queue`，输出 `output/qa-reports/expert-mock` / `output/qa-reports/expert-queue`
- Expert QA 验证：`qa:expert:mock` Verdict `pass`，19 compiled ops、562 faces / 1548 edges / 2 groups / 12 instances、warnings 0；`qa:expert:queue` Verdict `pass`，19 compiled ops、739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances、warnings 0，SKP artifact 约 `168KB`

**待做：**
- [x] 已按真实参数化样例补更多白名单 helper；后续新增仍按 helper 白名单演进，不放宽到任意 JS 执行。

### ✅ 阶段 6 — 技术预览收口（已完成，正式发布暂停）

**已有：**
- Golden examples（architecture / product / structured-helpers / editing-transform-profile / profile-edge-cases / transform-chain-regression / metadata-organization / appearance-texture / text-3d / expert-parametric）
- Gap summary 文档
- Queue 手动验收清单与 troubleshooting：`docs/queue-runtime-ops.md`
- 性能 / SKP size budget：`docs/performance-budgets.md`，`npm run qa:budget:mock` / `npm run qa:budget:queue`
- Release checklist 与插件打包入口：`docs/release-checklist.md`，`npm run plugin:check` / `npm run plugin:install` / `npm run plugin:package`
- Registry sync：`src/capabilities.mjs` 生成 `sketchup_plugin/alma_sketchup_mcp/operation_registry.rb`，`npm run registry:check` 纳入 `npm test` 与插件检查
- Queue runtime 串行锁：Node 侧使用 `~/.sketchup-mcp-replica/queue-runtime.lock` 防止多个 queue 命令互相插入
- Mock regression + queue QA 报告
- Image-to-structured Switch controller baseline：mock/queue snapshot report、warning budget、0 geometry warning、mock/queue diff pass
- Image-to-structured correction-driven regression：`manual-corrections.regression.json` 会验证人工修正进入 model plan 和 compiled DSL
- Image-to-structured 第二产品样例：`examples/compact-remote` 通过 `object_profile` 走独立生成/编译路径，并生成 review + mock/queue snapshot，mock warnings 0，queue 仅有 3 个已分类 PBR limitation warning

**后续 polish：**
- [x] Review/corrections authoring 工作台
- [x] R5 产品样本扩展：Fuji X-T10 相机已从第一版高 fallback 精修到 feature intent + structured primitive 表达，并与 ambulance / Switch 一起通过 mock + live queue 批量产品报告

**发布判定调整：**

阶段 6 的自动化回归和 queue 基线仍然有效，但“发布级”表述不再准确。本轮验收说明当前版本只能作为技术预览：运行链路、mock/queue 对照、示例构建、evidence graph、semantic fusion、corrections workbench、feature mapping 第一刀、主线 CAD boolean/manifold 和 R5 三产品样本 gate 已经站住；真实产品建模还需要更多 no-seed 图像证据、更多产品/场景边界和更低模板依赖。

### ✅ 阶段 7 — 真实特征编辑、CAD boolean/manifold 与图像侧语义融合（主线/子项目第一刀完成）

目标：把系统从“结构化展示模型”推进到“可审查、可编辑、可逐步逼近照片对象的产品模型”。

**7.1 主线 MCP：真实特征编辑前置切片**

- [x] 新增 `cut_hole`、`cut_slot`、`cut_recess`、`add_boss`、`add_raised_rib` feature operations。
- [x] 操作接口以 `target_id` 为中心，显式指定 `face` / `plane` / `center` / `size` / `radius` / `depth` / `through`；feature 自身使用 `feature_id`。
- [x] 第一版覆盖受控目标：`box`、`rounded_box`、`panel_with_openings`、`boolean_cutout`、`floor_slab`、`wall` 的轴对齐平面面；mock/queue 均记录 `features` metadata。
- [x] Queue runtime 使用 SketchUp face `pushpull` 在目标 group 内执行受控面级特征；mock runtime 同步记录拓扑变化和 feature metadata。该能力不是通用 CAD boolean / manifold kernel。
- [x] 新增 `examples/feature-editing-slice.json` 与 mock 回归，覆盖孔、长圆槽、浅凹坑、凸台和凸筋。

**7.2 Queue runtime 稳定性**

- [x] Ruby 插件 `reset_model` / `build_model` / `save_model` / `snapshot` 统一使用 `active_model_or_new` / 明确错误，不能对 nil model 调 `start_operation`。
- [x] `get_capabilities` 之外可复用 `reset_model` 作为可编辑模型健康检查。
- [ ] 子项目 queue 批处理前先跑 `reset_model` 健康检查；失败时给出可恢复说明，而不是进入长批量。
- [x] 相对保存路径统一在 Node 侧解析为绝对路径，避免 SketchUp 把产物写到 `~/Documents/output`。

**7.3 Image Structured Modeler：图像侧语义融合**

- 已完成第一层证据化：`observations.json` 原生保存 `evidence_graph`，`model-plan.review.evidence_graph` 优先合并 observation graph，并把 per-part required/confirmed/missing views、sources、conflicts 和 open questions 展示到 review artifact。
- 已完成 graph-based 跨图语义融合：`model-plan.review.semantic_fusion` 按 part 记录 `status`、`decision`、`confidence`、required/confirmed/missing/source views、semantic evidence、feature mapping、conflict signals 和 review flags。
- `model-plan.json` 每个 part 必须记录来源：哪个视图确认轮廓、哪个视图确认厚度、哪个视图确认按钮/开孔/凹槽/凸起。
- 已增加凹凸/贴花/开孔语义表达：`concave`、`convex`、`flush`、`decal/printed`、`through_hole`、`blind_recess`，并在无法映射到真实 feature operation 时记录 `feature_mapping_fallback`。
- compact remote 已完成第一版真实映射：凸起按钮/摇杆编译为 `add_boss` / `add_raised_rib`，blind recess grille 编译为 `cut_recess`；`decal_printed` brand label 仍显式保留 `text_3d` visual fallback，并有 manual correction regression 可切换到真实 `cut_recess`。
- 冲突和不确定性进入 `review.open_questions`，不能被模板静默补全。
- Switch profile 继续保留，但必须降低模板权重：单图不应默认生成和多图同等完整的高置信模型。

**7.4 人工修正闭环产品化**

- `manual-corrections.json` 升级为正式 authoring surface 的数据层，支持 part 参数、视图证据、凹凸语义、feature mapping。
- `review/index.html` 已显示 part id、证据图、semantic fusion、当前参数、建议 correction patch 和不确定性，并提供 Corrections Workbench：可选择建议、编辑 JSON、校验、复制和下载 `manual-corrections.workbench.json`。
- correction-driven regression 扩展到图像侧语义融合、凹凸语义和 feature operations，不只验证按钮数量/位置。

**7.5 主线 MCP：CAD boolean/manifold**

- [x] 新增 `boolean_union`、`boolean_difference`、`boolean_intersect`，以 top-level solid group 为目标，支持 `target_id` / `target` 与 `tool_id` / `tool_ids` / `tools` 稳定引用。
- [x] Queue runtime 使用 SketchUp `Group#union` / `Group#intersect`，`boolean_difference` 使用 `Group#split` 并显式保留 target-minus-tool 结果；执行后记录 `AlmaBoolean.operations_json`。
- [x] Mock runtime 提供确定性 solid boolean metadata、bbox/totals 估算和 input 消耗逻辑，便于离线 contract/QA。
- [x] 新增 `manifold_check` / `manifold_repair`，snapshot 回传 top-level `manifold_checks` 和对象级 `manifold` report；repair 支持 cleanup 与 seal-bbox fallback 记录。
- [x] 新增 `examples/boolean-manifold-slice.json`，覆盖 difference -> union -> intersect -> check -> repair 的完整链路。

**7.6 下一轮验收门槛**

- Switch：图像侧语义融合输出一个模型，part evidence 可追溯；mock/queue geometry warning 为 0；主要孔槽/凸筋不再仅靠贴面 marker。
- 救护车：第一轮参考图锚定 visual-quality refit 已完成；后续验收要继续检查从多图证据中融合出的侧窗、车顶筋线、警灯、后窗、门缝，并区分贴花和实体特征。
- 儿童房：继续作为场景表达能力验收，但不得掩盖产品特征编辑缺口。
- 自动验收：新增的 `validate_model` / `npm run qa:model-layout` 必须作为大样例验收门槛，避免只靠人工打开 SketchUp 做视觉复核。
- 文档：README / status / release checklist 只能声明已验证能力，不能暗示已经支持照片级重建或官方完整 CAD kernel。

---

## 4. 待办优先级（验收复盘后）

| 优先级 | 任务 | 原因 |
|---|---|---|
| **done** | Queue active model 防护 | Ruby 入口已统一 `active_model_or_new`，Node queue save path 已绝对化 |
| **done** | 真实特征编辑第一 slice | `cut_hole` / `cut_slot` / `cut_recess` / `add_boss` / `add_raised_rib` 已进入 registry、mock runtime、Ruby queue runtime 和 mock 回归 |
| **done** | 文档发布措辞修正 | 当前只能声明技术预览，不能继续写“发布级收口完成” |
| **done** | Image Structured 图像侧语义融合 | `review.semantic_fusion` 已贯通 model-plan/review/test，记录 per-part status、decision、confidence 和跨视图 signals |
| **done** | 凹凸/贴花/开孔真实映射第一 slice | compact remote 已把 image semantics 映射到 `cut_recess` / `add_boss` / `add_raised_rib`，并保留 decal fallback 与 correction regression |
| **done** | Review/corrections authoring | review HTML 已提供可交互选择、编辑、校验、复制和下载 corrections JSON 的工作台 |
| **done** | Ambulance visual-quality refit 第一轮 | 参考图锚定 QA 已能打回旧 seed 模型，并通过 PartGraph 修正让新模型同时通过 layout/reference QA |
| **done** | R5 Switch 样例扩展第一刀 | Switch 已迁移到 ProductProfile + PartGraph + compiled DSL，并进入 Reference Visual QA 与 `qa:product-samples` fallback-ratio 报告 |
| **done** | R5/R6 Fuji 第三样例精修 | Fuji X-T10 已接入 ProductProfile + PartGraph + compiled DSL + layout/reference QA + `qa:product-samples`，并通过 live queue；当前 33 parts，补上镜头分段/镜头盖夹片、FUJIFILM/X-T10 文字、拨盘标记和后背独立按钮 detail gate |
| **done** | Queue 产品样本批量报告 | `npm run qa:product-samples:queue` 已覆盖 ambulance / Switch / Fuji 三样本，并保存三份 queue `.skp` artifacts |
| **done** | R6 proposal review 复验链 | `image-structured:proposal-review-chain-ambulance` / `:queue` 已覆盖 accepted proposal -> patch -> proposal-applied DSL -> QA；当前只接受 body/cab 两项时输出 `review_required: true` 并保存 queue `.skp` |
| **done** | Image Structured evidence layer | observations/model-plan/review/per-image summary 已记录 evidence graph、missing views、feature fallback 和 correction patch skeleton |
| **done** | Transform / runtime / Expert / registry / QA 基线 | 这些仍是有效基础能力，但不再代表正式发布完成 |

---

## 5. 最近的验证记录

- **2026-05-30**：R5 Product Sample Expansion 完成并补 Fuji visual refit：`scripts/generate-product-sample-reports.mjs` 增加 `--runtime queue`、`--timeout-ms` 和 artifact 保存，`npm run qa:product-samples` 与 `npm run qa:product-samples:queue` 都覆盖 ambulance、Switch 和 Fuji。三样本 live queue batch 全部通过 layout QA、Reference Visual QA 和 physical consistency，并保存 `output/product-sample-qa/queue/artifacts/ambulance-reference.skp`（57 groups / 1151 faces / 3032 edges / 5,239,717 bytes）、`switch-controller-reference.skp`（70 groups / 2986 faces / 5598 edges / 376,145 bytes）和 `fuji-camera-reference.skp`（33 groups / 1315 faces / 3244 edges / 289,860 bytes）。Fuji PartGraph 已加入 body/top/viewfinder feature intents、`structured_primitive` fallback state，并补上镜头分段/镜头盖夹片、FUJIFILM/X-T10 文字、顶部拨盘标记和后背独立按钮；Reference Visual QA 会检查这些 detail。当前 Fuji fallback ratios 为 `real_feature_op 0.091`、`structured_primitive 0.667`、`box_approximation 0.03`、`visual_helper 0.212`，scale confidence `0.58`。该样例扩大了产品形态覆盖，但仍不代表复杂相机照片级建模已经达标。
- **2026-05-30**：R6 no-seed 参数提案完成（当前边界）：`schema/part-graph.schema.json`、`generate-part-graph-from-observations.mjs`、`validate-part-graph-quality.mjs` 和 `test:image-structured` 已接入 `parameter_proposals`。Ambulance no-seed `part-graph.skeleton.json` 现在覆盖 7 个 profile-required parts、20 条 review-gated proposal；每条记录 PartGraph path、当前值、建议值、置信度、图像尺度校准、bbox/keypoint measurement 和 `review_required`。Seed generated PartGraph 记录 45 条 proposal，质量报告新增 `parameter_proposals=45`、`parameter_proposal_parts=17`、`review_required_parameter_proposals=25`。该切片只把 no-seed 图像证据转成可审查候选参数，不会自动把 inferred-only 几何升级为可信模型。
- **2026-05-30**：R6 proposal-to-patch authoring 完成（当前边界）：新增 `buildCorrectionPatchFromParameterProposals`、`projects/image-structured-modeler/scripts/build-part-graph-proposal-patch.mjs`、`npm run image-structured:proposal-patch-ambulance` 和 `parameter-proposal-review.accepted.json` fixture。当前 fixture 只接受 no-seed skeleton 的 `main_body` 与 `cab` shape 参数 proposal，生成 `correction-patch.parameter-proposals.json`（2 个 `set` edits，source `parameter_proposal_review`），并应用到 `part-graph.proposal-applied.json`；被应用 part 会标记 `evidence_status=manual_confirmed`、追加 `parameter_proposal_review` evidence，并写入 `qa.parameter_proposal_applied=true`。这仍是可审查子集回写，不是自动应用全部 no-seed proposal。
- **2026-05-30**：R6 proposal review UI 完成（当前边界）：新增 `projects/image-structured-modeler/scripts/make-part-graph-proposal-review.mjs` 与 `npm run image-structured:proposal-review-ambulance`，会读取 ambulance no-seed skeleton、accepted review fixture 和已生成 patch，输出 `projects/image-structured-modeler/examples/ambulance/proposal-review/index.html`。该 HTML 展示 20 条 review-gated proposal、预选已接受的 `main_body` / `cab` shape 参数、patch target 摘要，并可导出 `parameter-proposal-review.accepted.json` 结构；`test:image-structured` 已覆盖该产物。
- **2026-05-30**：R6 proposal review -> patch -> QA/queue 复验链完成：新增 `projects/image-structured-modeler/scripts/run-proposal-review-qa.mjs`、`image-structured:compile-ambulance-proposal-applied`、`image-structured:proposal-review-chain-ambulance` 和 `image-structured:proposal-review-chain-ambulance:queue`。链路会重建 accepted proposal patch、刷新 proposal review HTML、编译 `part-graph.proposal-applied.json` 到 `output.proposal-applied.json`，再跑 layout QA、Reference Visual QA 和 physical consistency。当前 fixture 只接受 `main_body` / `cab` 两项，mock 与 queue 报告都为 `review_required: true`：layout 32 errors、reference visual 32 errors、physical consistency pass；queue 版保存 `output/image-structured-ambulance-proposal-applied.skp`（12 groups / 211 faces / 596 edges / 5,136,145 bytes）。这条链路证明 review UI 输出已接到 runtime QA，但也明确它不是完整 product acceptance。
- **2026-05-30**：R6 physical consistency QA 收口完成：新增 `src/product-modeling/physical-consistency-qa.mjs`、`scripts/generate-physical-consistency-reports.mjs`、`npm run qa:physical-consistency` 和 PartGraph schema 的 `physical_relations`，并把 gate 接入 `qa:product-samples`。当前三样例全部 pass：ambulance 26 条关系（侧窗/条纹/灯具/车顶件/车轮/轮毂/接地）、Switch 25 条关系（左右手柄壳体、面板、肩键/扳机、摇杆堆叠、按键支撑）、Fuji 30 条关系（top plate/body、viewfinder/top plate、top dials/top plate、hotshoe/top plate、front grip/body、lens stack、镜头环/镜头盖夹片、肩带扣、后目镜、后背屏幕/按钮和快门按钮）。新增回归会分别拉开 ambulance 侧窗、Switch 摇杆帽、Fuji 镜头段和 Fuji 后背细节按钮，验证 physical QA fail 并给出 `update_part_graph ...shape.parameters.origin` correction suggestion。
- **2026-05-30**：Reference Visual QA 镜像/手性门禁补齐：`schema/reference-visual-qa.schema.json` 与 `src/reference-visual-qa.mjs` 新增 `orientation` 规则组，支持 `left_of` / `right_of` / `above` / `below` 和 `min_delta`，当前 ambulance、Switch、Fuji reference spec 都加入了左右/上下方向锚点。新增 Switch 镜像负例会把左右摇杆 X 坐标对调，验证即使尺寸/距离仍近似，也会被 `reference.orientation_order` 打回并给出 `update_part_graph` correction target。Image Structured observation schema 与 `image-analysis.mjs` 同步新增 `orientation_hints`，记录 `image_x_right_y_down` 坐标约定、mirror risk、semantic anchors 和 `review_required`；已重跑 `image-structured:build-ambulance-part-graph`，ambulance observations 现记录 side-view front/rear wheel 与 cab/body 手性锚点。
- **2026-05-29**：Ambulance visual-quality refit 第一轮完成：`examples/reference-visual-qa/ambulance-reference.json` 已从旧 seed geometry 门槛切到参考图锚定门槛，新增 `extent_ratios` 尺寸占比规则，覆盖车身/cab silhouette、前挡风、侧窗、驾驶窗、灯条、红条和 `AMBULANCE` 文字尺寸。旧救护车快照在新 gate 下会失败 17 项（silhouette、keypoint、extent、area、relative placement），新 `examples/part-graphs/ambulance-reference.part-graph.json` 只通过 PartGraph 参数修正后重新编译到 DSL，并通过 `npm run qa:model-layout`、`npm run qa:reference-visual`、`npm test`、live `validate_model --runtime queue`、live `validate_reference_model --runtime queue`、`npm run qa:mock`、`npm run qa:queue`、`npm run qa:expert:queue` 和 `npm run qa:budget:queue`。这把“产出质量标准”从只证明架构闭环提升为可打回旧模型的参考视觉门槛；但它仍是单产品第一轮 refit，不代表照片级自动重建已经泛化。
- **2026-05-29**：R5 Product Sample Expansion 第一刀完成：新增 `examples/product-profiles/game_controller_switch.json`、`examples/part-graphs/switch-controller-reference.part-graph.json`、`examples/acceptance-switch-controller.json`、`examples/reference-visual-qa/switch-controller-reference.json` 和 `scripts/generate-product-sample-reports.mjs`。`npm run part-graph:compile-switch` 可从 Switch ProductProfile + PartGraph 重建 acceptance DSL；`npm run qa:model-layout` 默认改用该编译产物；`npm run qa:reference-visual` 默认覆盖 ambulance + Switch；`npm run qa:product-samples` 汇总编译新鲜度、layout QA、Reference Visual QA、evidence ratio 和 fallback ratio。当前 mock 产品样本报告通过：ambulance fallback ratios 为 `real_feature_op 0.094`、`box_approximation 0.094`、`visual_helper 0.792`、`profile_default 0.019`；Switch 为 `box_approximation 0.157`、`visual_helper 0.843`。新增回归证明 Switch 右摇杆漂移仍可通过 layout QA，但会被 Reference Visual QA 的 `right-thumbstick-center` 打回。
- **2026-05-29**：R3 Reference Visual QA 第一刀落地：新增 `src/reference-visual-qa.mjs`、`schema/reference-visual-qa.schema.json`、`examples/reference-visual-qa/ambulance-reference.json`、`scripts/generate-reference-visual-qa-reports.mjs`、Bridge/CLI/MCP/HTTP `validate_reference_model` 和 `npm run qa:reference-visual`。救护车参考视觉 QA 复用现有正交 preview renderer，忽略 reference image planes，对 normalized silhouette aspect、keypoints、extent ratios、area ratios、relative placement 做结构化检查；correction suggestions 使用 `update_part_graph` 并指向 `parts[...].shape.parameters...`。新增 `test/reference-visual-qa.mjs` 覆盖 schema、当前救护车 pass、以及“layout QA pass 但侧窗比例漂移 reference QA fail”的回归。当前 R3 门槛已经升级为参考图锚定的首个产品质量 gate；后续需要把同一标准扩到更多产品，而不是只依赖救护车一例。
- **2026-05-29**：R4 Image Structured Modeler PartGraph 闭环落地：`test/救护车` 现在生成 `observations.json`、seed `part-graph.generated.json`、no-seed `part-graph.skeleton.json`、compiled DSL、Reference Visual QA report、`part_graph_correction_patch`、corrected PartGraph 和 quality report。当前 seed PartGraph 为 53 parts：10 observed、41 inferred、2 needs_review、0 profile_default evidence-status；quality gate pass，`profile_default_ratio=0`、`needs_review_ratio=0.038`、scale confidence `0.86`。`npm run test:image-structured` 覆盖 contour/keypoint、跨图 part matching、尺度校准、证据置信度、无 seed skeleton、correction patch schema/application 和质量报告。重要边界：seed generated PartGraph 仍复用旧形体参数，no-seed skeleton 仍保持 inferred geometry review-gated，因此 R4 是 evidence/correction 管线闭环，不是救护车视觉质量提升完成。
- **2026-05-29**：R1/R2 产品建模架构第一版落地：新增 `schema/product-profile.schema.json`、`schema/part-graph.schema.json`、`examples/product-profiles/vehicle_ambulance.json`、`examples/part-graphs/ambulance-reference.part-graph.json`、`src/product-modeling/part-graph-compiler.mjs` 和 `scripts/compile-part-graph-to-sketchup-dsl.mjs`。`npm run acceptance:generate-ambulance` 已迁移为 `vehicle_ambulance profile + ambulance PartGraph -> compiler -> JSON DSL`，生成的 `examples/acceptance-ambulance-reference.json` 保留当前 104-op 救护车验收模型，同时带 `metadata.source=part_graph_compiler` 和 `qa.part_id` / evidence / fallback metadata。新增 `test/part-graph-compiler.mjs` 校验 schema、编译结果、mock build、layout QA 和基础 primitive 的 QA metadata 透传；后续从 R3 Reference Visual QA 接上，不再继续手写救护车 DSL。
- **2026-05-29**：记录下一阶段产品建模架构重构计划：明确不重写 runtime，保留 JSON DSL / bridge / mock / queue / registry / `validate_model` 基础，把重构边界放在 runtime 之上的 `ObservationSet -> EvidenceGraph -> ProductProfile -> PartGraph -> FeatureMappingPlan -> JSON DSL -> Layout QA + Reference Visual QA -> CorrectionPatch`。新增 `docs/product-modeling-architecture-refactor-plan.md`，并在 README、`PROJECT_STATUS.md`、`projects/image-structured-modeler/PLAN.md` 和 `MEMO.md` 中设为下一轮开工入口。优先切片为 R1/R2：`ProductProfile` / `PartGraph` schema、`vehicle_ambulance` profile、手工 ambulance part graph、part graph compiler，以及把 correction target 从 DSL 坐标上移到 part graph 字段。
- **2026-05-28**：补齐无 GUI 模型布局 QA 闭环：新增 `src/model-qa.mjs`、CLI/MCP/HTTP `validate_model` 入口、`scripts/generate-model-qa-reports.mjs`、`npm run qa:model-layout`、三份样例 spec（Switch 手柄、救护车、儿童房）和 `test/model-qa.mjs`。该 gate 基于 snapshot bbox/qa/spec 执行 `contacts`、`allowed_collisions`、`inside`、`support`、`separation` 检查，输出结构化 issues、correction suggestions、top/front/right 正交 SVG 与 HTML preview，不依赖 macOS 录屏或 SketchUp UI 控制。首轮运行暴露并修正了 Switch `Home_Button` 越界、救护车左侧踏板孔阵列碰到后轮毂、儿童房收纳柜与床梯穿插；修正后 `npm run qa:model-layout` 三个样例均 Verdict `pass` / Level `ok` / issues `0`，报告位于 `output/model-qa/`。
- **2026-05-28**：救护车验收模型改为从 `scripts/generate-ambulance-reference-demo.mjs` 完整重新生成，不再复用旧 JSON 手工修改；新增 `npm run acceptance:generate-ambulance`。新 DSL 共 106 ops，覆盖 `cut_recess ×7`、`add_boss ×3`、`add_raised_rib ×3`、`boolean_difference ×1`、`manifold_check ×3`、5 张 `test/救护车` 参考图板、2 个场景和材质/标签/属性/分类。重跑中发现 Ruby queue `boolean_difference` 不能直接依赖 `Group#subtract` 返回值，否则容易得到 cutter 结果；已把插件推进到 `queue-plugin-0.1.0-phase7-boolean-manifold.3`，用 `Group#split` 显式保留 target-minus-tool，并安装/重启 SketchUp 后验证 live `get_capabilities` compatibility `ok`，RBZ 输出 `out/releases/alma-sketchup-mcp-queue-plugin-0.1.0-phase7-boolean-manifold.3.rbz`。`examples/boolean-manifold-slice.json` queue vs mock 在 solid boolean tolerance 下 Verdict `pass` / Level `ok` / Total Diffs `0`。救护车 queue snapshot 为 57 groups / 1156 faces / 3044 edges / 2036 vertices / 2 scenes，roof service panel boolean 结果为完整 bbox `420 x 330 x 26 mm`、11 faces / 24 edges、manifold `ok`；`validate_model` queue 报告 Verdict `pass` / Level `ok` / issues `0`，SKP 保存到 `output/acceptance-ambulance-reference.rerun.skp`。
- **2026-05-27**：阶段 7 CAD boolean/manifold 主线能力完成并完成 live queue 复验：manifest 推进到 `2026-05-phase7-boolean-manifold`，runtime capability 推进到 `0.1.0-capabilities.5`，插件版本推进到 `queue-plugin-0.1.0-phase7-boolean-manifold.1`。新增 `src/boolean-operations.mjs` / `sketchup_plugin/alma_sketchup_mcp/boolean_operations.rb`，并接入 mock dispatch、Ruby dispatch、snapshot schema、operation registry、插件打包清单和默认 QA examples。新增 `boolean_union`、`boolean_difference`、`boolean_intersect`、`manifold_check`、`manifold_repair` 和 `examples/boolean-manifold-slice.json`；mock 构建结果为 1 group / 8 faces / 16 edges，3 条 boolean history，2 条 manifold check/repair，warnings 0。修复 queue 侧 cylinder 未透传 `id`、SketchUp solid operation 删除输入后读取旧 group 引用、boolean history 跨结果 group 丢失、以及 solid operation 临时 `TempInstance#*` definition 进入 snapshot 的问题。已通过 `node --check`、`ruby -c`、`npm test`、`npm run registry:check`、`npm run plugin:check`、`npm run qa:mock`、`npm run qa:expert:mock`、`npm run qa:budget:mock`、`npm run test:image-structured`、`git diff --check`、`npm run plugin:install` 和 `npm run plugin:package`；contract 输出 manifest/mock/Ruby dispatch 均为 `74`，component_definition registry/dispatch 均为 `42`；RBZ 输出 `out/releases/alma-sketchup-mcp-queue-plugin-0.1.0-phase7-boolean-manifold.1.rbz`。live `get_capabilities --runtime queue` 回报新插件 compatibility `ok`、issues 为空、supported operations `74`；`examples/boolean-manifold-slice.json` queue 单例成功，真实 SketchUp solid 结果为 1 group / 6 faces / 12 edges / 8 vertices，3 条 boolean history，2 条 manifold check/repair，warnings 0；使用 solid boolean 专用 topology/bbox tolerance 的 mock-vs-queue 报告 `output/boolean-manifold-queue-report.md` 为 Verdict `pass` / Level `ok` / Total Diffs `0`。`npm run qa:queue` 10/10 样例 `OK: true`，聚合仍为 `review`（既有 mock/queue 拓扑差异 warning）；`npm run qa:expert:queue` 和 `npm run qa:budget:queue` 均 pass。
- **2026-05-27**：阶段 7 主线第一刀完成并完成 live queue 复验：manifest 推进到 `2026-05-phase7-feature-slice`，runtime capability 推进到 `0.1.0-capabilities.4`，插件版本推进到 `queue-plugin-0.1.0-phase7-feature-slice.1`。新增 `src/feature-operations.mjs` / `sketchup_plugin/alma_sketchup_mcp/feature_operations.rb`，并把 Ruby 插件 `reset_model` / `build_model` / `save_model` / `snapshot` 统一到 `active_model_or_new`。新增 `cut_hole`、`cut_slot`、`cut_recess`、`add_boss`、`add_raised_rib`，受控目标为 `box`、`rounded_box`、`panel_with_openings`、`boolean_cutout`、`floor_slab`、`wall` 的轴对齐平面面；新增 `examples/feature-editing-slice.json`，mock snapshot 为 1 group / 141 faces / 280 edges，5 条 feature metadata，bbox 高度从 16 扩到 28。Ruby queue 侧修复 `AlmaFeatures.base_bounds_json` 把 SketchUp `Length` 写成 `"240 mm"` 后二次特征减法失败的问题。已通过 `node --check src/feature-operations.mjs`、`ruby -c sketchup_plugin/alma_sketchup_mcp/feature_operations.rb`、`npm test`、`npm run qa:mock`、`npm run qa:expert:mock`、`npm run qa:budget:mock`、`npm run plugin:check`、`npm run plugin:install`、`npm run plugin:package`、mock capability handshake、live `node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000` 和 feature mock-vs-queue 对照；live compatibility `ok`，issues 为空。feature queue 对照 `OK: true`，仅余 SketchUp pushpull 拓扑计数 warning；RBZ 输出 `out/releases/alma-sketchup-mcp-queue-plugin-0.1.0-phase7-feature-slice.1.rbz`。
- **2026-05-27**：Image Structured Modeler 阶段 7 的 1/2 项完成：`generate-model-plan.mjs` 新增 `model-plan.review.semantic_fusion`，把 evidence graph 融合为 per-part `status` / `decision` / `confidence` / semantic evidence / feature mapping signals / review flags；Switch 样例 summary 为 9 parts，2 confirmed / 7 partial / 0 needs_review，cross-view confirmed parts 为 `center_grip_body`、`rear_grip_pair`；compact remote summary 为 7 parts，4 confirmed / 2 partial / 1 needs_review，needs_review 明确落在 brand label 的 `visual_marker` fallback。`review/index.html` 新增 Semantic Fusion 和 Corrections Workbench，可选择建议 patch、编辑 JSON、校验、复制和下载 `manual-corrections.workbench.json`。已刷新 `npm run image-structured:build-switch`、`npm run image-structured:build-remote`，并通过 `node --check` 三个改动脚本和 `npm run test:image-structured`。
- **2026-05-27**：Image Structured Modeler 技术预览 evidence layer 与 feature mapping 第一刀收口：`observations.json` 原生保存 `evidence_graph`，`generate-model-plan.mjs` 优先合并 observation graph，并在 `model-plan.review.evidence_graph` 记录 required/confirmed/missing views、sources、template-prior conflict、feature_mapping_fallback conflict 和 open questions；`model-plan.review.correction_suggestions` 与 review HTML 新增 Correction Patch Suggestions，给出可复制到 `manual-corrections.json` 的 patch skeleton。compact remote 已把 `blind_recess` / `convex` 编译为 `cut_recess` / `add_boss` / `add_raised_rib`，新增 `manual-corrections.feature-regression.json` 验证 brand label 从 `text_3d` visual fallback 切到真实 `cut_recess`。已通过 `node --check` 改动脚本、`npm run image-structured:build-switch`、`npm run image-structured:build-remote`、`npm run test:image-structured`、`npm test`、`npm run qa:mock`、`npm run qa:budget:mock`、Switch queue snapshot/diff、compact remote queue snapshot/diff 和 warning gate。compact remote queue snapshot 为 3 groups / 369 faces / 1035 edges / 690 vertices / 2 scenes，SKP `182920` bytes，`add_boss ×6`、`add_raised_rib ×1`、`cut_recess ×5`；Switch queue snapshot 为 24 groups / 4 instances / 1776 faces / 2964 edges / 1244 vertices / 2 scenes，SKP `254234` bytes。该记录发生在主线 boolean/manifold 收口前。
- **2026-05-25 验收复盘 / 发布判定调整**：新增并运行儿童房与救护车验收 DSL，均完成 mock build、queue build、queue save：`output/acceptance-ikea-childrens-room.skp`（39 groups / 15 instances / 2607 faces / 4683 edges / 2 scenes）和 `output/acceptance-ambulance-reference.skp`（37 groups / 778 faces / 2054 edges / 2 scenes）。两者验证了当前 MCP 对场景、产品、材质、标签、属性、分类、参考图板和 scenes 的表达能力，但也暴露真实特征编辑不足：孔槽/凹坑/凸筋多为视觉 marker 或组合体，不能替代 CAD manifold boolean。Switch 手柄子项目额外跑了 6 张单图 per-image 生成，均能输出完整 41-op / 24-group / 1776-face 模型和 queue SKP；这反而确认当前子项目主要依赖 Switch layout prior 模板补全，不是多图联合推理。Queue 批处理过程中还暴露 `Sketchup.active_model` 为 nil 时 `reset_model` / `build_model` 失败的问题；打开一个 SKP 后恢复。因此正式发布暂停，下一阶段优先做 active model 防护、真实特征编辑 slice、图像侧语义融合和 correction authoring。
- **2026-05-25 自动化回归记录**：当前 checkout 已通过原 release checklist 的本地与 queue 验收门槛：`npm run plugin:check`、`npm test`、`npm run qa:mock`、`npm run qa:expert:mock`、`npm run qa:budget:mock`、`git diff --check`、live `node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000`、`npm run qa:queue`、`npm run qa:expert:queue`、`npm run qa:budget:queue`。live SketchUp Bridge 回报 `queue-plugin-0.1.0-phase5-closeout.1` / `2026-05-phase5-closeout-slice` / `0.1.0-capabilities.3`，compatibility `ok`，issues 为空；`qa:queue` 9/9 pass 且 Total Diffs 均为 0；`qa:expert:queue` pass，19 ops、739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances、warnings 0，SKP artifact `167582` bytes；`qa:budget:queue` 4/4 pass，真实 SKP artifact 均低于 5MB 阈值。该记录说明基础回归绿灯，不再代表正式发布判定。
- **2026-05-25**：阶段 2-5 技术预览残项收口：`transform_object` matrix/local_matrix decomposition 新增 affine/non-affine reasons、homogeneous perspective terms 和 Euler XYZ degrees；`text_emboss` / `text_engrave` 新增 `mode: "font_outline"` / `outline: true`，queue runtime 复用 SketchUp `Entities#add_3d_text` 生成真实字体轮廓 marker，mock runtime 回传稳定 bbox 与 `Text3D` metadata；Expert Mode 新增 `Array.filter/flatMap/reduce/concat`、`clamp`、`lerp`、`rad`、`deg`、扩展 `Math` 白名单与 `vec.dot/cross/length/distance/norm/normalize` helper。manifest 推进到 `2026-05-phase5-closeout-slice`，runtime capability 推进到 `0.1.0-capabilities.3`，插件版本推进到 `queue-plugin-0.1.0-phase5-closeout.1`。已通过 `npm test`、`npm run qa:mock`、`npm run qa:budget:mock`、`npm run qa:expert:mock`、`npm run plugin:check`、`npm run plugin:install`、`node src/cli.mjs get_capabilities --runtime mock`、`examples/text-3d-slice.json` mock 构建 warnings 0 和 `git diff --check`。SketchUp 重新加载插件后 live `get_capabilities --runtime queue` 回报 `queue-plugin-0.1.0-phase5-closeout.1`、compatibility `ok`、issues 为空；`examples/text-3d-slice.json` queue 单例成功，350 faces / 966 edges / 644 vertices / 4 groups / 1 instance、warnings 0，font-outline `Text3D_Outline_Emboss` 与 `Text3D_Outline_Engrave` 均回传 `mode: font_outline` attributes；transform decomposition queue 单例成功，Euler matrix 回传 `rotation_euler_degrees: [0, 0, 90]`，非仿射 matrix 回传 `non_affine_reasons: ["perspective_terms", "homogeneous_w_not_one"]`；`npm run qa:queue` 9/9 pass，`npm run qa:budget:queue` 4/4 pass，`npm run qa:expert:queue` pass，Expert queue artifact 167726 bytes。
- **2026-05-25**：阶段 6 Image Structured Modeler 收口完成：`generate-model-plan.mjs` / `compile-plan-to-sketchup-dsl.mjs` 新增 `object_profile` 分流，Switch 保持现有 profile，新增 `compact_remote` 第二产品样例；新增 `examples/switch-controller/manual-corrections.regression.json`，`npm run test:image-structured` 会断言人工修正移动左摇杆、调整按钮数量，并同步改变 compiled DSL；新增 `examples/compact-remote` observations/manual corrections/model-plan/output/review/mock snapshot/warning budget，当前 mock snapshot 为 11 groups / 529 faces / 1234 edges / 452 vertices / 2 scenes，bbox `44 x 158 x 15.85 mm`，warnings 0。SketchUp Bridge 恢复响应后，live `get_capabilities --runtime queue` 回报 `queue-plugin-0.1.0-phase5-closeout.1`、compatibility `ok`；`npm run image-structured:snapshot-remote:queue` 成功，queue snapshot 为 11 groups / 544 faces / 1279 edges / 766 vertices / 2 scenes，bbox `44 x 158 x 15.85 mm`，SKP `188104` bytes，warnings 为 3 个已分类 `queue_material_limitation`；`npm run image-structured:diff-remote:queue` 成功，mock/queue report `ok`，warning gate pass。已通过 `node --check` 改动脚本、`npm run image-structured:build-remote`、Switch generate/compile/review/snapshot refresh、`npm run test:image-structured`、`npm test`、`npm run qa:mock`、`npm run qa:budget:mock`、`npm run plugin:check`、`git diff --check`。
- **2026-05-25**：阶段 5 Expert Mode v1 技术预览收口完成：新增 `scripts/generate-expert-qa-reports.mjs` 与 `npm run qa:expert:mock` / `npm run qa:expert:queue`，报告覆盖 Expert 编译、runtime build、artifact 保存、runtime compatibility、warnings 和预算。`npm test` 通过；`qa:expert:mock` 输出 `output/qa-reports/expert-mock/index.md`，Verdict `pass`，19 compiled ops、562 faces / 1548 edges / 2 groups / 12 instances、warnings 0、artifact JSON 53663 bytes；`qa:expert:queue` 输出 `output/qa-reports/expert-queue/index.md`，Verdict `pass`，19 compiled ops、739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances、warnings 0、SKP artifact 207147 bytes，实际文件位于 `output/qa-reports/expert-queue/artifacts/expert-parametric-fixture.skp`。
- **2026-05-25**：阶段 5 MCP tool 面完成：`src/mcp-server.mjs` 暴露 `compile_expert` / `build_expert_model`，MCP tools 数量从 7 增至 9；新增 `test/mcp-server.mjs` 启动真实 stdio MCP server 子进程，验证 `tools/list` 中的新工具 schema，并通过 `tools/call` 跑通 `compile_expert` 与 mock `build_expert_model`。
- **2026-05-24**：`text_3d` 收口完成：manifest 推进到 `2026-05-phase4-text-3d-slice` / capability `0.1.0-capabilities.2`，Ruby 插件版本推进到 `queue-plugin-0.1.0-text-3d.1`。新增 `text_3d` operation、mock bbox/`Text3D` metadata、Ruby queue `Entities#add_3d_text` 实现、component_definition dispatch、`examples/text-3d-slice.json` 和文档/status 同步。已通过 `node --check`、Ruby syntax、`npm test`、`npm run qa:mock`、`npm run plugin:check`、`git diff --check`、`node src/cli.mjs get_capabilities --runtime mock`；contract 输出 manifest/mock/Ruby dispatch 均 64，component_definition registry/dispatch 均 42。安装并重启 SketchUp 后，live `get_capabilities` 回报 `queue-plugin-0.1.0-text-3d.1`、compatibility `ok`、issues 为空；`examples/text-3d-slice.json` queue 构建成功，主文字 snapshot 为 `kind: text_3d`、153 faces / 423 edges、warnings 0；`npm run qa:queue` 9/9 pass，`npm run qa:budget:queue` 4/4 pass。
- **2026-05-24**：阶段 5 Expert Mode v1 第一切片完成：新增 `src/expert-compiler.mjs`、`examples/expert-parametric-fixture.js`、`docs/expert-mode.md` 和 `test/expert-compiler.mjs`，并在 bridge/CLI 增加 `compile_expert` / `build_expert_model`。当前 compiler 使用 AST 白名单解释器，支持变量、函数、`for` / `for...of`、`Array.map`、`range`、seeded random、`vec` helper 和白名单 `Math`，输出标准 JSON DSL 后复用现有 mock/queue runtime。`node test/expert-compiler.mjs` 已验证 19 个 operations、12 个 component instances、2 个 groups、0 warnings，并覆盖拒绝 `require`、超 loop/operation limit、缺 required field、component_definition 内非法 op 和 `while`。SketchUp Bridge 重启后，live `get_capabilities` 回报 `queue-plugin-0.1.0-text-3d.1`、compatibility `ok`、issues 为空；`build_expert_model --runtime queue --code-file examples/expert-parametric-fixture.js --seed 7` 成功，queue snapshot 为 739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances、warnings 0，`Expert_Parametric_Label` 为真实 `text_3d`，277 faces / 771 edges。
- **2026-05-23**：`transform_object` matrix decomposition live queue 收口：mock `matrix` / `local_matrix` snapshot 追加 `matrix_decomposition` / `local_matrix_decomposition`，Ruby queue runtime 写入同构 `transform.object_transform` metadata，覆盖 translation、basis axes、scale、shear、determinant 和 mirrored；manifest `2026-05-phase2-matrix-decomposition-slice` 与插件 `queue-plugin-0.1.0-transform-matrix-decomposition.1` live `get_capabilities` compatibility `ok`、issues 为空。已通过 `node --check`、Ruby syntax、`npm test`、`npm run qa:mock`、`npm run qa:budget:mock`、`npm run plugin:check`、`npm run plugin:install`、`npm run plugin:package`、`examples/transform-local-matrix.json` queue 单例 diff 0、`npm run qa:queue` 9/9 pass、`npm run qa:budget:queue` 4/4 pass。
- **2026-05-23**：Bridge runtime descriptor cache 完成：显式 `get_capabilities` 继续强制 live handshake，普通 `reset_model` / `build_model` / `save_model` 在同一 `SketchUpBridge` 生命周期内复用已验证 descriptor，避免长批量 queue 回归中重复 capability handshake 偶发 timeout；新增测试覆盖 cache 复用和显式刷新。
- **2026-05-23**：`transform_object.local_matrix` 第一切片完成：新增 `examples/transform-local-matrix.json`，mock 和 Ruby queue runtime 均支持 `local_matrix` / `localMatrix` / `matrix_local` / `matrixLocal` 16-number matrix，按对象当前本地坐标系解释线性与平移分量；manifest 推进到 `2026-05-phase2-local-matrix-slice`，插件版本推进到 `queue-plugin-0.1.0-transform-local-matrix.1`。已通过 `npm test`；待重新安装/重启 SketchUp 后跑 live queue 单例和全量回归。
- **2026-05-23**：Ruby queue runtime geometry family 拆分完成：`geometry_operations.rb` 从 1496 行降到 157 行，新增 `primitive_operations.rb`、`product_operations.rb`、`profile_operations.rb`、`surface_operations.rb` 和 `demo_operations.rb`；主插件加载顺序和 `scripts/package-sketchup-plugin.mjs` 打包清单同步更新，插件版本推进到 `queue-plugin-0.1.0-ruby-geometry-family-split.1`。已通过 Ruby syntax、`npm run plugin:check`、`npm test`、`npm run plugin:install` 和 `npm run plugin:package`；重启 SketchUp 后 live `get_capabilities` 回报新版本、compatibility `ok`、issues 为空，`npm run qa:queue` 9 个默认样例全部 pass，`npm run qa:budget:queue` 4 个预算样例全部 pass。
- **2026-05-23**：JS mock runtime 主边界拆分完成：新增 `src/model-state.mjs`、`src/operation-utils.mjs`、`src/material-operations.mjs`、`src/primitive-operations.mjs`、`src/profile-operations.mjs`、`src/surface-operations.mjs`、`src/product-operations.mjs` 和 `src/demo-operations.mjs`，`src/geometry.mjs` 收敛为 10 行兼容聚合导出入口，`src/mock-runtime.mjs` 只负责 session/dispatch。已通过 `node --check`、`npm test`、`npm run qa:mock`、`npm run qa:budget:mock`、`npm run plugin:check` 和 `git diff --check`，contract 输出 manifest/mock/Ruby dispatch 均 63，component_definition registry/dispatch 均 41；本轮未改 Ruby 插件，未重跑 live queue。
- **2026-05-23**：JS mock runtime 拆分第三刀完成：新增 `src/snapshot.mjs`，将 snapshot 构建、warning summary、bbox 合并和碰撞 warning 从 `src/geometry.mjs` 拆出；`geometry.mjs` 从 1529 行降到 1320 行，`src/mock-runtime.mjs`、`src/architecture-operations.mjs`、`src/component-operations.mjs` 和 `src/object-operations.mjs` 改为从 `src/snapshot.mjs` 取 `createSnapshot` / bbox helper。已通过 `node --check`、`npm test`、`npm run qa:mock`、`npm run qa:budget:mock`、`npm run plugin:check` 和 `git diff --check`，contract 输出 manifest/mock/Ruby dispatch 均 63，component_definition registry/dispatch 均 41。
- **2026-05-22**：Queue runtime 串行化和 registry 生成收口：`src/queue-runtime.mjs` 新增 `queue-runtime.lock`、stale lock 清理和 timeout 后 pending request 清理；`src/bridge.mjs`、`scripts/generate-qa-reports.mjs`、`scripts/run-performance-budgets.mjs` 在涉及 queue 的批量/对照流程中持有同一 runtime lock。新增 `scripts/generate-ruby-operation-registry.mjs` 与 `sketchup_plugin/alma_sketchup_mcp/operation_registry.rb`，Ruby `SUPPORTED_OPERATIONS` / `operation_support_descriptor` 改为从 JS operation registry 生成；`npm test` 纳入 `test/queue-runtime-lock.mjs` 和 `npm run registry:check`。已通过 `npm test`、`npm run plugin:check`、`npm run plugin:install`、`npm run plugin:package`、`npm run qa:mock`、`npm run qa:queue`、`npm run qa:budget:mock`、`npm run qa:budget:queue` 和 live `get_capabilities`。
- **2026-05-22**：JS mock runtime 拆分第二刀完成：新增 `src/architecture-operations.mjs`、`src/component-operations.mjs`、`src/view-operations.mjs` 和 `src/object-identity.mjs`，将 box/product/architecture helper、component_definition/instance、view 操作和对象身份/引用 helper 从 `src/geometry.mjs` 拆出；`test/operation-contract.mjs` 改为从 `src/component-operations.mjs` 校验 JS component dispatch。已通过 `node --check`、`npm test`、`npm run qa:mock`、`npm run qa:budget:mock` 和 `npm run plugin:check`，contract 输出 manifest/mock/Ruby dispatch 均 63，component_definition registry/dispatch 均 41。
- **2026-05-22**：Ruby queue runtime 拆分第四刀完成：新增 `architecture_operations.rb`、`component_operations.rb`、`view_operations.rb`，将建筑 helper、component_definition/instance 和 camera/scene/style/shadow/rendering 从 `geometry_operations.rb` 拆出；`geometry_operations.rb` 从 1949 行降到 1496 行，主插件版本推进到 `queue-plugin-0.1.0-ruby-module-split.1`。本地已通过 Ruby syntax、operation contract、registry check、`npm run qa:mock`、`npm run qa:budget:mock` 和插件打包/安装检查；重启 SketchUp 后 live `get_capabilities` 回报新版本、compatibility `ok`，`npm run qa:queue` 9 个默认样例全部 pass，`npm run qa:budget:queue` 4 个预算样例全部 pass。
- **2026-05-22**：Runtime 文件拆分第一刀完成：新增 `src/object-operations.mjs` 和 `src/object-operation-utils.mjs`，将 mock runtime 的对象编辑、Tags、attributes、classification、texture transform 和 `transform_object` 从 `src/geometry.mjs` 拆出，`geometry.mjs` 保留几何创建、component_definition dispatch、snapshot 和共享 helper。通过 `node --check`、`npm test`、`npm run qa:mock`（9 个默认样例）和 `npm run qa:queue`（9 个默认样例），queue 报告均 Verdict `pass`。
- **2026-05-22**：新增 release packaging 入口：`scripts/package-sketchup-plugin.mjs` 统一维护 Ruby 插件文件清单，提供 `npm run plugin:check`、`npm run plugin:install`、`npm run plugin:package`；`plugin:package` 输出 `out/releases/alma-sketchup-mcp-<PLUGIN_VERSION>.rbz`。新增 `docs/release-checklist.md` 固化发布前静态检查、安装、queue 回归、budget 回归和提交切片建议。
- **2026-05-22**：Ruby queue runtime 拆分第三刀完成：新增 `sketchup_plugin/alma_sketchup_mcp/geometry_operations.rb` 和 `sketchup_plugin/alma_sketchup_mcp/snapshot.rb`，主插件文件从 2749 行降到 564 行；主插件版本推进到 `queue-plugin-0.1.0-geometry-snapshot-split.1`。通过本地 `ruby -c`、已安装插件语法检查、`npm test`、live `get_capabilities`，当前 SketchUp Bridge 已加载新版本且 compatibility `ok`。
- **2026-05-22**：新增 `scripts/run-performance-budgets.mjs`、`npm run qa:budget:mock`、`npm run qa:budget:queue` 和 `docs/performance-budgets.md`，固定 `max_faces=5000`、`max_edges=10000`、`max_vertices=5000`、`max_groups=120`、`max_instances=80`、`max_artifact_size_bytes=5000000` 的默认发布预算。mock 与 queue 预算均 Verdict `pass`；queue 报告 `output/performance-budgets/queue/index.md` 覆盖 golden-architecture、golden-product、structured-product-helpers、appearance-texture-slice，真实 SKP size 分别为 213538、256039、169978、152061 bytes。
- **2026-05-22**：Ruby queue runtime 拆分第二刀完成：新增 `sketchup_plugin/alma_sketchup_mcp/materials.rb`，将材质、PBR、基础贴图和 image plane material helper 从主插件文件拆出；主插件版本推进到 `queue-plugin-0.1.0-material-split.1`。通过本地 `ruby -c`、已安装插件语法检查、`npm test`、`npm run qa:mock`、live `get_capabilities` 和全量 `npm run qa:queue`；运行中 SketchUp Bridge 已加载 `queue-plugin-0.1.0-material-split.1`，`output/qa-reports/queue/index.md` Verdict `pass`，9 个默认样例全部通过。
- **2026-05-22**：新增 `docs/queue-runtime-ops.md`，固化 queue runtime 手动验收顺序、视觉检查矩阵、安装检查和常见故障排查；README 的插件安装命令同步为复制主文件和 `alma_sketchup_mcp/` 子目录。
- **2026-05-22**：Ruby queue runtime 拆分第一刀完成：新增 `sketchup_plugin/alma_sketchup_mcp/object_operations.rb`，将 Ruby 插件对象编辑、Tags、attributes、classification、texture transform 和 `transform_object` helper 从主插件文件拆出，主文件通过 `require_relative` 加载。通过 `ruby -c`、`npm test`、live `get_capabilities` 和全量 queue 回归；运行中 SketchUp Bridge 已加载 `queue-plugin-0.1.0-runtime-split.1`，`output/qa-reports/queue-runtime-split/index.md` Verdict `pass`，9 个默认样例全部通过。
- **2026-05-22**：对象身份 live queue 验收通过 `npm run qa:identity:queue`；报告 `output/qa-reports/identity-queue/editing-identity.md` Verdict `pass`，Total diffs 0。同步修正 queue snapshot 的隐藏对象统计口径：hidden group / component instance 仍在数组中回传 `visible: false`，但不再计入 totals、整体 bounding box 和 overlap warnings。
- **2026-05-22**：`transform_object` 任意模型空间 `axis + angle` 第一切片通过 `npm test`、`npm run qa:mock`、`ruby -c sketchup_plugin/alma_sketchup_mcp.rb` 和 `examples/editing-transform-profile.json` mock-vs-queue 对照；报告 `output/editing-transform-profile-axis-queue-report.md` Verdict `pass`，Total diffs 0。
- **2026-05-22**：`transform_object` 对象本地轴 `local_axis + local_angle` 第一切片通过 `npm test`、`npm run qa:mock`、`ruby -c sketchup_plugin/alma_sketchup_mcp.rb` 和 `examples/editing-transform-profile.json` mock-vs-queue 对照；报告 `output/editing-transform-profile-local-axis-queue-report.md` Verdict `pass`，Total diffs 0。
- **2026-05-22**：`transform_object` 4x4 `matrix` 第一切片通过 `npm test`、`npm run qa:mock`、`ruby -c sketchup_plugin/alma_sketchup_mcp.rb` 和 `examples/editing-transform-profile.json` mock-vs-queue 对照；报告 `output/editing-transform-profile-matrix-queue-report.md` Verdict `pass`，Total diffs 0。
- **2026-05-22**：component instance transform composition slice 通过 `npm test`、`npm run qa:mock` 和 `examples/component-transform-composition.json` mock-vs-queue 对照；报告 `output/component-transform-composition-queue-report.md` Verdict `pass`，Total diffs 0。
- **2026-05-22**：mock runtime session 写入改为文件锁 + 原子 rename，`npm test` 与 `npm run qa:mock` 并行执行通过，不再出现半写 JSON 读取。
- **2026-05-22**：Appearance / texture 第一批新增 `texture_transform`、`uv_project_planar`、`uv_project_box`、`image_plane` 和 `examples/appearance-texture-slice.json`；通过 `npm test`、`npm run qa:mock`（9 个默认样例）、`ruby -c sketchup_plugin/alma_sketchup_mcp.rb`、已安装插件语法检查和 mock-vs-queue 对照。Contract 输出 manifest/mock/Ruby dispatch 均 63，component_definition registry/dispatch 均 41。Live queue 报告 `output/appearance-texture-queue-report.md` Verdict `pass`，Total diffs 0；queue build snapshot 确认 box/planar `texture_transform`、`TextureTransform` attributes、`image_plane` 组、component-definition 内嵌 image plane 和 warnings 0。
- **2026-05-22**：Tags / attributes / classification metadata slice 通过 `npm test`、`npm run qa:mock`、`ruby -c sketchup_plugin/alma_sketchup_mcp.rb` 和 `examples/metadata-organization-slice.json` mock-vs-queue 对照；报告 `output/metadata-organization-classification-queue-report.md` Verdict `pass`，Total diffs 0。Queue snapshot 已确认 `classification` 字段与 `Classification` attribute dictionary 均回传。
- **2026-05-22**：Operation registry / runtime contract 单一注册表化通过 `npm test`、`npm run qa:mock`、`ruby -c sketchup_plugin/alma_sketchup_mcp.rb` 和 `node src/cli.mjs get_capabilities --runtime mock`；contract 输出 manifest/mock/Ruby dispatch 均 59，component_definition registry/dispatch 均 40。SketchUp 2026 启动 Bridge 后，`node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000` 回报 plugin `queue-plugin-0.1.0-classification.1`、manifest `2026-05-phase2-classification-slice`、compatibility `ok`、issues 为空。
- **2026-05-22**：通用 profile 扩展覆盖新增 `examples/profile-edge-cases.json`，覆盖凹多边形 outer、多洞、`xz` 竖向 face profile、component_definition 内嵌 profile、洞重叠和洞外失败用例；通过 `npm test`、`npm run qa:mock`（8 个默认样例）和 mock-vs-queue 对照；报告 `output/profile-edge-cases-queue-report.md` Verdict `pass`，Total diffs 0。
- **2026-05-22**：Transform chain regression 新增 `examples/transform-chain-regression.json`，覆盖 group 和 component instance 上连续 `transform_object` 的 center pivot、本地轴、模型轴、平移和 matrix 叠加；通过 `npm test`、`npm run qa:mock`（8 个默认样例）、Ruby 语法检查和 mock-vs-queue 对照；报告 `output/transform-chain-regression-queue-report.md` Verdict `pass`，Total diffs 0。
- **2026-05-21**：通用 profile 第一切片通过 `npm test`、`npm run qa:mock`、`ruby -c sketchup_plugin/alma_sketchup_mcp.rb`，新版 SketchUp 插件 manifest `2026-05-phase2-generic-profile-slice` handshake 为 `ok`。
- **2026-05-19**：`transform_object` pivot 增强（origin/center/显式坐标）通过 mock/queue 验证。
- `examples/editing-transform-profile.json` mock-vs-queue compare：Verdict `pass`，Level `ok`，Total diffs 0，报告见 `output/editing-transform-profile-queue-report.md`。
- `npm test`、`npm run qa:mock` 通过。
- Queue capability handshake：最近一次成功 live 记录为 manifest `2026-05-phase7-boolean-manifold` / capability `0.1.0-capabilities.5` / plugin `queue-plugin-0.1.0-phase7-boolean-manifold.3`；compatibility `ok`，issues 为空，supported operations `74`。

---

## 6. 已知阻塞/注意事项

1. **正式发布阻塞：三样本参考图质量门槛已通过，但覆盖面仍不足**。Ambulance 已完成第一轮参考图锚定 refit，旧 seed 快照会被新 Reference Visual QA 打回，新 PartGraph/queue 通过；Switch 与 Fuji 已迁移到 ProductProfile + PartGraph + Reference Visual QA，并通过 mock + live queue 的 `qa:product-samples` 批量报告。R5 可以收口，但儿童房/场景边界和更多产品类别还未覆盖，不能据此宣布泛化完成。
2. **正式发布阻塞：需要用 CAD boolean/manifold 新能力继续重跑大样例**。救护车、Switch 和 Fuji 已通过三样本 live queue 产品 gate；儿童房和更多产品/场景样例还需要继续跑 live queue 与 warning gate。
3. **正式发布阻塞：图像侧仍不是照片级自动重建**。子项目已有 evidence graph、semantic fusion、corrections workbench、R4 image evidence -> PartGraph correction loop、R6 no-seed 参数提案、accepted proposal -> correction patch、proposal review UI 和 mock/queue 复验链；但这些 proposal 仍默认 `review_required`，不能自动升级为可信几何。下一步进入 R7 建筑群照片建模，把同一套 evidence/proposal/QA 纪律扩到场景边界。
4. **Queue active model 防护已补第一版**：Ruby 入口会尝试创建/获取 active model 并给出明确错误；阶段 7 插件已安装、重启并完成 live queue 复验。
5. **OneDrive 文件系统**：之前出现过 `ETIMEDOUT: connection timed out, read`，导致 JS 文件读取失败。已恢复，但需留意。
6. **Ruby 插件加载**：每次更新 `alma_sketchup_mcp.rb` 后，需要重启 SketchUp 才能加载新版本。不支持热重载。
7. **Mock 口径漂移**：`face_with_holes` 从 `1 + holes` 改为 `1` face，因为 SketchUp 中平面带洞计为 1 个 face。类似地，任何新 op 的 mock 计数都需要 queue 验证后才能确定。
8. **文件体积**：早期 Switch mesh 输出曾到 39MB；当前产品 primitive 版本已降到 `253,177` bytes，主线已有 `qa:budget:*` 的 face/vertex/SKP size budget。后续需要用更大样例继续校准阈值。
9. **Git 状态**：当前主线切片已按 runtime registry、docs/release、local_matrix 等提交；后续继续保持小切片提交，避免主线状态继续漂浮。

---

## 7. 架构调整建议

短期不建议重写 runtime；现有 mock/queue/registry/contract 基础可以继续承载下一阶段。需要重构的是 runtime 之上的产品建模层，把当前直接生成 DSL 的路径改为：

```text
Images / user intent
  -> ObservationSet
  -> EvidenceGraph
  -> ProductProfile
  -> PartGraph / ModelPlan
  -> FeatureMappingPlan
  -> JSON DSL
  -> mock / queue runtime
  -> Layout QA + Reference Visual QA
  -> CorrectionPatch
```

具体计划已固化到 `docs/product-modeling-architecture-refactor-plan.md`。R1/R2 第一版已经完成：新增 `ProductProfile` / `PartGraph` schema，建立 `vehicle_ambulance` profile，并把救护车验收从直接 DSL 生成迁移为 `profile + part graph -> compiler -> JSON DSL`。R3 Reference Visual QA 已完成引擎第一刀并补上尺寸占比规则：当前可以让 layout 合格但比例/关键点/部件尺寸偏离参考图的模型失败，并给出指向 PartGraph 字段的 correction target。R4 子项目闭环也已完成 evidence/correction 管线。救护车第一轮 visual-quality refit 已完成；R5 已把 Switch 和 Fuji profile 化并接入同一质量报告，三样本 mock + live queue 产品 gate 已通过并保存 artifacts。R6 已把 no-seed 图像证据转成 review-gated PartGraph parameter proposals，打通 accepted proposal 到 correction patch 的回写，补上 proposal review HTML，连接 proposal-applied mock/queue QA 复验链，并把 physical consistency QA 的支撑/贴合/接地关系扩到 ambulance、Switch、Fuji 三样例。下一步是 R7 建筑群照片建模。

架构取舍：

1. **保留 runtime**：feature ops、boolean/manifold、mock/queue parity、operation registry 和 `validate_model` 继续作为执行与布局 QA 基础。
2. **重构建模计划层**：新产品样例必须先生成 `PartGraph`，记录 part taxonomy、参数、约束、evidence、fallback 和 feature intent，不能直接堆 DSL box。
3. **重构图像结构化层**：R4 已完成 contour/keypoint、跨图 part matching、尺度校准、证据置信度和 PartGraph correction loop 的 ambulance 技术预览闭环；R6 已把 no-seed evidence 转成 review-gated parameter proposals，把 accepted proposals 接到 correction patch authoring，并补上 proposal review UI 与 mock/queue QA 复验链。后续转向 R7 建筑群照片建模和更多场景边界。
4. **补 Reference Visual QA**：救护车第一刀已用正交 preview、轮廓比例、关键点、尺寸占比、面积占比和部件相对位置检查覆盖；当前旧 ambulance seed 模型会在视觉质量 gate 下失败，新 PartGraph 通过。Switch 与 Fuji 也已接入同一类门槛，并覆盖 layout QA 之外的关键点/占比/相对位置回归。下一刀要用这些门槛扩展样本覆盖并继续压低模板/视觉辅助依赖，而不是继续只调单个样例。

---

## 8. 上手命令

```bash
# 离线验证
npm test
npm run qa:mock

# Queue 验证（需打开 SketchUp + Start Bridge）
node src/cli.mjs get_capabilities --runtime queue
node src/cli.mjs build_model --runtime queue --code-file examples/editing-transform-profile.json --timeout-ms 60000
npm run qa:queue

# 单个样例 mock-vs-queue 对照
node src/cli.mjs compare_model --code-file examples/golden-architecture.json --expected-runtime mock --actual-runtime queue --timeout-ms 60000 --format markdown --output-file output/report.md
```
