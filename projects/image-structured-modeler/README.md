# Image Structured Modeler

> 子项目：从多张参考图片生成可编辑、结构化的 SketchUp MCP 模型计划，而不是生成不可编辑的点云/三角网。

创建时间：2026-05-11

## 一句话定位

Image Structured Modeler 是 SketchUp MCP 的上游“视觉理解与结构化建模规划器”。

它不直接替代 SketchUp MCP，也不以三角网点云为最终目标；它负责把图片理解成可编辑的对象结构、约束、轮廓、部件层级和参数，最后输出 SketchUp MCP JSON DSL 或中间结构化模型计划。

```text
参考图片 / 三视图 / 实拍多角度
        ↓
Image Structured Modeler
  - 相机/视角校正
  - 轮廓与关键点识别
  - 部件语义拆解
  - 尺寸与比例约束
  - 参数化组件规划
        ↓
Structured Model Plan
        ↓
SketchUp MCP JSON DSL
        ↓
SketchUp Runtime / .skp
```

## 它和 SketchUp MCP 的关系

### SketchUp MCP 是“执行层”

负责：

- 接收安全 JSON DSL
- 生成 SketchUp 几何
- 管理材质、场景、保存文件
- 提供 mock/queue runtime
- 返回 snapshot 做质量检查

SketchUp MCP 不应该承担复杂视觉识别，否则会变成一个又大又难测的黑盒。

### Image Structured Modeler 是“理解层 / 编译前端”

负责：

- 读图片
- 判断视角和透视
- 提取轮廓、关键点、部件语义
- 形成可解释的结构化对象树
- 选择合适的 SketchUp DSL 组件
- 生成可审查的 2D overlay 和 3D plan

它输出的是干净结构，而不是直接生成一坨 mesh。

## 当前可运行入口

```bash
npm run image-structured:analyze-switch
npm run image-structured:generate-switch
npm run image-structured:compile-switch
npm run image-structured:review-switch
npm run image-structured:snapshot-switch
npm run image-structured:snapshot-switch:queue
npm run image-structured:diff-switch:queue
npm run image-structured:build-switch
npm run test:image-structured
```

`analyze-switch` 会读取 `test/手柄`，生成：

- `projects/image-structured-modeler/examples/switch-controller/observations.json`
- `projects/image-structured-modeler/examples/switch-controller/review-overlays/*.png`

`build-switch` 会串起 analyze → generate model plan → compile DSL，额外生成：

- `projects/image-structured-modeler/examples/switch-controller/model-plan.json`
- `projects/image-structured-modeler/examples/switch-controller/output.json`
- `projects/image-structured-modeler/examples/switch-controller/review/index.html`
- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-report.json`
- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-report.md`

`snapshot-switch` 会对当前 DSL 运行 mock snapshot，并把 warning 分成 expected contact / shallow overlap / needs review 等 bucket。当前 Switch DSL 会为 face dome、rear grip、thumbstick、buttons、screws 写入 `qa.expected_contacts`，warning 分类会优先使用这些元数据，而不是只靠对象命名启发式。当前 mounted detail 已改用 `analog_stick`、`button_on_panel`、`screw_hole`，rear grip attachment 已调整为接触不穿插，mock geometry warning 已收敛到 0。

`snapshot-switch:queue` 会通过 SketchUp queue runtime 生成真实 `.skp` 和 queue snapshot report，运行前需要 SketchUp 已启动 Alma SketchUp MCP Bridge。更新 `sketchup_plugin/alma_sketchup_mcp.rb` 后，需要重载插件或重启 SketchUp，queue snapshot 才会带出最新的 `qa` 元数据。

`diff-switch:queue` 会复用根项目 `src/snapshot-diff.mjs` 的 mock/queue snapshot 对比逻辑，生成：

- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-diff-queue.json`
- `projects/image-structured-modeler/examples/switch-controller/review/snapshot-diff-queue.md`

它会自动对照 totals、bbox、scene/material parity，并把 mock/queue 两侧 warning bucket 做 delta 汇总；运行前同样需要 SketchUp + Alma SketchUp MCP Bridge 正在响应 queue runtime。

当前 Switch 示例的 warning budget 在：

- `projects/image-structured-modeler/examples/switch-controller/warning-budget.json`

`npm run test:image-structured` 会读取该 budget，校验 mock/queue snapshot report 中没有 error warning、没有 `needs_geometry_review`，并锁定当前 expected bucket baseline。测试还会卡住 bbox、groups/instances/scenes、不能回退到粗 `mesh` / `box` primitive，并要求 mock 和已生成的 queue geometry warning 分类全部来自 `qa.expected_contacts`。

人工修正入口：

- `projects/image-structured-modeler/examples/switch-controller/manual-corrections.json`

改完 `manual-corrections.json` 后重新运行 `npm run image-structured:build-switch`，修正会进入 `model-plan.json`，并显示在 review report 中。

当前实现是确定性的 CV baseline：缩放图片、Sobel 边缘检测、主 bbox、垂直对称轴候选、视角启发式分类。Switch 示例会额外读取 `model-plan.example.json` 里的 `views[]` 作为人工视角 hint；通用 CLI 不传 `--view-hints-file` 时仍走纯 CV 模式。它只负责给人工 review 和后续 VLM/语义识别提供第一版证据，不直接生成最终 3D 模型。

### 两者边界

| 层级 | 负责什么 | 不负责什么 |
|---|---|---|
| Image Structured Modeler | 图片理解、部件拆解、参数计划、轮廓/关键点、建模策略 | 直接操作 SketchUp、保存 `.skp`、插件 runtime |
| SketchUp MCP | 安全 DSL 执行、SketchUp 几何落地、材质/场景/snapshot | 图片识别、相机估计、语义推理 |

## 产品化流程

### 1. 输入阶段

用户上传：

- 严格三视图：front / side / top / back
- 非正交实拍：多个角度照片
- 产品页尺寸图
- 细节特写
- 可选已知尺寸：总宽、总高、厚度、某个按钮直径等

系统先做输入质量报告：

```json
{
  "object_type": "game_controller",
  "image_set_quality": "medium",
  "views_detected": ["front", "rear", "right_side", "top_oblique"],
  "missing_views": ["true_top", "left_side"],
  "known_scale": null,
  "risk_notes": [
    "front photo has perspective distortion",
    "black glossy grip has weak contour contrast",
    "side thickness partly occluded"
  ]
}
```

### 2. 视角校正阶段

目标不是三维重建，而是把非正交照片转成更可靠的参考层。

方法：

- 找对称轴
- 找长直边/平行边
- 用已知圆形按钮在透视下的椭圆反推局部透视
- 根据对象类别套用结构先验
- 生成近似正交 overlay

输出：

- front rectified overlay
- side thickness overlay
- rear/back grip overlay
- top/depth overlay

### 3. 结构识别阶段

识别的不是像素，而是组件：

```json
{
  "components": [
    { "id": "center_grip", "type": "rounded_rect_body", "material": "black_plastic" },
    { "id": "left_joycon", "type": "rounded_panel_shell", "material": "white_plastic" },
    { "id": "right_joycon", "type": "rounded_panel_shell", "material": "white_plastic" },
    { "id": "left_thumbstick", "type": "analog_stick", "parent": "left_joycon" },
    { "id": "abxy_cluster", "type": "button_cluster", "parent": "right_joycon" },
    { "id": "rear_grip_left", "type": "lofted_handle", "material": "black_plastic" }
  ]
}
```

### 4. 人工确认阶段

必须有一个 review artifact。不要直接出 3D。

对用户展示：

- 识别到的部件框
- 关键轮廓线
- 按钮中心点
- 对称轴
- 厚度曲线
- 不确定区域标红

用户可以说：

- “右边握把再厚一点”
- “这个不是按钮，是螺丝”
- “这里是凹槽不是凸起”
- “整体宽度按 280mm 算”

### 5. 参数化模型计划阶段

把识别结果转为 DSL 前的中间表示。

```json
{
  "scale": { "unit": "mm", "known_width": 280 },
  "parts": [
    {
      "name": "left_joycon_shell",
      "primitive": "beveled_panel",
      "profile_front": [[...]],
      "profile_side": [[...]],
      "thickness": 22,
      "corner_radius": 18,
      "material": "Warm_White_Plastic"
    },
    {
      "name": "left_thumbstick",
      "primitive": "button_on_panel",
      "center": [-112, 24, 27],
      "radius": 19,
      "recess_depth": 3,
      "material": "Rubber_Thumbstick"
    }
  ]
}
```

### 6. SketchUp MCP 输出阶段

生成安全 DSL：

- `component_definition` for simple repeated markers such as LEDs
- `component_instance` for reuse
- high-level primitives: `rounded_box`, `beveled_panel`, `loft_between_profiles`, `analog_stick`, `button_on_panel`, `screw_hole`, `text_emboss`
- scenes for front/top/side/rear review

### 7. 质量回路

通过 mock snapshot 和真实 queue snapshot 检查：

- group count
- bbox 是否符合尺寸
- 组件命名是否完整
- 是否存在零面/退化面
- 碰撞 warning 是否是预期接触
- 文件体积是否异常

## 为什么不直接点云 / 三角网

点云或 AI mesh 适合“看起来像”。

但产品目标是 SketchUp 里可编辑的结构化模型，所以直接点云有明显问题：

- 没有组件语义
- 面数大
- 不好改尺寸
- 不好替换材质
- 不好对齐/布尔/开槽
- 小细节容易糊
- SketchUp 里编辑体验差

点云/AI mesh 可以作为参考，不应作为最终模型。

## 最佳路线：混合式

```text
多图视觉估计 / 粗点云 / 深度估计
        ↓ 作为参考底模
