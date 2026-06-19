# Anime Yellow 建筑单体图片结构化测试发现

日期：2026-06-13

范围：`test/建筑单体/` 中的单体建筑截图，以及裁掉无关黑色截图面板后的可见画面 `input-visible-crop.png`。

本轮链路：

```text
图片输入
-> analyze-image-set.mjs
-> VisionEvidenceSet v1
-> PartGraph
-> quality gate
-> SketchUp compile gate
-> blocked before DSL / mock / queue
```

当前产物：

- 裁剪单图观察：`observations.cropped.json`
- 裁剪单图证据集：`vision-evidence-v1-report.cropped.json`
- 裁剪单图 PartGraph：`part-graph.cropped.json`
- 裁剪单图质量报告：`quality-report.cropped.json`
- 完整目录观察：`observations.json`
- 完整目录证据集：`vision-evidence-v1-report.json`
- 完整目录 PartGraph：`part-graph.generated.json`
- 完整目录质量报告：`quality-report.json`
- 编译结果：被 `building_single_urban_oblique` 的 `geometry_gate` 拦截，没有生成 Review-helper DSL。
- SketchUp 结果：没有进入 mock / queue 构建；旧的 `.skp`、mock/queue snapshot、stale DSL 已清理。

结论：这轮已经使用 `projects/image-structured-modeler` 的图片结构化链路，而不是手写建筑模型。它能把正立面、近侧内凹立面、矩形风管/HVAC、阴影或真实凹面边界分成待复核语义候选；但它不能从单张 oblique 截图自动产出可信完整建筑模型。质量门禁失败是正确结果，当前修复后的行为是直接阻止 SketchUp DSL 编译。

更正：第一版 review-helper 曾把 9 个待复核部件编译成 9 个几乎重叠的默认 `rounded_box`，这是错误产物。第二版只输出 overlay `image_plane`，仍然不应进入 SketchUp。现在 `building_single` 在未过 `geometry_gate` 时不会生成 DSL，也不会进入 mock/queue。

## 本轮结果

- `profile` 已正确识别为 `building_single`，不再落到旧的 `switch_controller` 默认 profile。
- 裁剪单图只检测到 `oblique` 视图，缺少 `front`、`left`、`top`。
- 完整目录双图检测到 `oblique` 和 `front`，仍缺少 `left`、`top`。
- 裁剪版主体框为 `[47, 65, 1000, 606]`，`object_bbox_ratio=1.65`，比全截图版本少受下方黑色截图面板干扰。
- `VisionEvidenceSet v1` verdict 为 `review`：`masks=1`、`keypoints=5`、`regions=10`、`relations=177`、`scale_anchors=0`、`accepted_edges=0`。
- 完整目录双图的 `VisionEvidenceSet v1` 仍为 `review`：`masks=2`、`keypoints=10`、`regions=13`、`relations=194`、`scale_anchors=0`、`accepted_edges=0`。
- 原始完整截图现在会先触发 `auto_screenshot_chrome_v1` content frame：下半部黑色截图面板被记录为 `image.content_frame.removed_regions[]`，主 bbox 和后续候选生成只使用有效画面；手工裁剪图不会被二次裁剪。
- 裁剪单图 `PartGraph` 生成 9 个部件：1 个 `observed`，4 个 `inferred`，4 个 `needs_review`，全部 `fallback_state=needs_review`。
- 完整目录双图 `PartGraph` 生成 9 个部件：4 个 `observed`，4 个 `inferred`，1 个 `needs_review`，全部 `fallback_state=needs_review`。
- 裁剪单图质量门禁失败：`needs_review_ratio=0.444`，`observed_parts=1`，`inferred_parts=4`，`scale_confidence=0.29`。
- 完整目录双图质量门禁失败：`observed_parts=4`，`inferred_parts=4`，`scale_confidence=0.618`。
- SketchUp compile gate 阻止编译：`needs_review_ratio 0.444 exceeds 0.12`、`observed_parts 1 is below 8`、`inferred_parts 4 is below 20`、`scale_confidence 0.29 is below 0.7`、`promoted_geometry_parts 0 is below 1`。
- 完整目录双图也被 SketchUp compile gate 阻止编译：`observed_parts 4 is below 8`、`inferred_parts 4 is below 20`、`scale_confidence 0.618 is below 0.7`、`promoted_geometry_parts 0 is below 1`。
- `output.review-helper.cropped.json` 不会被写出；compile 失败时会删除 stale output，避免旧 DSL 被误用。

