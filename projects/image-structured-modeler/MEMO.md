# Image Structured Modeler Memo

更新时间：2026-05-25

## 当前结论

子项目已经从“方向和 schema”推进到“Switch 手柄示例闭环 baseline + 第二产品泛化样例”。当前 Switch 链路能从 `test/手柄` 生成：

```text
observations.json -> model-plan.json -> output.json -> review/index.html -> mock/queue SketchUp output
```

它不是闭门造车：架构参考过 Free2CAD、Img2CAD、CSGNet、PartNet、DeepCAD 等项目，但当前实现没有直接照搬这些项目代码，而是吸收它们的思路后落成自己的确定性 CV baseline、人工 review/corrections 和 SketchUp DSL 编译器。

阶段 6 收口新增了两个发布级门槛：

- correction-driven regression：`examples/switch-controller/manual-corrections.regression.json` 会验证只改 corrections 就能改变 `model-plan.json` 里的 part 参数，并进一步改变编译后的 DSL。
- 第二产品样例：`examples/compact-remote` 通过 `object_profile: "compact_remote"` 走独立生成/编译路径，生成 `model-plan.json`、`output.json`、`review/index.html` 和 mock snapshot。

当前完成度判断：

- Switch-only 可演示闭环：约 85%。
- 通用“图片 -> 结构化 SketchUp 模型”MVP：约 65%。
- 当前优先级：先可靠，再聪明，再好看。

## 当前可用状态

- 输入：`test/手柄` 共 6 张图片。
- 视角覆盖：`front` / `rear` / `right` / `oblique`。
- 缺失视角：`top`。
- 图片集质量：`medium`。
- `observations.json`：已生成，可作为 review 和后续 model-plan 的第一版证据。
- `review-overlays/*.png`：已生成 6 张 overlay，包含 edge sample、bbox、symmetry axis、view label 和 metrics。
- `manual-corrections.json`：已接入，当前锁定 `280mm x 155mm x 42mm` baseline 尺寸。
- `model-plan.json`：当前 9 个 parts：
  - `center_grip_body`
  - `left_joycon_shell`
  - `right_joycon_shell`
  - `rear_grip_pair`
  - `left_thumbstick`
  - `right_thumbstick`
  - `abxy_cluster`
  - `left_button_cluster`
  - `shoulder_rail_pair`
- `output.json`：当前 41 个 DSL operations：
  - `reset`: 1
  - `material`: 6
  - `component_definition`: 1
  - `rounded_box`: 6
  - `domed_surface`: 2
  - `bowed_panel`: 2
  - `analog_stick`: 2
  - `button_on_panel`: 8
  - `component_instance`: 4
  - `screw_hole`: 4
  - `scene`: 2
  - `style`: 1
  - `shadow`: 1
  - `rendering_options`: 1
- Mock snapshot：
  - `24 groups`
  - `4 component instances`
  - `1776 faces`
  - `2964 edges`
  - `1212 vertices`
  - `2 scenes`
  - bbox: `280 x 174 x 40 mm`
  - warning：0 个 geometry warn，0 个 error。
- `review/snapshot-report.json` / `review/snapshot-report.md`：
  - 已接入 mock snapshot report。
  - 当前 geometry warning 为 0。
  - 当前无 `needs_geometry_review` bucket。
  - 当前分类来源不再依赖对象命名猜测；`npm run test:image-structured` 会检查 geometry warning baseline 保持为 0。
- Queue/SketchUp output：
  - `output/image-structured-switch-controller.skp`
  - 当前文件 `253,177 bytes`
  - 最近真实生成时间：2026-05-20 22:16 CST
  - 2026-05-20 已将新版插件安装到 SketchUp 2026 Plugins 目录，重启 SketchUp 后通过 Extensions 菜单启动 Bridge，并重新生成 queue artifact。
  - queue snapshot 记录见 `examples/switch-controller/QUEUE_VERIFICATION.md`。
  - `review/snapshot-report-queue.json` / `review/snapshot-report-queue.md` 已生成。
  - queue warning 分类：
    - `queue_material_limitation`: 4
    - 当前 geometry warning 为 0。
    - 当前无 `needs_geometry_review` bucket。
    - 4 个 PBR warning 来自 `runtime_material_capability`。
- Mock/queue diff：
  - `review/snapshot-diff-queue.json` / `review/snapshot-diff-queue.md` 已生成。
  - verdict：`pass`
  - level：`ok`
  - total diffs：`0`
  - warning gate：`pass`
  - mock/queue bbox：`280 x 174 x 40 mm -> 280 x 174 x 40 mm`
