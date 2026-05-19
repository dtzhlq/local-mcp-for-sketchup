# Image Structured Modeler Memo

更新时间：2026-05-13

## 当前结论

子项目已经从“方向和 schema”推进到“可运行的 CV baseline”。现在能对 `test/手柄` 生成多图 observations 和 review overlays，并且有子项目级 schema/test harness。

Milestone A 的 Switch 半自动闭环已经打通：`observations.json -> model-plan.json -> output.json -> mock build`。Milestone B 的基础形态也已落地：`manual-corrections.json` 能进入 model plan，`review/index.html` 能汇总 overlay、parts、corrections 和 output DSL 统计。Milestone C 的 queue runtime baseline 也已跑通并保存真实 `.skp`。但它仍是 baseline，不是最终产品级几何质量。

粗略判断：

- Switch-only 可演示闭环：约完成 75%-80%。
- 原 6 周 MVP：约完成 50%-55%。
- 剩余重点是 corrections 质量提升、warning 分类、queue/mock 对照报告，以及产品向 DSL primitive 的质量提升。

## 已完成

- `schema/model-plan.schema.json` 初版，并允许未知物理尺寸用 `null` 表示。
- `schema/image-observation.schema.json` 初版。
- `schema/image-set-observation.schema.json`，用于多图 observations。
- `examples/switch-controller/model-plan.example.json` 示例。
- `scripts/analyze-image-set.mjs`：
  - 读取图片目录。
  - 缩放图片。
  - Sobel 边缘检测。
  - 主体 bbox。
  - 垂直对称轴候选。
  - 视角启发式分类。
  - 可选读取 `model-plan.example.json` 的 `views[]` 作为人工 view hints。
- `scripts/make-review-overlay.mjs`：
  - 基于 observations 生成 overlay PNG。
  - 当前 overlay 包含 edge sample、bbox、symmetry axis、view label 和 metrics。
- `examples/switch-controller/observations.json`：
  - 当前 6 张图已生成。
  - 视角覆盖：front / rear / right / oblique。
  - 缺失：true top。
  - image set quality：medium。
- `examples/switch-controller/review-overlays/*.png`：
  - 6 张 900x675 overlay。
- `scripts/generate-model-plan.mjs`：
  - 将 observations 转成半自动 `model-plan.json`。
  - 目前使用 Switch controller layout prior，不是完全自动语义识别。
- `scripts/compile-plan-to-sketchup-dsl.mjs`：
  - 将 `model-plan.json` 编译成现有 SketchUp JSON DSL。
  - 第一版使用 `mesh`、`box`、`domed_surface`、`bowed_panel`、`lofted_solid`、`component_definition`、`component_instance` 近似产品几何。
- `schema/manual-corrections.schema.json`：
  - 定义人工修正格式，支持 scale 和 part add/update/remove。
- `examples/switch-controller/manual-corrections.json`：
  - 当前锁定 280mm × 155mm × 42mm 的 baseline 尺寸。
  - 保存 review open questions。
- `scripts/make-review-report.mjs`：
  - 生成 `examples/switch-controller/review/index.html`。
  - 汇总 image quality、overlay、component candidates、model plan parts、manual corrections 和 output DSL operation counts。
- `examples/switch-controller/model-plan.json`：
  - 当前 9 个 parts：center grip、left/right shell、rear grip pair、left/right thumbstick、ABXY、left button cluster、shoulder rail pair。
- `examples/switch-controller/output.json`：
  - 当前 44 个 operations。
  - mock snapshot：12 groups / 16 instances / 1500 faces / 2376 edges / 2 scenes。
  - warning：22 个 geometry overlap warn，0 个 error；当前主要来自接触/叠放近似。
- `output/image-structured-switch-controller.skp`：
  - 已由 SketchUp 2026 queue runtime 真实保存。
  - 文件大小：211,680 bytes。
  - queue snapshot：12 groups / 16 instances / 1500 faces / 2376 edges / 2 scenes。
  - queue warnings：4 个 `material.pbr_unsupported`，22 个 `geometry.bbox_overlap`，0 个 error。
  - 详情见 `examples/switch-controller/QUEUE_VERIFICATION.md`。
- `sketchup_plugin/alma_sketchup_mcp.rb`：
  - reset 清理已增强：清 entities、pages、未使用 component definitions，再 purge materials。
  - 修复了真实 SketchUp session 中旧 `Sree_*` 材质污染 snapshot 的问题。
- `test/validate.mjs`：
  - 校验 model-plan example。
  - 校验 observations。
  - 校验 manual corrections。
  - 校验单图 image observation 兼容现有 schema。
  - 校验生成的 `model-plan.json`。
  - 校验编译出的 `output.json` 能被 mock runtime build。
  - 校验 review report 包含关键 section。
  - 校验关键脚本存在。
- 根 package scripts：
  - `npm run image-structured:analyze-switch`
  - `npm run image-structured:generate-switch`
  - `npm run image-structured:compile-switch`
  - `npm run image-structured:review-switch`
  - `npm run image-structured:build-switch`
  - `npm run test:image-structured`

## 还差的核心工作

### 1. 让 observations 更像“建模证据”

