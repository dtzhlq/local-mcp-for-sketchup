# SketchUp MCP Replica — 项目状态与计划

> 更新日期：2026-05-20
> 当前状态：阶段 2 P0 第一切片已收口，阶段 3 大量 helper 已提前完成

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
                    │  geometry.mjs   │        │  文件队列+JSON  │        │  docs.mjs       │
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
| `src/mock-runtime.mjs` | 离线 runtime，解析 DSL operation → 调用 geometry.mjs |
| `src/queue-runtime.mjs` | 队列 runtime，写 JSON 请求到 `~/.sketchup-mcp-replica/queue/` |
| `src/geometry.mjs` | mock 几何生成 + snapshot 逻辑 + 所有 operation 实现 |
| `src/capabilities.mjs` | 单一真源 manifest，55 个 operation 的支持状态/稳定性/限制 |
| `src/snapshot-diff.mjs` | snapshot 对比 QA：totals、bbox、materials、groups、instances、levels、scenes |
| `sketchup_plugin/alma_sketchup_mcp.rb` | SketchUp 2026 Ruby 插件，读队列、执行 DSL、返回 snapshot |
| `test/mock-validation.mjs` | 离线回归测试 |
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

### 🔄 阶段 2 — DSL v1.1 核心表达力（P0 第一切片✅，剩余进行中）

**已完成并通过 mock/queue 验证：**
- `delete`、`rename`、`set_material`、`set_visibility`
- 对象身份第一切片：group / component instance snapshot 回传 `id`，编辑操作支持 `target_id`，旧 `name` 引用保持兼容
- 对象身份补强：mock/queue 创建侧强制同 scope 内 `id` / `name` 唯一；编辑操作同时传 `target_id` 和 `name` 时必须匹配同一对象
- `examples/editing-identity.json`：专门覆盖 `id -> rename -> set_material -> transform -> visibility/delete` 编辑链
- 对象身份 live queue 验收：`npm run qa:identity:queue` 已在 SketchUp Bridge 在线状态下通过，mock/queue diff 为 0
- `transform_object`：translate、rotateX/Y/Z、scale、mirror
- `transform_object` pivot：默认 origin、`"center"`、显式 `[x,y,z]`
- `face_with_holes`、`profile_extrude`（仅矩形 outer + 矩形 holes）
- Operation contract 测试：manifest、mock runtime、Ruby queue runtime、component_definition dispatch 覆盖自动校验
- Operation registry / runtime contract 扩展：manifest 现在显式记录 `schema` 和 `component_scope`，runtime descriptor 会归一化暴露字段契约，contract 测试会拦截 component_definition dispatch 与 registry 漂移

**待做（P0 第二切片）：**
- [ ] **更通用 profile**：当前 `profile_extrude` / `face_with_holes` 只支持矩形。需要支持任意闭合多边形 profile（点数组）+ 带洞。
- [ ] **本地轴 / 更完整 transform**：当前 `transform_object` 的 rotate 是围绕模型空间轴。需要支持对象本地坐标轴旋转、任意轴旋转（axis + angle）。

**待做（P1）：**
- [ ] 二次编辑的 chain 支持：连续多个 `transform_object` 叠加时，pivot 语义是否稳定？
- [ ] `transform_object` 对 component_instance 的支持验证

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
- `component_definition` / `component_instance` 基础复用

**待做：**
- [ ] `tag` / `assign_tag`（SketchUp 2020+ Tags/Layers）
- [ ] `attribute` / `classification`（metadata）
- [ ] `texture_transform`、`uv_project_planar`、`uv_project_box`
- [ ] `image_plane`（贴图平面）
- [ ] 真正的 `text_3d`（当前 text_emboss 只是简化方块）

### ⏸️ 阶段 5 — Expert Mode v1（后置，未开始）

允许受限脚本生成 JSON DSL，而非直接手写 DSL。形态：
- 允许：变量、函数、for 循环、数组、map、数学/向量 helper、seeded random、批量 component_instance
- 禁止：文件系统、网络、shell、import/require、eval、直接调用 SketchUp API、无限循环、超大 op 数

