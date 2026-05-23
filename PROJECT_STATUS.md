# SketchUp MCP Replica — 项目状态与计划

> 更新日期：2026-05-23
> 当前状态：阶段 2 P0 第一/第二切片已收口，P1 transform local matrix / matrix decomposition 本地切片已完成，operation registry/runtime contract 已单一注册表化

---

## 1. 项目定位

用**安全 JSON DSL + 本地 Node bridge + stdio MCP server + SketchUp Ruby queue plugin** 复现 Claude 官方 SketchUp Connector 的核心体验。

**不是**官方 Cloud MCP（不做 OAuth、云端 session、download URL），**是**本地可控替代方案：安全、可测、可回归。

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
| `src/mcp-server.mjs` | stdio MCP server，暴露 7 个工具 |
| `src/bridge.mjs` | 工具路由层，mock/queue 分发、runtime descriptor 附加、compatibility check |
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
| `src/object-operations.mjs` | mock runtime 对象编辑、Tags、attributes、classification、texture transform、transform_object |
| `src/object-identity.mjs` | mock runtime 对象 id、target 引用、唯一性和 box/orientation 基础 helper |
| `src/object-operation-utils.mjs` | object operation 字段归一化和 snapshot attribute helper |
| `src/capabilities.mjs` | 单一真源 operation registry，63 个 operation 的支持状态/稳定性/schema/component-scope |
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
| `sketchup_plugin/alma_sketchup_mcp/demo_operations.rb` | Ruby queue runtime demo room helper |
| `sketchup_plugin/alma_sketchup_mcp/architecture_operations.rb` | Ruby queue runtime 建筑 helper：level/floor/wall/stairs/railing |
| `sketchup_plugin/alma_sketchup_mcp/component_operations.rb` | Ruby queue runtime component_definition / component_instance 和 transform placement |
| `sketchup_plugin/alma_sketchup_mcp/view_operations.rb` | Ruby queue runtime camera/scene/style/shadow/rendering 操作 |
| `sketchup_plugin/alma_sketchup_mcp/snapshot.rb` | Ruby queue runtime snapshot、计数、材质/tag 快照和 bbox warning |
| `docs/queue-runtime-ops.md` | Queue 手动验收清单、安装检查与故障排查 |
| `docs/performance-budgets.md` | 性能基准、face/vertex/SKP size 阈值和预算报告入口 |
| `docs/release-checklist.md` | 发布检查、插件安装、queue 回归、RBZ 打包和提交切片建议 |
| `test/mock-validation.mjs` | 离线回归测试 |
| `test/queue-runtime-lock.mjs` | queue runtime 跨进程串行锁和 timeout 清理测试 |
| `scripts/generate-ruby-operation-registry.mjs` | 从 JS operation registry 生成 Ruby runtime contract 表 |
| `scripts/generate-qa-reports.mjs` | 批量 golden example mock/queue 对照 |

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
- QA 报告生成（JSON + Markdown）
- 批量 golden regression：`npm run qa:mock` / `npm run qa:queue`

### 🔄 阶段 2 — DSL v1.1 核心表达力（P0 第一/第二切片✅，剩余进行中）

**已完成与验证状态：**
- `delete`、`rename`、`set_material`、`set_visibility`
- 对象身份第一切片：group / component instance snapshot 回传 `id`，编辑操作支持 `target_id`，旧 `name` 引用保持兼容
- 对象身份补强：mock/queue 创建侧强制同 scope 内 `id` / `name` 唯一；编辑操作同时传 `target_id` 和 `name` 时必须匹配同一对象
- `examples/editing-identity.json`：专门覆盖 `id -> rename -> set_material -> transform -> visibility/delete` 编辑链
- 对象身份 live queue 验收：`npm run qa:identity:queue` 已通过，mock/queue diff 为 0
- `transform_object`：translate、rotateX/Y/Z、任意模型空间 `axis + angle`、对象本地轴 `local_axis + local_angle`、SketchUp-compatible 16-number `matrix`、本地坐标系 `local_matrix`、scale、mirror；matrix/local_matrix snapshot 会回传 translation、basis axes、scale、shear、determinant 和 mirrored 分解元数据
- `transform_object` pivot：默认 origin、`"center"`、显式 `[x,y,z]`
- `face_with_holes`、`profile_extrude` 通用 profile 第一切片：支持简单闭合多边形 outer + 多边形 holes，拒绝自交、触边和重叠洞；已通过 mock/queue 对照验证
- Operation contract 测试：manifest、mock runtime、Ruby queue runtime、component_definition dispatch 覆盖自动校验
- Operation registry / runtime contract 单一注册表化：`src/capabilities.mjs` 作为唯一 operation registry，manifest、runtime `operation_support`、schema、component-scope、docs matrix、contract tests 均从 registry 派生；当前 63 个 operation，41 个 component_definition-scoped operation