## 测试发现

| ID | 分类 | 问题 | 本轮证据 | 后续要求 |
|---|---|---|---|---|
| `F-001` | `SUBPROJECT` | 单张 oblique 图不足以确定完整建筑几何。 | 缺 `front/left/top`；scale confidence 只有 `0.29`；无 scale anchors。 | 产品入口必须要求已知尺寸、第二视角、正交图，或明确进入人工复核模式。 |
| `F-002` | `SUBPROJECT` | 原始截图包含无关黑色面板，会污染主体 bbox 和候选区域。 | 全截图 overlay 的候选框下探到黑色面板；裁剪版主体框回到可见建筑区域。 | 已补 `auto_screenshot_chrome_v1` content frame，先剔除大块近黑截图 chrome；后续仍需扩展到更多截图 UI / 黑边形态。 |
| `F-003` | `SUBPROJECT` | 近距离侧墙内凹面不能并入正立面。 | PartGraph 现在显式生成 `front_facade_plane` 和 `recessed_side_facade_plane` 两个候选，并标记复核。 | 增加 facade plane segmentation：分离正立面、回折面、凹面、遮挡边界，再允许编译几何。 |
| `F-004` | `SUBPROJECT` | 光影既提供形体线索，也会制造假边界。 | `shadow_or_recess_boundary` 是 `observed`，但 fallback 仍为 `needs_review`；open question 要求标注阴影和真实凹面。 | 增加 shadow-aware edge classification，把 cast shadow、ambient occlusion、真实转角分开。 |
| `F-005` | `SUBPROJECT` + `MAINLINE` | 矩形风管/HVAC 不能按圆管建模。 | PartGraph 新增 `rectangular_utility_ducts`，证据 note 明确 “do not model as round pipes without review”。 | 建立 utility grammar：矩形风管、圆管、线缆、机箱、支架要有不同 primitive 或 compiler pattern。 |
| `F-006` | `QA` | queue 成功不能代表复刻通过；失败样例不应进入 queue。 | 当前修复后 compile gate 在 DSL 前失败；旧 `.skp` 和 queue snapshot 已清理。 | 保存模型时要携带 review/fail 状态；UI 不能把 queue 成功等同于图像理解成功。 |
| `F-007` | `PRODUCT` | 上传图片不应该依赖样例脚本重写。 | 本轮临时补了 `building_single` profile、view hints 和 product profile，才让普通图片进入结构化链路。 | 建立正式 intake router：上传图片 -> profile 推断 -> 必要裁剪 -> 证据集 -> PartGraph -> gate -> review/compile。 |
| `F-008` | `SUBPROJECT` + `MAINLINE` | 未通过门禁的 PartGraph 不能 fallback 成默认 3D 盒子。 | 第一版 review-helper 的 9 个候选被编成同尺寸重叠 `rounded_box`，误导性很强；当前 compiler 已按 profile gate 阻止。 | compiler/generator 必须区分 `review_only`、`visual_helper`、`promoted_geometry`；未 promoted 的部件不能进实体几何。 |
| `F-009` | `SUBPROJECT` | 单靠 bbox / profile prior 给 `front_facade_plane`、`recessed_side_facade_plane` 命名会把立面坐标系弄反。 | 2026-06-18 的手工 v2 SketchUp probe 把带店面和窗带的长立面正射化，并把近端浅色窄墙、左侧内凹服务面处理成附属边；用户复核指出正立面和侧立面完全错误。 | `building_single` 必须先输出 `facade_plane_graph`，包含每个可见立面的 `visible_quad_px`、`plane_role`、`orientation_hint`、`adjacency`、`occlusion_order`、`must_not_merge_with[]` 和人工/VLM 来源；没有 plane graph 时不得生成 promoted geometry。 |
| `F-010` | `QA` | 手工纠偏 probe 不能被当作子项目能力进展。 | v2 probe 依赖人工看图写 DSL，且立面关系仍错误；它只证明当前自动几何层缺失，不证明结构化能力可发布。 | 后续 demo 只接受由 intake artifact、plane graph、review decision 和 PartGraph promotion patch 共同生成的模型；手写 DSL 只能作为失败对照或目标规格草图。 |