### 🔄 阶段 6 — 发布级收口（部分开始）

**已有：**
- Golden examples（architecture / product / structured-helpers / editing-transform-profile）
- Gap summary 文档
- Mock regression + queue QA 报告
- Image-to-structured Switch controller baseline：mock/queue snapshot report、warning budget、0 geometry warning、mock/queue diff pass

**待做：**
- [ ] Queue 手动验收清单（每个 op 的限制说明、信心等级、视觉检查项）
- [ ] 故障排查文档（queue 超时、插件未加载、文件权限等）
- [ ] 性能基准：大模型 face budget / vertex budget / SKP size 阈值
- [ ] Image-to-structured-model correction-driven regression、第二产品样例和泛化验证

---

## 4. 待办优先级（调整后的执行顺序）

| 优先级 | 任务 | 原因 |
|---|---|---|
| **P0** | 通用 profile（任意多边形 outer + holes） | `profile_extrude` / `face_with_holes` 当前太受限 |
| **P0** | 本地轴 / 任意轴旋转 | transform 当前只支持模型空间轴，产品建模需要本地轴 |
| **P1** | Tag / Layer 管理 | 组织大型模型的基础 |
| **P1** | Attribute / metadata | 建筑信息模型需要 |
| **P1** | 拆分大 runtime 文件 | `geometry.mjs` / Ruby plugin 已经超过 2k 行，后续应按 editing、primitives、product、architecture、snapshot/QA 分层 |
| **P1** | UV / texture transform | 材质精细化需要 |
| **P2** | Expert Mode v1 | 提升 DSL 生成效率 |
| **P2** | Image-to-structured-model 泛化 | 上游图片理解子项目已有 Switch baseline，下一步是 correction loop 和第二样例 |
| **P3** | 完整布尔 / manifold | 通用 CAD 能力，当前用安全 slice 替代 |

---

## 5. 最近的验证记录

- **2026-05-19**：`transform_object` pivot 增强（origin/center/显式坐标）通过 mock/queue 验证。
- `examples/editing-transform-profile.json` mock-vs-queue compare：Verdict `pass`，Level `ok`，Total diffs 0。
- `npm test`、`npm run qa:mock` 通过。
- Queue capability handshake：SketchUp 26.0.428，manifest `2026-05-phase2-pivot-editing-slice`，compatibility `ok`。

---

## 6. 已知阻塞/注意事项

1. **OneDrive 文件系统**：之前出现过 `ETIMEDOUT: connection timed out, read`，导致 JS 文件读取失败。已恢复，但需留意。
2. **Ruby 插件加载**：每次更新 `alma_sketchup_mcp.rb` 后，需要重启 SketchUp 才能加载新版本。不支持热重载。
3. **Mock 口径漂移**：`face_with_holes` 从 `1 + holes` 改为 `1` face，因为 SketchUp 中平面带洞计为 1 个 face。类似地，任何新 op 的 mock 计数都需要 queue 验证后才能确定。
4. **文件体积**：早期 Switch mesh 输出曾到 39MB；当前产品 primitive 版本已降到 `253,177` bytes，但仍需要正式 face/vertex/SKP size budget。
5. **Git 状态**：当前主仓库历史只有初始化 commit，已有阶段性成果需要尽快按功能切片提交，避免主线状态继续漂浮。

---

## 7. 架构调整建议

短期不建议重写架构；应先做三件能直接降低主线风险的收口：

1. **对象身份层**：为 group / component instance 引入稳定 `id` / `guid`，编辑操作优先使用 `target_id`，`name` 只保留为兼容 fallback。mock snapshot、queue snapshot 和 DSL 都要同时承载该字段。
2. **Operation contract 测试**：已新增基础测试，自动检查 manifest、mock runtime dispatch、Ruby queue dispatch、component definition dispatch 的 op 覆盖一致性；下一步把 runtime partial/support 状态也变成测试门槛。
3. **模块边界拆分**：在新增大能力前，先把 `geometry.mjs` 和 Ruby 插件按 editing、primitive geometry、product helpers、architecture helpers、snapshot/QA 分层，减少新增 op 的重复接线成本。

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
