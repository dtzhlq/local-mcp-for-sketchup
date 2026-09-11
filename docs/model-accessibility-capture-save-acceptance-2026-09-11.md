# PBR 自动截图与保存：有限实机验收通过

2026-09-11，按用户授权仅核验这一段，复用已施加材质的板件。正式外观流程和本次宿主验收共用 `captureAndSaveNativeAppearance`，实际调用原生截图、状态恢复检查和另存接口；未复制另一套截图保存实现。

- 原生材质、UV、几何保护、无关对象与样式回读通过。
- 1600×1000 图片生成，板件完整、木纹可见、非空白；不据此宣称写实光照质量。
- 截图后完整模型版本恢复，另存后文件路径、同一会话/文档与模型版本一致；文件大小 3,567,371 字节，SHA-256 为 `952f186c4738e73df48dd5e69bc725e983b08aaac26a6adb207c32388eb0fe3f`。
- 材质未重新施加，供应商调用 0 次，没有重开输出文件或运行矩阵。

本次采用隔离的宿主验收配置，直接操作仅用于用户批准的截图与另存范围；原 Gateway 配置、批准和失败任务记录未改。此前材料应用证据与本次截图保存证据分开保留，本结果不代表原失败任务恢复成功或全新 Gateway 任务端到端重跑成功。

[截图](../output/model-accessibility-delivery-2026-09-11/capture-save-acceptance/closeup/appearance.png) · [自动保存 SKP](../output/model-accessibility-delivery-2026-09-11/capture-save-acceptance/model.skp) · [验收回执](../output/model-accessibility-delivery-2026-09-11/capture-save-acceptance/acceptance.json)