当前 observations 主要是边缘云、bbox 和对称轴，还不是部件级证据。

下一步需要补：

- component candidates：shell、center grip、thumbstick、ABXY、rear grip、screw/slot。
- keypoints：按钮中心、摇杆中心、外壳角点、握把边界点。
- contour simplification：从 edge cloud 变成可读 polyline。
- uncertainty regions：低置信度区域要能在 overlay 中标红。
- image quality notes：透视、遮挡、反光、背景干扰要更明确。

### 2. 提升 review artifact

现在已有 `review/index.html`，够做一次审查，但还不是完整交互工作台。

下一步需要补：

- 将 report 中的 component candidates 和 manual correction examples 对齐。
- 增加 correction authoring hints，例如点击/复制 part id。
- 明确哪些 part 是 visually detected，哪些是 layout prior。
- 将不确定区域标红，目前只有文字风险和候选框。

### 3. 提升 `model-plan.json` 质量

目前已有半自动 `model-plan.json`，但仍依赖布局先验，不是真正从部件证据自动推断。

下一步需要补：

- 输入 manual corrections 和 known dimensions。
- 用 component candidates / keypoints 改变 part 参数，而不是固定模板。
- 每个 part 的 evidence 引用要更精确，尤其是按钮中心和外壳轮廓。
- 增加 uncertainty 分类：inferred / manually confirmed / visually detected。

### 4. 提升 SketchUp DSL 输出质量

当前 `output.json` 能 mock build，但几何质量仍是近似。

下一步需要补：

- 区分预期接触和真实 overlap，降低 warning 噪声。
- 用更好的 shell footprint 和 side profile 改善外壳比例。
- 加入 scene 命名和 QA metadata 规则。
- 后续有 `rounded_box` / `beveled_panel` 后替换当前 mesh approximation。

### 5. 回归测试和质量门槛

当前 test 已验证 schema 和 mock build，但还缺更严格的质量判断。

下一步需要补：

- 将 pipeline build 纳入测试或提供独立 smoke test。
- 对 snapshot 加更具体阈值：
  - bbox 接近 280mm 宽。
  - instances 数量稳定。
  - scenes 数量稳定。
  - warning 数量和类型有 budget。
- 后续再加 queue runtime 人工验证。

### 6. 产品向 DSL primitive

这部分不是马上阻塞 Switch-only baseline，但会影响模型质量。

优先级建议：

1. `rounded_box`
2. `beveled_panel`
3. `button_on_panel`
4. `screw_hole` / `slot`
5. `loft_between_profiles`
6. `shell_from_front_side_profiles`

短期策略：先用现有 primitive 做 approximation，等 pipeline 闭环后再补 DSL primitive。

## 建议下一阶段计划

### Milestone A：Switch 半自动闭环

目标：从现有手柄照片生成可 mock build 的 SketchUp DSL。

状态：done baseline。

已验证：

- `npm run image-structured:build-switch` 通过。
- `npm run test:image-structured` 通过。
- `npm test` 通过。
- `output.json` build_model mock 通过。
- snapshot 包含 shell、grip、sticks、button clusters、component instances、scene。

### Milestone B：Review 质量提升

目标：人工能可靠判断“识别错了哪里”。

状态：baseline done。

已验证：

- `manual-corrections.json` 通过 schema validation。
- corrections 中的 scale 和 open questions 已进入 `model-plan.json`。
- `review/index.html` 已生成并通过测试检查。

剩余：

- 让 report 更适合人工编辑 corrections。
- 让 corrections 不只改 scale，也能稳定改 part 参数并被测试覆盖。

### Milestone C：SketchUp 真实输出

目标：真实 SketchUp queue runtime 输出 `.skp`。

状态：done baseline。

已验证：

- SketchUp 2026 已打开并启动 `Alma SketchUp MCP Bridge`。
- queue runtime build/save 成功。
- `output/image-structured-switch-controller.skp` 可生成。
- stale materials 已清除。

剩余：

- 生成正式 mock/queue diff report。
- 将 PBR support warning 单独归类。
- 将预期接触 overlap 与真实碰撞区分。

验收：

- 真实 `.skp` 可打开。
- 文件大小可控。
- 组件命名清楚。
- 主要 warning 可解释。

当前 baseline 已满足前三项；warning 解释仍需要更细分类。

## 当前风险

- 纯 CV 视角分类不可靠，所以 Switch 示例现在使用人工 view hints；这是合理的，但文档要明确。
- 缺 true top view，厚度/深度只能由 side/rear 推断，模型比例会偏粗。
- 当前 observations 还没有语义部件识别，不能直接生成可靠 model plan。
- 现有 SketchUp DSL 产品向 primitive 不够，第一版输出会偏近似。
- 如果直接追求高质量外壳曲面，会拖慢闭环；应先让 pipeline 通，再补几何质量。

## 推荐下一步

先做 Milestone B，然后跑 Milestone C。

具体顺序：

1. 生成 HTML/SVG review report。
2. 支持 `manual-corrections.json`。
3. 让 corrections 改变 `model-plan.json`。
4. 用 queue runtime 生成真实 `.skp`。
5. 再决定是否优先实现 `rounded_box` / `beveled_panel`。
