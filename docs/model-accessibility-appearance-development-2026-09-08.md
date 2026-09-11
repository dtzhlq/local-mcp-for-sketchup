# 原生外观模型可访问性：独立开发记录（2026-09-08）

本文件记录第 10 轮 `glm-flash-pbr-development`。本轮失败：`token_limit`，没有进入批准或原生修改阶段，没有保存新的 PBR SKP，不能记为模型成功、外观质量通过或正式验收。后续修复和预置文件准备单独列出；旧运行、旧任务和 105 例基准结果均未回写。

## 第 10 轮：native_pbr.development

| 项目 | 实际结果 |
| --- | --- |
| Run ID | `36f54854-a9c6-448c-94e5-3c15cbd9d84e` |
| 接口与模型 | `optimized` 四个 Gateway 工具；请求与响应均为 `glm-5.3-flash` |
| 运行性质 | 真实 provider + 本机 queue 的开发运行，`test_fixture=false`；不是正式验收 |
| Provider / 工具调用 | 16 / 23 |
| Provider 回报 token | 171184，16 条 usage 求和与 summary 相符，`usage_complete=true` |
| 用时 / 终止原因 | 420.37 秒 / `token_limit` |
| 批准暂停 / system unlock | 0 / 0；批准等待 0 秒 |
| 原生修改 / 新交付 PBR SKP | 0 / 无 |
| 独立质量评价 | `missing`；`quality_accepted=false`，live / release acceptance 均为 false |

任务要求仅给预置板件 P 应用目录木材 PBR，物理重复 900 × 600 mm、旋转 0°，启用原生显示，回读五类 PBR 通道和真实 UV，保持其他对象，保存独立 SKP并提交近景及边界结果。原始请求和四工具 schema 位于 [model-input.json](../output/model-accessibility-live-2026-09-08/glm-flash-pbr-development/model-input.json)。最终 provider 已返回第 16 次响应，但预算停止了继续派发；不能把该响应中尚未派发的工具意图算作第 24 次实际工具调用。token 上限是下一次派发门禁，累计输入和输出可在最后一次响应后超过名义 160000；此处保留实际回报值。

[run-summary.json](../output/model-accessibility-live-2026-09-08/glm-flash-pbr-development/run-summary.json) 与 [events.jsonl](../output/model-accessibility-live-2026-09-08/glm-flash-pbr-development/events.jsonl) 的哈希和计数已复核。响应模型名称只按 provider 回报记录，不推断未披露的后端版本。

## 失败链与责任边界

1. 第 1、2 次工具调用缺少 `intent`，第 5、6 次缺少 `instruction`，均被公开 schema 拒绝。这是模型调用错误，保留计数。
2. 第 6 次 provider 响应（`request_index=5`）发出首次结构合法的 `apply_native_appearance`，对应第 12 次实际工具调用，events 第 42–43 行。其输入为 `appearance:{kind:"native_pbr",preset:"wood",target:"P",texture_size_mm:[900,600],rotation:0}`、`runtime:"queue"`，却收到 `MODEL_REVISION_INCOMPLETE`。
3. 实际原生 `adopt_open_model` 把完整 revision 证明放在报告顶层，`snapshot` 没有同名字段。旧 `completeGraph` 错读 `snapshot.model_revision_complete`，把顶层完整、40/40 已索引的真实报告误拒绝。它尚未进入目标、批准、执行与保存阶段，因此不能将此轮解释为 PBR 材质或 SketchUp runtime 不支持。
4. 错误 next action 给出不能作为输入执行的 `inspect_revision_blockers`。模型第 14 次调用把它放进 `input.action`；第 16 次又把 `kind/preset/target/rotation/texture_size_mm` 平铺。旧通用 submit 在本 intent 校验前持久合并，使这些未知字段留在原任务里。第 17 次恢复正确的嵌套 `appearance` 仍被历史污染字段阻断。原任务保持 `awaiting_input`，private 中没有 appearance plan 或 execution。
5. 后续模型再次连接并读取较大连接 artifact 的小分页，增加上下文与 token，最终预算终止。整条记录没有出现批准暂停或成功 mutation，不把页面读取算作建模进展。

原失败任务见 [task_be31fac1…json](../output/model-accessibility-live-2026-09-08/glm-flash-pbr-development-state/tasks/tasks/task_be31fac1-8c82-4c58-bf68-0613c907e751.json)。本报告只引用其状态与输入，未修改该历史文件。

## 原始 fixture 与风格来源

原始板件 fixture 为 [appearance-fixture.skp](../output/model-accessibility-live-2026-09-08/appearance-fixture-native-development/appearance-fixture.skp)，45267 B，SHA-256：

`f19b972a30d03b6bfa255756d28e4223cfa86bb2d3a2d53b94cab7a00134ac17`

其完整原生 revision：