- Compact remote 第二样例：
  - `examples/compact-remote/observations.json`
  - `examples/compact-remote/manual-corrections.json`
  - `examples/compact-remote/model-plan.json`
  - `examples/compact-remote/output.json`
  - `examples/compact-remote/review/index.html`
  - `examples/compact-remote/review/snapshot-report.json`
  - 当前 mock snapshot：`11 groups`、`529 faces`、`1234 edges`、`452 vertices`、`2 scenes`，bbox `44 x 158 x 15.85 mm`，warnings 0。

## 已完成

- 子项目 README / PLAN / MEMO 基础文档。
- `schema/model-plan.schema.json` 初版，并允许未知物理尺寸用 `null` 表示。
- `schema/image-observation.schema.json` 初版。
- `schema/image-set-observation.schema.json` 初版。
- `schema/manual-corrections.schema.json` 初版。
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
- `scripts/generate-model-plan.mjs`：
  - 将 observations 转成半自动 `model-plan.json`。
  - 已按 `object_profile` 分流：`switch_controller` 保留 Switch layout prior，`compact_remote` 走遥控器样例 profile；仍不是完全自动语义识别。
- `scripts/compile-plan-to-sketchup-dsl.mjs`：
  - 将 model plan 编译为 SketchUp JSON DSL。
  - 已使用 `rounded_box` 改善外壳、中心握把、前面板凹槽和肩键轨道。
  - 已改用直接的 `analog_stick`、`button_on_panel`、`screw_hole` 产品 helper，替代按钮/螺丝/摇杆的粗 component overlap。
  - 已给 face dome、rear grip、thumbstick、buttons、screws 写入 `qa.expected_contacts`，用于解释当前 baseline 的预期接触/包围盒 overlap。
  - 已新增 `compact_remote` 编译路径，覆盖 rounded body、face panel、button cluster、slot_array grille、真实 `text_3d` brand label 和 review scenes。
  - 关闭了全局 transparency，SketchUp 视图不再像调试半透明图。
- `scripts/make-review-report.mjs`：
  - 生成 `review/index.html`。
  - 汇总 image quality、overlay、model plan parts、manual corrections 和 output DSL operation counts。
- `sketchup_plugin/alma_sketchup_mcp.rb`：
  - 支持 `rounded_box`。
  - snapshot 已支持 group/component instance 的 `qa` 属性，插件重载后 queue report 可使用 DSL 里的 expected contact 元数据。
  - reset 清理已增强：清 entities、pages、未使用 component definitions，再 purge materials。
  - 修复旧 `Sree_*` 材质污染 snapshot 的问题。
- `test/validate.mjs`：
  - 已去掉对 Ajv runtime import 的依赖，改为项目内轻量 JSON Schema subset validator。
  - 已校验 `review/snapshot-report.json` 和可选的 `review/snapshot-report-queue.json`，防止 warning 分类缺失。
  - 已校验 mock snapshot 中 `qa.expected_contacts` 被保留，并要求 mock geometry warning 分类全部来自该元数据。
  - 已新增 correction-driven regression，断言 manual corrections 会改变 model plan 和 compiled DSL。
  - 已新增 compact remote 第二样例校验，防止生成器/编译器回退成 Switch-only profile。
  - `npm run test:image-structured` 当前可正常退出并通过。

## 当前已知问题

- 缺 true top view，厚度、后握把和肩键深度仍然靠 side/rear 和人工尺寸推断。
- observations 仍主要是 bbox、edge sample 和 symmetry axis，还不是完整建模证据系统。
- Switch 示例仍依赖 layout prior；当前泛化靠 `object_profile` 分流和第二样例证明路径可扩展，不是完整通用语义识别。
- mock/queue warning 分类已推进到 DSL/runtime `qa.expected_contacts` 元数据；queue 侧已在 SketchUp 2026 中重新验证。
- 当前 geometry warning 已收敛到 0；correction-driven regression 第一条已经进测试门禁，下一步应增强 review/corrections authoring 工作台，而不是继续扩 allowlist。
- `QUEUE_VERIFICATION.md` 已同步最新 `rounded_box` 后的 queue 指标；后续需要改成自动生成，避免手工维护再次漂移。
- 当前 review report 能看，但还不是 correction authoring 工作台。

## 规划路线

### 阶段 1：把现有 baseline 稳住

目标：当前 Switch 示例必须可重复跑、可验证、文档不误导。

任务：