**待做（P1）：**
- [x] 二次编辑的 chain 支持：新增 `examples/transform-chain-regression.json`，连续多个 `transform_object` 叠加时的 center pivot、本地轴、模型轴、平移和 matrix 已通过 mock/queue 对照验证。
- [x] 通用 profile 扩展覆盖：新增凹多边形、多洞、竖向 profile、component_definition 内嵌 profile 和失败样例；已通过 mock/queue 对照验证。
- [ ] 更完整 transform：模型轴、本地轴、模型空间 4x4 matrix、连续 chain 已覆盖 group 与 component instance mock/queue 对照；`local_matrix` 与 matrix decomposition 已通过本地 mock/Ruby contract，后续补 live queue 复验。

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

### 🔄 阶段 4 — 组织、材质、视图（部分完成）

**已完成：**
- `scene`、`style`、`shadow`、`rendering_options`
- `material`：color、alpha、texture、PBR（metallic/roughness/normal/ao/opacity）
- `tag` / `assign_tag`：SketchUp Tags/Layers 组织模型对象，已通过 mock/queue 对照验证；`reset` 会 purge 未使用 Tags，默认 `Untagged/Layer0` 不作为业务 tag 回传
- `attribute`：给 group / component instance 写入并回传 JSON-compatible metadata，已通过 mock/queue 对照验证
- `classification`：给 group / component instance 写入 BIM/classification metadata，snapshot 回传一等 `classification` 字段，并镜像到 SketchUp `Classification` attribute dictionary；已通过 mock/queue 对照验证
- `texture_transform` / `uv_project_planar` / `uv_project_box`：给 group / component instance 写入贴图投影、offset、scale、rotation metadata，snapshot 回传一等 `texture_transform` 字段，并镜像到 SketchUp `TextureTransform` attribute dictionary；已通过 mock/queue 对照验证
- `image_plane`：创建平面参考/贴图面，支持顶层与 component_definition 内嵌；已通过 mock/queue 对照验证
- `component_definition` / `component_instance` 基础复用

**待做：**
- [ ] 真正的 `text_3d`（当前 text_emboss 只是简化方块）

### ⏸️ 阶段 5 — Expert Mode v1（后置，未开始）

允许受限脚本生成 JSON DSL，而非直接手写 DSL。形态：
- 允许：变量、函数、for 循环、数组、map、数学/向量 helper、seeded random、批量 component_instance
- 禁止：文件系统、网络、shell、import/require、eval、直接调用 SketchUp API、无限循环、超大 op 数

### 🔄 阶段 6 — 发布级收口（部分开始）

**已有：**
- Golden examples（architecture / product / structured-helpers / editing-transform-profile / profile-edge-cases / transform-chain-regression / metadata-organization / appearance-texture）
- Gap summary 文档
- Queue 手动验收清单与 troubleshooting：`docs/queue-runtime-ops.md`
- 性能 / SKP size budget：`docs/performance-budgets.md`，`npm run qa:budget:mock` / `npm run qa:budget:queue`
- Release checklist 与插件打包入口：`docs/release-checklist.md`，`npm run plugin:check` / `npm run plugin:install` / `npm run plugin:package`
- Registry sync：`src/capabilities.mjs` 生成 `sketchup_plugin/alma_sketchup_mcp/operation_registry.rb`，`npm run registry:check` 纳入 `npm test` 与插件检查
- Queue runtime 串行锁：Node 侧使用 `~/.sketchup-mcp-replica/queue-runtime.lock` 防止多个 queue 命令互相插入
- Mock regression + queue QA 报告
- Image-to-structured Switch controller baseline：mock/queue snapshot report、warning budget、0 geometry warning、mock/queue diff pass

**待做：**
- [ ] Image-to-structured-model correction-driven regression、第二产品样例和泛化验证

---

## 4. 待办优先级（调整后的执行顺序）