`sha256:d7855974e12e9dd098dea13045f89340a26c041d6c048db97aa283191803180a`

[host-disk-reopen.json](../output/model-accessibility-live-2026-09-08/appearance-fixture-native-development/host-disk-reopen.json) 记录风格导出前的宿主磁盘重开，完整索引 40/40、精确路径与已保存文件 SHA 检查均为 true。这是来源准备证据，不是模型完成任务后的重开证据。

宿主随后通过 SketchUp 26.2.242 原生 UI 勾选“显示逼真材质”、创建新风格并用“另存为”导出 [native-photoreal-2026.style](../output/model-accessibility-live-2026-09-08/native-photoreal-2026.style)。实际文件 4276 B，SHA-256：

`29463cad1d0c0f8029911324634158690f719f48ece18d5650f2e6362c92a06f`

[导出记录](../output/model-accessibility-live-2026-09-08/native-photoreal-2026.export.json) 记载 UI 复选框从 0 到 1、原生导出命令、`source_model_saved=false`、`formal_acceptance=false`、`loaded_into_clean_model_verified=false`。该文件不是手改 style XML，也不是假定某个 Ruby 渲染枚举。导出本身不证明模型已加载或通过 PBR 质量验证。

导出临时改动未保存到来源 fixture。运行前的 [before-provider.json](../output/model-accessibility-live-2026-09-08/appearance-fixture-native-development/before-provider.json) 记录原文件 SHA、原完整 revision、精确来源路径均恢复，CUA AX 观察到 Photoreal 复选框为 0，`model_modified=false`。运行后的 [native-after.json](../output/model-accessibility-live-2026-09-08/glm-flash-pbr-development/native-after.json) 与它的 session、document、model identity、完整 revision、实体和 `native_appearance` 逐值相同，仍 `model_modified=false`；本次复核也重新算得原 SKP 相同 SHA。

运行目录与该运行 state 目录中均无 `.skp`、appearance 执行 claim 或完成 receipt。结合执行前错误和原生前后对照，本轮原生 mutation 计为 0；这一结论仅覆盖本轮，不声称全局宿主没有其他活动。来源 fixture 的保存和 `.style` 导出均不计入本轮模型交付。

## 失败后修复，尚不替代新的实机运行

- [model-accessibility-appearance.mjs](../src/model-accessibility-appearance.mjs) 改读真实顶层完整证明，核对规范 revision、索引数与 graph 完整性；若 snapshot 意外出现矛盾证明仍拒绝。编译和执行后的验证共同使用此门禁。
- [agent-gateway.mjs](../src/agent-gateway.mjs) 在 appearance submit 的 materialization、持久合并和幂等 claim 之前校验本 intent 输入。未知字段明确拒绝且不污染原合法输入；已批准计划只允许新连接等有限提交。完整性错误给出可调用的 `discover/connect`，输入错误给出 `discover/workflows`，不再诱导把 action 名称当作输入字段。
- 保存完成的签名 receipt 现在包含实际 `getSessionState` 的 `saved_state`。[appearance receipt reader](../src/model-accessibility-appearance-receipt.mjs) 验证服务端计划、claim、完成 receipt 的 HMAC，以及准确文件、SHA、document、revision 和未修改状态；通过既有非可复制 proof 品牌接入 `reopen_delivered_model`。缺少历史签名状态的旧 receipt 拒绝，不根据当前模型反推补造。
- [appearance 定向测试](../test/model-accessibility-appearance.mjs) 使用来自真实 host-disk-reopen 的[脱敏契约 fixture](../test/fixtures/model-accessibility/native-appearance-adoption.json)，验证真实层级通过、缺失或矛盾完整证明拒绝、坏 submit 不改变 inputs、同 task 后续合法恢复以及合法 next call。[receipt 定向测试](../test/model-accessibility-appearance-receipt.mjs) 覆盖签名、旧格式、文件字节、dirty、revision、document 和原生回读失败边界。上述定向测试与既有 reopen、15 类短 workflow 测试已在本次开发会话离线通过；mock 不算实机通过。

修复未改变批准 authority、Session Contract、真实纹理哈希、原生回读、冻结计划或执行未知时不得重放的约束。保存重开结果仍不意味着应用冷启动、参数已重新绑定或外观质量通过。

当前文件仅包含第 10 轮。按用户减少 token 消耗和重复检查的要求，本阶段不启动 PBR v2、不重复已通过的离线测试；修复后的实机外观路径仍待验证。未来运行须使用新进程、新记录和相同已恢复来源，由真实模型完成批准、执行、回读、保存与重开后另记结果。文件哈希、JSON 定位、前后比对与边界见 [sources.json](model-accessibility-appearance-development-2026-09-08.sources.json)。其中代码哈希是写报告时的修复后快照，不冒称旧运行已加载修复。
