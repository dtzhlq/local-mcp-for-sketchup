# 普通模型易用性：2026-09-11 交付进度

本记录保留当时的实机结果。随后用户明确调整过度测试范围，修订后的本轮接口交付已收尾，见[完成记录](model-accessibility-completion-2026-09-11.md)；下文未完成的原生/量化专项没有改报通过。

本轮按用户最后一次额度重置后的要求，优先修复实际问题与保存成果。没有新增供应商模型调用，没有运行正式矩阵、全量回归或保存重开测试。原计划的量化验收标准未修改，**整个计划尚未通过完整验收**。

## 实际交付

- [PBR 板件 SKP](../output/model-accessibility-delivery-2026-09-11/pbr-panel.skp)：3567396 字节，SHA-256 `a9e95b6ba282f8158bce596280ca896d90823bf151030f8c5194d5119c953495`。
- 经本人在本地批准页面授权后，正式 Gateway 任务实际给 P 应用 wood 原生材质，纹理物理重复 900 × 600 mm、旋转 0°。原生回读确认 12 个正反面 UV、材质字段、工作流及样式通过；几何和其他对象保持。SketchUp UI 的“显示逼真材质”已勾选。
- 自动流程在截图时遇到参数格式问题，没有完成其保存步骤。宿主通过 SketchUp 的“另存为”保存上述新文件，选择“不要清除”，来源 fixture 的 SHA 保持不变。没有重做材质应用、重写旧任务或补造成功凭据。
- [交付摘要](../output/model-accessibility-delivery-2026-09-11/delivery-summary.json)与[来源索引](../output/model-accessibility-delivery-2026-09-11/sources.json)记录原生结果、文件和明确边界。这是有宿主保存协助的功能交付，不是普通模型独立完成或正式对照成绩。

## 代码与用法收敛

- `model-accessibility-appearance.mjs`：PBR 截图的 `instance_path` 从字符串改为单元素数组，符合插件的真实输入契约。`test/model-accessibility-appearance.mjs` 补充与原生一致的数组约束，并只运行该定向检查一次，退出码 0。修复后未重跑整个原生流程；本轮没有导出原生近景。
- `model-accessibility-parameter-verification.mjs`：参数来源缺少 `change_plan` 时返回明确的 `INVALID_ARGUMENT`，避免空值异常；该文件语法检查通过。
- [接入指南](model-accessibility-quickstart.md)补充可调用的参数来源查询、single/all 修改与质量复核示例。日常流程保存交付后即可结束；关闭重开仅在明确要求持久化/恢复验收时执行。
- [计划](model-accessibility-plan-2026-09-07.md)按已有实现证据更新交付清单。未把重复测试作为收尾条件，也未提交 Git 或改动无关工作树内容。

## 仍保留的限制

自动 PBR 全流程在上述修复后尚未重新实机运行；原任务仍保持失败/未完成状态。参数编辑、单实例资产替换与 HDR 等完整实机路径，以及修复版本内的冷重开一致性，继续沿用[此前未完成记录](model-accessibility-delivery-status-2026-09-08.md)，不提升为通过。

三模型正式对照、每模型至少 30 个正例和未见变体验收未执行，不能宣称 90% 完成率、已证明接口增益或发布验收通过。本阶段有意避免为这些声明继续消耗额度。