- [x] 修复 `npm run test:image-structured` 卡住问题。
- [x] 更新 `QUEUE_VERIFICATION.md` 到当前 `rounded_box` 输出指标。
- [x] 增加 mock snapshot report。
- [x] 分类当前 22 个 mock overlap warning。
- [x] 增加 queue snapshot report。
- [x] 增加 mock-queue diff report 入口。
- [x] 生成正式 mock-queue diff artifact。
- [x] 将 warning 分类下沉成测试 budget / allowlist。
- [x] 将当前 mock warning 分类推进到 DSL/runtime `qa.expected_contacts` 元数据。
- [x] 将 queue snapshot/diff 的 geometry warning 分类也推进到 `qa.expected_contacts`，并纳入测试校验。
- [x] 给当前 Switch 输出增加质量门槛：
  - bbox 接近 `280 x 174 x 40 mm`
  - groups/instances/scenes 数量稳定
  - `warning_summary.by_severity.error === 0`
  - `rounded_box` 不能回退为粗 `mesh` / `box`

验收：

- 一条命令能重建 `observations -> model-plan -> output.json -> review.html`。
- mock build 稳定通过。
- queue build warning 都能解释。
- 文档和真实产物一致。

### 阶段 2：让图片识别更像“证据系统”

目标：不是只生成 bbox，而是提取可用于建模的证据。

任务：

- 从 edge cloud 进化到 contour/polyline。
- 提取 keypoints：
  - 外壳角点
  - 按钮中心
  - 摇杆中心
  - 肩键边界
- 生成 component candidates：
  - shell
  - center grip
  - thumbstick
  - button cluster
  - screw
  - rail
- 参考 Free2CAD 做基础约束检测：
  - 对称轴
  - 平行边
  - 同心圆
  - 等距按钮阵列
- 在 review overlay 里标出证据来源和低置信区域。

验收：

- `observations.json` 中有可追踪的候选部件和 keypoints。
- review HTML 能解释“模型为什么这么生成”。

### 阶段 3：人工修正闭环产品化

目标：用户指出错处后，修正能稳定影响模型。

任务：

- 扩展 `manual-corrections.json`，支持改 part 参数：
  - 按钮中心
  - 半径
  - 外壳宽度
  - 握把厚度
  - 肩键位置
- 每个 part 增加状态：
  - `visually_detected`
  - `inferred`
  - `manually_confirmed`
- review report 显示：
  - part id
  - 当前参数
  - evidence
  - 推荐 correction 示例
- 增加测试：correction 改变后，`model-plan.json` 和 `output.json` 必须发生预期变化。
  - 当前第一条测试已落地：Switch regression fixture 会移动左摇杆、调整半径、增加 Home button，并断言编译 DSL 同步变化。

验收：

- 不改代码，只改 corrections，就能调整模型关键比例。
- 人工 review 能进入下一轮构建。

### 阶段 4：提高 SketchUp 几何质量

目标：模型从“结构正确”提升到“看起来像产品”。

任务：

- 继续补产品 primitive：
  - `button_on_panel`
  - `recess`
  - `screw_hole`
  - `slot`
  - `beveled_panel`
  - `shell_from_front_side_profiles`
- Switch 编译器从固定模板改成根据 evidence/part 参数选择 primitive。
- 减少硬贴/穿插，用 recess 和 contact metadata 替代粗 overlap。
- 做 front/top/oblique 三个 QA scene。

验收：

- Switch 模型不再主要依赖 box/粗 mesh。
- warning 明显减少，或者都被标为 expected contact。
- `.skp` 打开后能作为可继续编辑的产品模型。

### 阶段 5：开始泛化

目标：证明不是只为一个手柄硬编码。

任务：

- 增加第二个产品样例，优先选鼠标、遥控器或小电器外壳。
- 把 Switch-specific prior 收敛到 `object_profile`。
- 抽象通用 part taxonomy：
  - shell
  - panel
  - button
  - stick
  - slot
  - screw
  - grip
- 评估是否引入 VLM：只用于语义判断，不替代几何测量。

验收：

- 第二个产品能跑完整链路。
- Switch 专用逻辑减少。
- VLM 是否接入有明确成本/收益判断。
- 当前第二样例已落地：`compact-remote` 可跑 observations → model-plan → output → review → mock snapshot，warnings 0。VLM 仍不接入发布阻塞路径。

## 推荐下次开工入口

从阶段 6 之后继续：