| 优先级 | 任务 | 原因 |
|---|---|---|
| **P1** | Transform 后续 | 模型空间任意轴、对象本地轴、模型空间 4x4 matrix 和连续 chain 均已通过 group/component instance mock/queue；`local_matrix` 与 matrix decomposition 已本地验证，后续补 live queue 复验 |
| **P1** | 拆分大 runtime 文件 | JS mock runtime 与 Ruby queue runtime 主边界/operation-family 边界已拆出；后续只剩更细粒度整理或提交切片 |
| **P1** | Queue 发布收口 | 手动验收清单、troubleshooting、性能基准、SKP size 阈值、串行锁和 release packaging 已固化；后续做提交切片 |
| **P2** | Expert Mode v1 | 提升 DSL 生成效率 |
| **P2** | Image-to-structured-model 泛化 | 上游图片理解子项目已有 Switch baseline，下一步是 correction loop 和第二样例 |
| **P3** | 完整布尔 / manifold | 通用 CAD 能力，当前用安全 slice 替代 |

---

## 5. 最近的验证记录

- **2026-05-23**：`transform_object` matrix decomposition 本地切片完成：mock `matrix` / `local_matrix` snapshot 追加 `matrix_decomposition` / `local_matrix_decomposition`，Ruby queue runtime 写入同构 `transform.object_transform` metadata，覆盖 translation、basis axes、scale、shear、determinant 和 mirrored；manifest 推进到 `2026-05-phase2-matrix-decomposition-slice`，插件版本推进到 `queue-plugin-0.1.0-transform-matrix-decomposition.1`。已通过 `node --check`、Ruby syntax、`npm test`、`npm run qa:mock`、`npm run qa:budget:mock`、`npm run plugin:check`、`npm run plugin:install`、`npm run plugin:package` 和 `examples/transform-local-matrix.json` mock build；待完整重启 SketchUp 后跑 live queue 单例和全量回归。
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
- Queue capability handshake：上一轮 live SketchUp Bridge 已加载 manifest `2026-05-phase2-appearance-slice` / plugin `queue-plugin-0.1.0-ruby-geometry-family-split.1` 且 compatibility `ok`；当前源码已推进到 manifest `2026-05-phase2-matrix-decomposition-slice` / plugin `queue-plugin-0.1.0-transform-matrix-decomposition.1`，需重新安装并完整重启 SketchUp 后复验。

---

## 6. 已知阻塞/注意事项

1. **OneDrive 文件系统**：之前出现过 `ETIMEDOUT: connection timed out, read`，导致 JS 文件读取失败。已恢复，但需留意。
2. **Ruby 插件加载**：每次更新 `alma_sketchup_mcp.rb` 后，需要重启 SketchUp 才能加载新版本。不支持热重载。
3. **Mock 口径漂移**：`face_with_holes` 从 `1 + holes` 改为 `1` face，因为 SketchUp 中平面带洞计为 1 个 face。类似地，任何新 op 的 mock 计数都需要 queue 验证后才能确定。
4. **文件体积**：早期 Switch mesh 输出曾到 39MB；当前产品 primitive 版本已降到 `253,177` bytes，主线已有 `qa:budget:*` 的 face/vertex/SKP size budget。后续需要用更大样例继续校准阈值。
5. **Git 状态**：当前主线切片已按 runtime registry、docs/release、local_matrix 等提交；后续继续保持小切片提交，避免主线状态继续漂浮。

---

## 7. 架构调整建议

短期不建议重写架构；应先做三件能直接降低主线风险的收口：

1. **对象身份层**：为 group / component instance 引入稳定 `id` / `guid`，编辑操作优先使用 `target_id`，`name` 只保留为兼容 fallback。mock snapshot、queue snapshot 和 DSL 都要同时承载该字段。
2. **Operation contract 测试**：已收敛到单一 operation registry，自动检查 manifest、runtime support/status/stability/schema/component-scope、mock runtime dispatch、Ruby queue dispatch、component definition dispatch 的覆盖一致性；后续新增 op 必须同时更新 registry、JS/Ruby dispatch 与 contract tests。
3. **模块边界拆分**：JS mock runtime 已拆出 model state、operation utils、material、primitive、profile、surface、product、architecture、demo、component、view、object editing、object identity 和 snapshot/QA 模块；Ruby queue runtime 已拆出 object/editing、material/PBR/texture、geometry shared、primitive、product、profile、surface、demo、architecture、component、view 和 snapshot 模块。下一步以提交切片、live queue 复验或更细粒度 helper 清理为主。

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