## 2026-06-18 失败复盘：v2 几何 probe

这次 `yellow-building-promoted-geometry-probe-v2` 不应作为修复成果。

错误点：

- 把右侧带窗带、空调和底层店面的长立面处理成近似正射的 `front_facade_plane`。
- 把中间近距离浅色窄墙弱化成边框，实际它是关键可见转折立面，包含小窗、通风盒、线缆和底部门洞。
- 把左侧内凹服务面和近端墙的前后遮挡关系做错；方形风管虽未误建成圆管，但所在 plane 和遮挡层级仍不可信。
- 试图通过增加窗、HVAC、雨棚、风管细节弥补 plane assignment 错误，方向错误；立面平面没分对时，细节越多越误导。

正确边界：

- 不能回退整个子项目，因为 compile gate / review-only gate 阻止 raw auto 垃圾模型进入正式输出是正确的。
- 需要回退的是“从语义 role 直接生成几何”的思路：`front_facade_plane` 这类 role 只能是候选标签，不能直接等价为建模坐标系。
- 下一步必须先建立 `facade_plane_graph`，再谈窗、门、HVAC、风管、店面和屋顶构件的 plane-local 布局。

## 边界结论

这次比手写模型更接近正确产品流程，但它不是“自动复刻建筑”的完成状态。

正确的进步点是：系统现在能把你指出的错误类型转成结构化对象和 open questions，包括近侧内凹面、正立面分割、矩形风管、阴影/凹面歧义。错误不再被静默吞掉，也不会被强行塞进正立面、默认 3D 盒子或 SketchUp 贴图板。

仍然不能信任的点是：单张斜视图没有足够证据恢复真实平面深度、各层准确比例、背面和不可见侧、风管截面尺寸、阴影区域到底是凹面还是光照效果。

## Demo 图片建议

下一张建筑单体 demo 图最好满足：

1. 主体建筑完整、少遮挡、没有截图 UI 黑边或拼接面板。
2. 至少有一个正立面或近似正立面；如果只有斜视图，最好再给侧面或俯视/平面线索。
3. 有可见尺度锚点，例如门、楼层高度、路缘、停车线、人行道、已知尺寸标注。
4. 风管、空调、窗、雨棚等外立面细部清晰，不被强阴影覆盖。
5. 如果目标是验证“动漫截图”，优先选择透视稳定、线稿边界明确、遮挡少的建筑。

## 建议下一步切片

1. `SUBPROJECT`：把 `building_single` profile、required parts、view requirements 固化成正式 fixture，而不是临时样例配置。
2. `SUBPROJECT`：继续扩展 automatic content crop，从当前近黑截图面板扩展到更多截图 UI、黑边、文字面板和拼接边界，同时避免裁掉真实阴影或黑色建筑区域。
3. `SUBPROJECT`：做 `building_single_oblique` facade plane segmentation，输出正立面、侧/凹立面、遮挡边界的关系图。
4. `SUBPROJECT`：补 shadow-aware classifier，明确哪些边来自真实几何、哪些只是投影阴影。
5. `SUBPROJECT` + `MAINLINE`：补 utility/HVAC 语义到 DSL 的映射，避免矩形风管被圆管 primitive 误建。
6. `QA`：增加 Reference Overlay QA，要求候选框和 PartGraph 关系能回投到原图；queue 成功只能证明执行层可用，不能证明识别通过。
7. `PRODUCT`：建立正式上传入口的 router/gate/review 流程，让用户上传任意图片时自动进入图片结构化链路，而不是为每个样例重写脚本。
8. `MAINLINE`：继续把 PartGraph 编译 gate 推广到更多 profile，任何 `promoted_geometry=false` 的部件都不得绕过质量门禁落成实体几何。