1. 提升 review/corrections 工作台，让人工修正能更直接影响 part 参数。
2. 继续把 `object_profile` 扩到鼠标、小电器外壳等第三样例。
3. 保持 mock/queue geometry warning budget 为 0，避免产品 primitive 回退到粗 overlap。

## 2026-05-19 交接记录

本轮已经完成：

- `npm run test:image-structured` 卡住问题已修复：`test/validate.mjs` 不再依赖 Ajv runtime import，改用项目内轻量 JSON Schema subset validator。
- `image-structured:snapshot-switch` 已接入常规 `image-structured:build-switch`，默认生成 mock snapshot report：
  - `examples/switch-controller/review/snapshot-report.json`
  - `examples/switch-controller/review/snapshot-report.md`
- `image-structured:snapshot-switch:queue` 已接通真实 SketchUp queue runtime，并在用户启动 SketchUp + Alma Bridge 后成功跑通。
- 最新真实 `.skp`：
  - `output/image-structured-switch-controller.skp`
  - 文件大小：`227,317 bytes`
  - 生成时间：2026-05-19 14:32
- 最新 queue snapshot：
  - `12 groups`
  - `16 component instances`
  - `1632 faces`
  - `2772 edges`
  - `1196 vertices`
  - bbox：`280 x 174 x 40 mm`
- 最新 warning 分类：
  - mock：22 个 geometry warnings 全部 classified，无 `needs_geometry_review`
  - queue：26 个 warnings 全部 classified，无 `needs_geometry_review`
  - queue buckets：
    - `queue_material_limitation`: 4
    - `intentional_shallow_overlap`: 2
    - `expected_grip_attachment`: 6
    - `expected_mounted_detail`: 14
- `test/validate.mjs` 已校验 mock report 和 queue report 的 warning buckets。
- 已修复一个并发隐患：子项目 snapshot/test 使用独立 mock session，避免和根 `npm test` 同时写 `.session/mock-model.json`。
- 文档已同步：
  - `README.md`
  - `PLAN.md`
  - `MEMO.md`
  - `examples/switch-controller/QUEUE_VERIFICATION.md`

本轮最后验证通过：

- `npm run image-structured:snapshot-switch:queue`
- `npm run test:image-structured`
- `npm test`

继续工作记录（2026-05-19 下午）：

- 已在 `projects/image-structured-modeler/scripts/make-snapshot-report.mjs` 增加 runtime diff 模式：
  - `--compare-runtime queue`
  - 默认输出 `snapshot-diff-queue.json` / `snapshot-diff-queue.md`
  - 内部复用 `src/bridge.mjs` 的 `compare_model`，最终仍走 `src/snapshot-diff.mjs`，没有另造平行 diff 系统。
- 已新增 npm 命令：
  - `npm run image-structured:diff-switch:queue`
- diff report 会记录：
  - mock/queue totals、bbox、scene/material parity
  - `src/snapshot-diff.mjs` 产生的 `report.summary` / `top_issues` / `diffs`
  - mock/queue 两侧 warning classification delta
  - `warning_gate.ok`
- 已用 mock/mock smoke test 验证新 diff 路径能跑通：
  - `npm run image-structured:snapshot-switch -- --compare-runtime mock --output-dir output/image-structured-modeler/diff-smoke --json-name snapshot-diff-mock.json --markdown-name snapshot-diff-mock.md`
  - 结果：`0` diffs，warning gate pass。
- 当时还没有生成正式 `snapshot-diff-queue.*` artifact：那轮检查时 SketchUp queue runtime 未响应，`get_capabilities --runtime queue --timeout-ms 5000` 超时；Computer Use 显示 SketchUp 2026 不是 running 状态。后续 2026-05-19 晚间和 2026-05-20 的记录已经覆盖这个状态。
- `test/validate.mjs` 已增加 optional queue diff report 校验；当 `snapshot-diff-queue.json` 存在时会校验 runtime、error diff、warning gate 和当前 warning bucket baseline。
- `README.md`、`PLAN.md`、`QUEUE_VERIFICATION.md` 已同步新命令和当前状态。
- 已新增 `projects/image-structured-modeler/scripts/lib/warning-budget.mjs`，报告生成和测试共用同一套 warning classifier / budget evaluator。
- 已新增 `projects/image-structured-modeler/examples/switch-controller/warning-budget.json`：
  - mock：`intentional_shallow_overlap=2`、`expected_grip_attachment=6`、`expected_mounted_detail=14`
  - queue：额外允许 `queue_material_limitation=4`
  - `max_error_warnings=0`
  - `max_needs_review=0`
