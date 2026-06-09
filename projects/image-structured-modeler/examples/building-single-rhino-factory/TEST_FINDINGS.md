# Rhino Factory 建筑单体测试发现

日期：2026-06-09

范围：`test/建筑群/建筑单体/` 两张 RhinoMCP 风格参考图。模型由 `projects/image-structured-modeler/scripts/build-building-single-rhino-factory.mjs` 生成，并通过 live SketchUp queue runtime 构建和保存。

当前产物：`output/building-single-rhino-factory.skp`

结论：这个模型不能作为精准复刻验收。Queue 构建和 layout QA 通过了，但人工视觉检查发现材料层、门窗、裁切和屋顶形态仍然不符合参考图；这些错误目前没有被现有测试门禁拦住。

## 分类口径

- `SUBPROJECT`：`projects/image-structured-modeler` 的视觉 grounding、结构化图形、PartGraph 提取问题。
- `MAINLINE`：主项目 `sketchup-mcp-replica` 的 DSL、mock/runtime、queue runtime 或建模 primitive 能力问题。
- `QA`：验收/报告缺口，导致视觉错误模型仍能通过。

## 测试发现

| ID | 分类 | 问题 | 本轮证据 | 后续要求 |
|---|---|---|---|---|
| `F-001` | `SUBPROJECT` + `MAINLINE` | 立面层现在是叠加的表面，不是会被门窗/边界裁切的构造层。 | 门位置改对后，下面的灰色装饰/勒脚面仍可能挡住或干扰门洞区域。墙洞被切了，但装饰立面层仍是独立 box/mesh。 | PartGraph 需要表达立面层与门窗的裁切/开口关系；主线需要立面板材裁切 operation 或 compiler 路径，不能只堆表面。 |
| `F-002` | `SUBPROJECT` | 门洞修正目前只改尺寸和位置，没有带动周边立面层级一起重算。 | 大门和小门已移动/降高，但相邻下部立面处理没有按参考立面同步更新。 | PartGraph 中门必须拥有周边关系：勒脚中断、雨棚对齐、门槛/基座关系、可见净空。Correction 应该改 PartGraph 关系，不只是改 x/z/w/h。 |
| `F-003` | `SUBPROJECT` | 侧立面窗户仍然不对。 | 侧窗缩窄并居中后，人工视觉检查仍然判定侧立面错误。说明下方侧立面需要单独裁图校准，不能照前立面比例猜。 | 增加侧立面专用 fixture：源图裁切 landmark、上部长窗范围、下窗数量/间距、橙色板约束、侧立面坐标系。 |
| `F-004` | `SUBPROJECT` + `MAINLINE` | 屋顶采光窗/屋顶监控体形态错误；参考应是弧形/曲面，不是矩形盒子。 | 参考立面显示屋顶采光窗是弧形盖面；生成模型使用 `Roof_Monitor_To_15_1m` 矩形 box。 | 子项目要从立面识别 `arched_roof_light` / `barrel_vault_skylight`；主线要提供语义化弧形采光窗 helper，或稳定的 arc-extrusion/loft 工作流。 |
| `F-005` | `MAINLINE` | 缺少高层建筑立面裁切 primitive。 | 主线有 generic boolean、`panel_with_openings`、mesh、loft、curved-wall helper，但本例需要“按这些门窗和边界裁掉装饰板/彩钢板”的稳定建筑操作。 | 增加 `facade_panel_with_openings`、`clip_panel_to_openings` 或等价 compiler pattern，能在 mock 和 queue 中安全地产生 cutter 并执行 `boolean_difference`。 |
| `F-006` | `QA` | Layout QA 通过，但视觉复刻失败。 | `model-qa-report-queue.md` 报告 `pass`、0 issues；人工检查仍发现侧窗、屋顶曲面和立面遮挡错误。 | 为该样例增加 Reference Visual QA：前/侧正交视图检查、门窗期望位置、立面层裁切/遮挡检查、弧形采光窗形态检查。 |
| `F-007` | `QA` + `SUBPROJECT` | 当前流程过度接受事后手调坐标。 | 这轮修正主要通过人工反馈后调整 DSL 参数完成。它能迭代模型，但不能证明 image-structured pipeline 理解了源图。 | 把失败点转成 fixture：源图证据、期望关系、PartGraph 字段、负例测试，让当前错误模型被自动打回。 |

## 边界结论

这不只是“能不能截断模型”的单点失败。

主线已经有部分 boolean 和 panel-with-opening 能力，但当前建筑生成器没有把彩钢板/装饰层表达成具备裁切语义的构造层。更深的问题是整条链路缺失：

```text
参考立面证据
-> 立面 / 门窗 / 材料层关系
-> PartGraph 裁切与曲率意图
-> 能保留这些关系的 DSL operation
-> 关系错误时会失败的 Reference Visual QA
```

在这条链路补齐前，看起来“差不多”的叠面几何可以通过 queue/layout QA，但仍然会和参考图不一致。

## 建议下一步切片

1. `SUBPROJECT`：为这两张图创建 `building_single_elevation` grounding fixture，分别记录主立面、侧立面、橙/灰材料区、门窗 landmark、雨棚关系和屋顶采光窗曲率。
2. `MAINLINE`：新增或证明一个 trim-aware facade panel operation，能按门窗和边界裁掉装饰/勒脚/彩钢板表面。
3. `MAINLINE`：新增弧形采光窗 / barrel-vault helper，或标准化一个 mock/queue 一致的 mesh/loft 弧形面 helper。
4. `QA`：为该样例增加 Reference Visual QA spec，即使 layout QA 通过，也能打回当前的矩形采光窗、错误侧窗和立面层遮挡。