结构化部件识别
        ↓
参数化组件生成
        ↓
SketchUp MCP 执行
```

即：

- 点云帮助判断大体曲面和比例
- 语言模型帮助判断“这是什么部件”
- 参数化 DSL 负责生成可编辑模型

## 需要补的 SketchUp DSL 能力

来自 Switch 手柄测试暴露的问题：

### 形体类

- `rounded_box`
- `beveled_panel`
- `fillet`
- `chamfer`
- `loft_between_profiles`
- `shell_from_front_side_profiles`
- `pipe_between_points`
- `face_on_cylinder`

### 细节类

- `button_on_panel`
- `analog_stick`
- `recess`
- `slot`
- `screw_hole`
- `boolean_cutout`
- `engraved_line`
- `text_emboss`
- `text_engrave`

### 复用/性能类

- robust `component_definition` / `component_instance` workflows
- repeated mesh instance reuse
- adjustable curve resolution
- snapshot file-size estimate
- warning classification

## MVP 范围

第一版先不要做大而全。

建议 MVP：

1. 支持单个对象类别：game controller / product gadget
2. 输入 3-6 张图片
3. 生成人工可审查 overlay
4. 手动/半自动标注关键点
5. 输出结构化 model plan
6. 生成 SketchUp MCP DSL
7. 支持 rounded panel、buttons、sticks、grip handles、logos 的基础版本

## MVP 子模块

```text
projects/image-structured-modeler/
  README.md
  schema/
    model-plan.schema.json
    image-observation.schema.json
  scripts/
    analyze-image-set.mjs
    make-review-overlay.mjs
    compile-plan-to-sketchup-dsl.mjs
  examples/
    switch-controller/
      observations.json
      model-plan.json
      output.json
```

## 关键原则

- 先结构，后几何
- 先 overlay，后 3D
- 点云只做参考，不做最终输出
- 每个部件必须有名称、类型、材质和来源证据
- 不确定的地方标红，不要假装确定
- SketchUp 输出必须可编辑、可分组、可复用
