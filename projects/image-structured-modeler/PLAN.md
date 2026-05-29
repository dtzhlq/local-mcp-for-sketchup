# Image Structured Modeler — 开发计划

> 目标：从参考图片生成可审查、可编辑、结构化的 SketchUp MCP 模型计划。
> 周期：6 周，3 个 Sprint，MVP 范围。
> 基准日期：2026-05-11

---

> 说明：本文件上半部分是 2026-05-27 验收复盘后的最新执行顺序；2026-05-29 后的建模架构重构以 `../../docs/product-modeling-architecture-refactor-plan.md` 为主入口；后面的 6 周 Sprint 计划保留为历史 MVP 基线，不再作为发布判定。

## 2026-05-29 架构重构计划入口

下一阶段不是重写主线 runtime，而是把子项目输出从“图像观察 + profile prior 直接生成 DSL”推进到：

```text
ObservationSet -> EvidenceGraph -> ProductProfile -> PartGraph -> FeatureMappingPlan -> JSON DSL
```

子项目负责前三到四层：`ObservationSet`、`EvidenceGraph`、`ProductProfile` 和 `PartGraph`。主线继续负责 DSL runtime、mock/queue、operation registry 和 layout/reference QA。详细里程碑和验收标准见 `../../docs/product-modeling-architecture-refactor-plan.md`。

当前状态：

1. R1/R2 第一版已完成：root `ProductProfile` / `PartGraph` schema、`vehicle_ambulance` profile、救护车 part graph 和 part graph compiler 已落地。
2. 救护车验收 DSL 已从 part graph 编译生成，不再由脚本直接摆放 DSL object。
3. 下一步优先做 R3 Reference Visual QA，并把 correction target 指向 PartGraph 字段。
4. 子项目后续接 R4：从 contour/keypoint、跨图 part matching 和尺度校准生成/更新 PartGraph。

## 当前执行计划（2026-05-27）

当前已完成 Switch 手柄示例的端到端 baseline：`observations.json -> model-plan.json -> output.json -> review/index.html -> output/image-structured-switch-controller.skp`。阶段 6 收口补齐了 correction-driven regression 和第二产品样例：`compact-remote` 通过 `object_profile` 走独立生成/编译路径。

本轮验收后，执行目标调整：子项目暂不作为可发布阶段提交，先作为技术预览继续攻关。当前 Switch 链路读取了多张图，但模型生成仍高度依赖 Switch layout prior；它不是多图联合理解后的三维重建。救护车验收模型是人工综合多图后手写 DSL，也不代表子项目已经具备自动多视角融合能力。

执行顺序：

1. **修正发布边界**
   - 文档和 review artifact 明确区分：图片证据、模板补全、人工确认。
   - 单图输入不能静默生成和多图同等完整/同等可信的模型。
   - 子项目状态改为技术预览，不进入正式发布提交。
   - 2026-05-25 已完成第一切片：schema、model-plan、manual corrections、review report 和测试门禁均接入 `evidence_status` / `template_prior` / `manual_confirmed`；per-image 单图产物会记录 open question 和 template-prior parts。

2. **补跨图融合**
   - 建立 evidence graph：每个 part 记录来自哪些视图。
   - 记录轮廓、厚度、前后表面、按钮/开孔/凹槽/凸起的来源。
   - 记录冲突和 open questions。
   - 2026-05-25 已完成第一切片：`model-plan.review.evidence_graph` 派生 required/confirmed/missing views、sources、conflicts 和 part-level open questions；review report 与 per-image summary 已展示/记录该 graph。
   - 2026-05-27 已完成第二切片：`observations.json` 原生保存 `evidence_graph`，model-plan 优先合并 observation graph，并把 template-prior / feature fallback conflicts、open questions 和 correction suggestions 展示到 review artifact。后续仍需做真正图像侧跨图冲突检测和基于 graph 的生成器重构。
   - 2026-05-27 已完成第三切片：`model-plan.review.semantic_fusion` 把 graph evidence 融合为 per-part `status` / `decision` / `confidence` / semantic evidence / feature mapping signals / review flags，Switch 和 compact remote artifacts 已刷新并纳入 `test:image-structured`。

3. **补凹凸/特征语义**
   - 在 observation/model-plan/corrections 中增加 `concave`、`convex`、`flush`、`decal/printed`、`through_hole`、`blind_recess`。
   - 编译器根据语义选择真实 feature operations；主线不支持时必须显式降级。
   - 2026-05-27 已完成第一切片：`blind_recess -> cut_recess`、`through_hole -> cut_hole`、`convex -> add_boss/add_raised_rib` 已进入 compact remote 编译路径；review report 会显示 real feature op 或 fallback 状态。