- `npm run test:image-structured` 已接入 warning budget，并增加当前 Switch 输出质量门槛：
  - bbox 必须保持 `280 x 174 x 40 mm`
  - groups=`12`、instances=`16`、scenes=`2`
  - warning error 必须为 `0`
  - DSL 不能回退到粗 `mesh` / `box`
- 用户重新打开 SketchUp 后，`get_capabilities --runtime queue` 已通过，正式 queue artifact 已重新生成：
  - `output/image-structured-switch-controller.skp`
  - 文件大小：`227,322 bytes`
  - 生成时间：2026-05-19 18:06
- `npm run image-structured:diff-switch:queue` 已通过，生成：
  - `examples/switch-controller/review/snapshot-diff-queue.json`
  - `examples/switch-controller/review/snapshot-diff-queue.md`
  - 结果：`pass` / `ok` / `0` diffs / warning gate pass
- `npm run test:image-structured` 现在会校验 `queue_diff_report: true`。

## 2026-05-20 queue reload verification

本轮继续验证了 SketchUp queue runtime 的新版插件链路：

- 已把仓库新版 `sketchup_plugin/alma_sketchup_mcp.rb` 覆盖安装到 `~/Library/Application Support/SketchUp 2026/SketchUp/Plugins/alma_sketchup_mcp.rb`，原文件备份为 `alma_sketchup_mcp.rb.bak-20260520-qa`。
- 重启 SketchUp 2026 后，通过 Ruby Console 启动 Bridge timer。
- `node src/cli.mjs get_capabilities --runtime queue --timeout-ms 30000` 通过，runtime compatibility 为 `ok`。
- `npm run image-structured:snapshot-switch:queue` 通过，重新生成：
  - `output/image-structured-switch-controller.skp`
  - 文件大小：`228,627 bytes`
  - 生成时间：2026-05-20 10:28 CST
  - `review/snapshot-report-queue.json`
  - `review/snapshot-report-queue.md`
- queue snapshot warning source 已验证：
  - `runtime_material_capability`: 4
  - `qa.expected_contacts`: 22
  - 不再依赖 `name_heuristic` 分类当前几何 warning。
- `npm run image-structured:diff-switch:queue` 通过：
  - 结果：`pass` / `ok`
  - total diffs：`0`
  - warning gate：`pass`
  - expected warning source：`qa.expected_contacts=22`
  - actual warning source：`runtime_material_capability=4`、`qa.expected_contacts=22`
- `test/validate.mjs` 已收紧：当 queue snapshot/diff report 存在时，也会要求 queue geometry warning 分类全部来自 `qa.expected_contacts`。

下次直接继续：

1. 后续减少粗 overlap 时，同步收紧 `warning-budget.json` 的 expected bucket baseline。
2. 开始把按钮/螺丝从粗 component overlap 改为 `button_on_panel`、`recess`、`screw_hole` 等更具体的产品 primitive。
3. 增强 review/corrections 工作台，让 corrections 改 part 参数并进入回归测试。

## 2026-05-20 overlap reduction slice

本轮已执行第一轮几何 warning 收敛：

- Switch DSL 已将摇杆、按钮和螺丝从粗 component overlap 改为直接产品 helper：
  - `analog_stick`: 2
  - `button_on_panel`: 8
  - `screw_hole`: 4
  - LED 仍保留 `component_definition` / `component_instance` 复用。
- Face dome 改为贴在 shell 上方，并缩小 bbox 深度；mounted details 改为从 face dome 顶部以上生成。
- Mock snapshot：
  - `24 groups`
  - `4 component instances`
  - `1776 faces`
  - `2964 edges`
  - `1212 vertices`
  - bbox：`280 x 174 x 40 mm`
  - geometry warnings：`22 -> 0`
- Queue snapshot：
  - `24 groups`
  - `4 component instances`
  - `1776 faces`
  - `2964 edges`
  - `1244 vertices`
  - `.skp` 文件大小：`253,177 bytes`
  - queue warnings：`26 -> 4`，全部是 SketchUp PBR capability warning。
- Mock/queue diff：
  - 结果：`pass` / `ok`
  - total diffs：`0`
  - warning gate：`pass`
- `warning-budget.json` 已同步收紧：
  - mock：无 warning bucket
  - queue：`queue_material_limitation=4`
- `npm run test:image-structured` 和 `npm test` 均已通过。

下次直接继续：

1. 开始扩展 `manual-corrections.json`，让 part 参数调整进入 model plan、DSL 和回归测试。
2. 继续把 review/corrections 工作台产品化。