4. **产品化人工修正**
   - `manual-corrections.json` 支持 part 参数、证据状态、凹凸语义和 feature mapping。
   - review report 显示 part id、参数、evidence、模板来源和 Correction Patch Suggestions。
   - 2026-05-27 已完成 authoring data 第一切片：`model-plan.review.correction_suggestions` 给出可复制的 `manual-corrections.json` patch 骨架。
   - 2026-05-27 已完成交互式工作台切片：review HTML 新增 Corrections Workbench，可选择建议、编辑 JSON、校验、复制和下载 `manual-corrections.workbench.json`。

5. **稳住 baseline**
   - 修复测试/验证链路。
   - 同步 `MEMO.md`、`QUEUE_VERIFICATION.md` 和真实产物指标。
   - 建立 mock/queue snapshot 对照报告。
   - 将 warning 分成 expected contact、intentional shallow overlap、real collision、bbox false positive。

6. **增强建模证据**
   - 从 edge sample 提升到 contour/polyline。
   - 提取 keypoints：外壳角点、按钮中心、摇杆中心、肩键边界。
   - 生成 component candidates：shell、center grip、thumbstick、button cluster、screw、rail。
   - 参考 Free2CAD 的约束思路增加对称轴、平行边、同心圆、等距按钮阵列检测。

7. **提升 SketchUp 几何质量**
   - 依赖主线 MCP 的 `cut_hole`、`cut_slot`、`cut_recess`、`add_boss`、`add_raised_rib`。
   - 编译器根据 evidence/part 参数选择真实 feature operation，而不是视觉 marker。
   - 已完成第一批消费：compact remote 的 button/rocker/grille 会编译为 `add_boss` / `add_raised_rib` / `cut_recess`；manual-correction regression 覆盖 decal marker 切换到真实 `cut_recess`。

8. **开始泛化**
   - 在特征编辑和多图融合稳定后增加第三产品样例。
   - 将 Switch-specific prior 收敛到可解释、可降级的 profile。
   - 抽象通用 part taxonomy。
   - 评估是否接入 VLM，只用于语义判断，不替代几何测量。

已完成/保留的原计划能力：

1. **产品化人工修正**
   - 扩展 `manual-corrections.json`，支持修改 part 参数。
   - 给 part 标记 `observed` / `inferred` / `template_prior` / `manual_confirmed`，并保留旧 `visually_detected` / `inferred` / `manually_confirmed` 兼容字段。
   - review report 显示 part id、参数、evidence sources、evidence graph、模板来源、feature semantics 和 Correction Patch Suggestions。
   - 增加 correction-driven regression tests。**已完成第一条回归：Switch regression fixture 会验证 corrections 改变 model plan、evidence status 和 compiled DSL。**

2. **提升 SketchUp 几何质量**
   - 补 `button_on_panel`、`recess`、`screw_hole`、`slot`、`beveled_panel`、`shell_from_front_side_profiles`。
   - 编译器根据 evidence/part 参数选择 primitive。
   - 用 recess/contact metadata 降低粗 overlap warning。

3. **开始泛化**
   - 增加第二个产品样例。
   - 将 Switch-specific prior 收敛到 `object_profile`。
   - 抽象通用 part taxonomy。
   - 评估是否接入 VLM，只用于语义判断，不替代几何测量。
   - **已完成第一条第二产品样例：`examples/compact-remote` 能生成 model plan、DSL、review report 和 mock snapshot。**

历史 baseline 稳定工作已完成，并已执行第一轮 overlap reduction：

- `npm run test:image-structured` 的 Ajv import 卡住问题已修复，验证脚本改为项目内轻量 JSON Schema subset validator。
- 已新增 `image-structured:snapshot-switch`，默认生成 mock snapshot report。
- 当前 mock geometry warnings 已从 22 个降到 0 个，没有剩余未分类 warning。
- 已新增并验证 `image-structured:snapshot-switch:queue`，可生成真实 SketchUp `.skp` 和 queue snapshot report。
- 已新增并验证 `image-structured:diff-switch:queue`，复用 `src/snapshot-diff.mjs` 生成 mock/queue snapshot diff report；当前正式 queue diff artifact 已生成，结果 `pass`，0 diffs。
- 已新增 `examples/switch-controller/warning-budget.json`，`npm run test:image-structured` 会用它校验 warning budget。
- 已给当前 Switch 输出增加质量门槛：bbox、groups/instances/scenes、0 error warning，以及禁止回退到粗 `mesh` / `box` primitive。
- 已把当前 mock warning 分类推进到 DSL/runtime `qa.expected_contacts` 元数据；当前 mock snapshot report 中 geometry warning 为 0。
- SketchUp 插件文件已补 group/component instance 的 `qa` snapshot 支持；2026-05-20 已安装到 SketchUp 2026 Plugins 目录、重启 SketchUp、通过 Extensions 菜单启动 Bridge，并重新跑通 `npm run image-structured:snapshot-switch:queue` 和 `npm run image-structured:diff-switch:queue`。
- 当前 queue snapshot/diff 已验证：geometry warning 为 0，4 个 PBR warning 来自 `runtime_material_capability`，mock/queue diff 为 `pass` / `ok` / `0` diffs。
- 已把按钮/螺丝/摇杆从“穿插/贴面”改成 `button_on_panel`、`screw_hole`、`analog_stick` 这类产品 primitive，并同步收紧 `warning-budget.json`。
- 已把 rear grip attachment 从粗 bbox overlap 改成接触不穿插的几何。
- 已新增 `examples/switch-controller/manual-corrections.regression.json`，`npm run test:image-structured` 会断言人工修正能改变 part 参数、按钮数量和编译后的 DSL。
- 已新增 `examples/compact-remote` 第二产品样例与 `image-structured:build-remote`，当前 mock snapshot 为 11 groups / 529 faces / 1234 edges / 452 vertices / 2 scenes，warnings 0。

---

## 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Input: 3-6 张产品照片 / 三视图 / 尺寸标注图                    │
│  (Switch 手柄、Huggy Pro 帐篷、建筑三视图...)                  │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1 │ analyze-image-set.mjs                             │
│  · 视角分类 (front/side/top/back/oblique)                      │
│  · 输入质量报告                                               │
│  · 关键轮廓线提取                                              │
│  · 对称轴检测                                                 │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2 │ make-review-overlay.mjs                           │
│  · 透视校正 → 近似正交 overlay                                │
│  · 部件边界框 + 关键点标注                                     │
│  · 不确定区域标红                                            │
│  · 输出 review artifact (SVG/PNG + JSON)                     │
└────────────────────────┬────────────────────────────────────┘
                         ▼ 人工确认 / 修正
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3 │ Model Plan 生成                                   │
│  · 部件语义树 (component tree)                                │
│  · 参数化 body/shell/button/stick/grip 描述                  │
│  · 尺寸约束 + 材质分配                                        │
│  · 输出符合 model-plan.schema.json                           │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4 │ compile-plan-to-sketchup-dsl.mjs                  │
│  · 将 model plan 编译为 SketchUp MCP JSON DSL                │
│  · 使用 component_definition/instance 复用重复部件              │
│  · 生成 scene (front/top/side/hero)                          │
│  · 分辨率控制 (resolution_hint)                               │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 5 │ 端到端验证 + QA 回路                               │
│  · 跑通 mock validation                                     │
│  · 真实 SketchUp queue 构建                                   │
│  · snapshot 质量摘要 (group/face/edge count, bbox, 体积)       │
│  · warning 分类 (预期接触 vs 真实碰撞 vs 退化面)                │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 6 │ 文档 + 技术预览收口                                │
│  · 更新主 README 链接                                         │
│  · 写技术发布文章                                              │
│  · 新增 golden example (image-structured-modeler 专用)        │
└─────────────────────────────────────────────────────────────┘
```

---

以下 Sprint 0-3 是 2026-05-11 初始计划，保留用于追踪当时的目标和取舍；2026-05-25 之后的实际执行以“当前执行计划”为准。

## Sprint 0 (Day 1-2): 快速原型验证

> 在正式 Sprint 1 前，快速验证调研发现的关键技术点，降低 Sprint 2 风险。

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| P.1 Clone & 跑通 Free2CAD | 提取几何约束检测（对称轴、平行边、同心圆）思路 | 能跑通 demo，输出约束检测流程笔记 |
| P.2 读 Img2CAD 论文 Section 3 | 提取 VLM 辅助条件分解架构 | 写 1 页笔记，明确哪些模块可直接复用 |
| P.3 验证混合策略可行性 | 用 Switch 手柄照片，测试"传统 CV 轮廓 + VLM 语义判断"组合 | 输出可行性报告：精度/延迟/成本 |

**Sprint 0 产出：**
- `docs/research-notes.md` — Free2CAD + Img2CAD 技术笔记
- `docs/feasibility-report.md` — 混合策略验证报告
- 更新后的技术选型决策

---

## Sprint 1 (Week 1-2): 基础设施 + 图像分析管线

### Week 1: Schema & Tooling + 调研落地

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 1.1 完善 schema | 补全 image-observation.schema.json 字段；参考 PartNet 递归树结构设计 component tree | 通过 AJV 校验 |
| 1.2 补全 model-plan.schema.json | 增加 product 相关 primitive 定义；参考 CSGNet 的 CSG-like 中间表示 | 覆盖 rounded_box, beveled_panel, button_on_panel |
| 1.3 搭建 test harness | 在子项目内建 `npm test` | 能跑 schema validation + golden example diff |
| 1.4 目录结构 | 建 scripts/, examples/, test/ 目录 | `tree` 输出与 PLAN 一致 |
| 1.5 技术选型确定 | 基于 Sprint 0 验证，确定 CV 库 + VLM API + 检测框架 | 写 `docs/tech-stack.md` |

### Week 2: analyze-image-set.mjs（混合策略）

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 2.1 视角分类 | 基于 EXIF + 视觉特征判断 front/side/top/back/oblique | 对 Switch 手柄 6 张图分类正确 ≥4/6 |
| 2.2 轮廓提取 | 用 OpenCV / Canvas 找主轮廓、对称轴 | 输出轮廓坐标数组 |
| 2.3 **VLM 部件语义判断** | 用多模态大模型辅助判断"这是外壳/按钮/摇杆"；与传统 CV 结果融合 | 部件类型判断准确率 ≥70% |
| 2.4 质量报告 | 生成 JSON 质量报告 | 包含 views_detected, missing_views, risk_notes |
| 2.5 示例数据 | 补全 examples/switch-controller/observations.json | 与 schema 一致，基于真实手柄照片 |

**Sprint 1 产出：**
- `schema/*.json` 稳定版
- `scripts/analyze-image-set.mjs` 初版
- `examples/switch-controller/observations.json`
- `npm test` 通过

---

## Sprint 2 (Week 3-4): Overlay + Model Plan

### Week 3: make-review-overlay.mjs（参考 Free2CAD 约束检测）

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 3.1 透视校正 | 基于对称轴 + 长直边做局部透视反推 | 生成近似正交 overlay PNG |
| 3.2 **几何约束检测** | 检测对称轴、平行边、同心圆、等距线；参考 Free2CAD 的 stroke grouping → feature 流程 | 约束检测结果在 overlay 上高亮显示 |
| 3.3 部件标注 | 在 overlay 上画 bounding box + label | SVG 可交互，或 PNG 带图例 |
| 3.4 关键点标注 | 按钮中心、摇杆中心、螺丝位置 | 坐标精度 ±5px 以内 |
| 3.5 不确定区域 | 低置信度区域标红 + 标注原因 | 用户一眼看到风险点 |

### Week 4: Model Plan 生成（参考 PartNet 递归树 + 约束传播）

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 4.1 部件语义树 | 从 observations 生成 component tree；参考 PartNet 递归分解设计 | 覆盖 Switch 手柄所有可见部件 |
| 4.2 参数推断 + **约束传播** | 根据轮廓 + 已知尺寸推断厚度、半径、间距；参考 Free2CAD 约束传播：已知总宽自动推按钮间距 | 误差 < 10% |
| 4.3 材质映射 | 将颜色/材质描述映射到 SketchUp material | 输出 material 字段符合 SketchUp MCP 材质名 |
| 4.4 完整示例 | 补全 examples/switch-controller/model-plan.json | 通过 schema 校验，可直接进 Phase 4 |

**Sprint 2 产出：**
- `scripts/make-review-overlay.mjs`
- `scripts/generate-model-plan.mjs` (或合并到 analyze)
- `examples/switch-controller/model-plan.json` 完整版
- review overlay 样例图片

---

## Sprint 3 (Week 5-6): DSL 编译 + 验证 + 发布

### Week 5: compile-plan-to-sketchup-dsl.mjs

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 5.1 Primitive 映射 | model-plan primitive → SketchUp DSL command | rounded_box, beveled_panel, button_on_panel 可用 |
| 5.2 组件复用 | 自动识别重复部件 → component_definition/instance | 同类型按钮/螺丝复用，group count 合理 |
| 5.3 Scene 生成 | 自动建 front/top/side/hero scene | camera 角度正确，bounding box 可见 |
| 5.4 完整输出 | 补全 examples/switch-controller/output.json | `npm test` 校验通过 |

### Week 6: 端到端验证 + 发布

| 任务 | 说明 | 验收标准 |
|------|------|----------|
| 6.1 Mock validation | 跑通 mock snapshot + warning summary | 0 个非预期 warning |
| 6.2 真实 SketchUp | queue runtime 构建 .skp | group/face/edge count 合理，文件 < 15MB |
| 6.3 Warning 分类 | 改进 snapshot warning 输出 | 区分预期接触/真实碰撞/退化面 |
| 6.4 回归测试 | 跑 golden-architecture + golden-product | `npm test` 全绿 |
| 6.5 文档发布 | 更新 README、写技术文章、链接到主项目 | 主 README "下一步" 标记为 done |

**Sprint 3 产出：**
- `scripts/compile-plan-to-sketchup-dsl.mjs`
- `examples/switch-controller/output.json`
- 真实 `.skp` 文件
- 技术发布文章草稿

---

## 相关项目借鉴清单

| 项目 | 领域 | 可借鉴内容 | 借鉴阶段 |
|------|------|-----------|---------|
| **Free2CAD** (SIGGRAPH 2022) | 手绘→CAD | 几何约束检测、约束传播、笔画分组→特征 | Sprint 2 Week 3-4 |
| **Img2CAD** (ECCV 2024) | 照片→参数化CAD | VLM 辅助条件分解、"识别→分解→参数化"架构 | Sprint 1 Week 2 |
| **CSGNet** (CVPR 2018) | 图像→CSG程序 | CSG-like 中间表示、程序化可解释性 | Sprint 1 Week 1 (schema) |
| **PartNet** (CVPR 2019) | 3D 部件分解 | 递归部件树数据结构 | Sprint 2 Week 4 |
| **DeepCAD** (ICCV 2021) | CAD 命令序列 | 命令序列规范、180k 数据集先验 | Sprint 3 Week 5 |
| **PrimitivesFittingLib** | 点云基本体拟合 | RANSAC 分割、plane/sphere/cylinder/cone | 后续扩展（如需点云） |

## 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 图像分析精度不够 | Phase 1-2 产出差 | **混合策略**：传统 CV 负责几何，VLM 负责语义；先做半自动 |
| VLM 成本高/延迟大 | 实时性差 | 规则兜底：VLM 只用于部件类型判断，几何计算仍用传统 CV |
| Free2CAD 约束检测难以迁移 | Sprint 2 延期 | Sprint 0 先验证；若不行改用规则-based 约束检测 |
| SketchUp DSL 新 feature operation 覆盖仍有限 | Phase 4/阶段 7 阻塞 | 主线 `cut_*` / `add_*` 第一刀和 CAD boolean/manifold 已可用，子项目 compact remote 已接入真实映射；复杂曲面、文字贴合和更多产品样例复验仍显式保留为后续风险 |
| 文件体积过大 | 产品模型 > 20MB | 强制 component 复用 + resolution_hint |
| 时间不够 | 正式发布延期 | 保持技术预览口径，先完成真实特征编辑和图像侧语义融合，再扩样例 |

## 关键原则（不变）

1. **先结构，后几何** — 不直接出 mesh
2. **先 overlay，后 3D** — 必须有人工确认环节
3. **点云只做参考** — 不作为最终输出
4. **每个部件有来源证据** — 不确定标红
5. **SketchUp 输出可编辑** — component + 命名完整

## 当前状态

- [x] README.md
- [x] schema/model-plan.schema.json (初版)
- [x] schema/image-observation.schema.json (初版)
- [x] examples/switch-controller/model-plan.example.json (示例)
- [x] scripts/analyze-image-set.mjs (CV baseline)
- [x] scripts/make-review-overlay.mjs (PNG overlay baseline)
- [x] scripts/make-review-report.mjs (HTML review baseline)
- [x] examples/switch-controller/manual-corrections.json (manual correction baseline)
- [x] examples/switch-controller/manual-corrections.regression.json (correction-driven regression)
- [x] examples/compact-remote/* (second product generalization sample)
- [x] scripts/compile-plan-to-sketchup-dsl.mjs (existing DSL approximation)
- [x] examples/switch-controller/observations.json (Switch baseline)
- [x] examples/switch-controller/model-plan.json (半自动 baseline)
- [x] examples/switch-controller/output.json (mock-buildable baseline)
- [x] output/image-structured-switch-controller.skp (queue runtime baseline)
- [x] test harness (schema validation + correction regression + dual-sample output mock build + review report)

---

*计划创建于 2026-05-11。2026-05-27 已复盘并调整为技术预览收口；当前 semantic fusion、交互式 corrections 工作台和主线 CAD boolean/manifold 已完成，下次 review：更多产品样例复验后。*
