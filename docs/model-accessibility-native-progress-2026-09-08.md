# 普通模型易用性：原生资产与取景验证

日期：2026-09-08。以下是本机 SketchUp 2026 的开发验证，不能计作三模型正式验收。原始来源及 SHA-256 见 [来源索引](model-accessibility-native-progress-2026-09-08.sources.json)。

## 已生成的真实资产

三份资产均在独立打开的空白 Woodworking 模板中逐一生成，检查完整根和实际外包尺寸后保存。没有清空已有模型，没有覆盖模板或资产源。建模、原生回读、保存及保存后版本检查分别落盘；每次保存后关闭该文档，再打开原模板准备下一份资产。

| 资产 | 原生外包尺寸，宽 × 深 × 高（mm） | 文件字节数 | 文件 |
|---|---:|---:|---|
| chair | 726 × 689.224059 × 959.251362 | 345669 | [chair.skp](../output/model-accessibility-live-2026-09-08/native-chair/chair.skp) |
| stool | 440 × 440 × 460 | 77155 | [stool.skp](../output/model-accessibility-live-2026-09-08/native-stool/stool.skp) |
| armchair | 886 × 794.970633 × 1057.457266 | 348155 | [armchair.skp](../output/model-accessibility-live-2026-09-08/native-armchair-v2/armchair.skp) |

椅子与扶手椅复用项目已有构造配方；凳子是圆角座面、四条圆腿、脚垫与裙板组成的独立构造，不是给椅子改名。目录记录实际原生外包尺寸；配方名义宽深不能替代最终占用空间。

[本轮资产目录](../output/model-accessibility-live-2026-09-08/native-assets-catalog.json)绑定三个实际文件、SHA、轴向、来源和现有许可说明。查询接口保留 `native_verified=false`：可编辑目录中的记录与新导入实例的现场验证是不同证据。源模型准备不证明导入、替换、同伴保护或磁盘重开已经通过。

源 JSON 的初版哈希包含编译对象中 JSON 不会保存的 undefined 字段，执行前校验即拒绝，未建模；修复后以序列化后的 DSL 计算哈希并生成 `native-asset-sources-v2`。扶手椅第一次读取因文件打开对话框尚未关闭而超时，仅发生只读请求；完成打开后在新的 `native-armchair-v2` 目录执行成功。旧记录保留。

## 总览取景修正

GLM-Flash 窗 development-v5 原有总览触及画面边缘。新 common-task 总览使用既有原生接口的完整根外包范围自动正交取景；细节近景继续使用专门目标相机。

插件完整退出、安装并重启后，宿主打开 v5 已保存窗文件，读取的完整几何版本仍为 `sha256:88f7c3443da22962a73c0db4818196f4256af0c44d37fae81c6915625ccae703`。新增 [总览 PNG](../output/model-accessibility-live-2026-09-08/overview-native-bounds-v2/window-native-bounds-overview.png)已人工查看：窗框、双扇玻璃、把手和窗台全部位于画面内，模板人物保留。原生结果为 `captured_and_restored`，截图前后完整几何版本相同。

这一新增截图是宿主针对取景修复的验证，没有重建窗，也没有改写 v5 的冻结要求、原始截图或当时的模型运行成绩。窗口打开时 Bridge 尚未启动的一次只读超时，以及随后把原生字符串 PID 当数字比较的一次宿主前置拒绝，都发生在新增截图请求之前；只实际执行了一次成功的取景请求。

## 资产导入：已批准并执行，重开仍有差异

本人在本地批准主机确认具体 S3 计划后，任务 `task_d5d5e762-8045-495a-98c5-a138983fb68d` 实际导入完整 chair 根，世界原点为 `[1000,1200,0]` 毫米，绕 Z 旋转 30 度，保持原尺寸；最终 mutation receipt 已落盘，唯一保存副本为 375219 字节。源 SKP 的 SHA 保持不变。

旧 `apply-result.json` 的 `diagnostic_pass:false` 保留：其逐面/边列表在 10000 项处截断，不能声称该列表完整。[独立层级补证据](../output/model-accessibility-live-2026-09-08/native-asset-place-development/hierarchy-supplement.json)使用已采集的全部原生 geometry_occurrences：源 28 个发生路径逐项匹配导入后 29 个路径（只新增外包装根），16 个源定义的属性指纹完全保留，实际存储几何仍为 4012 面、6260 边、2272 顶点；完整 Merkle 修订报告覆盖 11567 个逻辑发生项。补证据也独立核对根放置矩阵，14 项检查通过，没有重放导入或提升列表上限。

[导入椅子近景](../output/model-accessibility-live-2026-09-08/native-asset-place-development/detail-view/imported-chair-detail.png)已查看，靠背、扶手、坐垫和腿部完整可见；捕获结果 `captured_and_restored`，完整修订值恢复一致。实际关闭原测试文档，再从磁盘打开唯一保存副本后，文件 SHA、组件层级、材质及全部已导出的 snapshot 内容相同，但完整修订值从 `415e5f…` 变为 `467db2…`。**完整关闭重开验收仍未通过**；旧宿主检查误用 `file_path`（实际字段是 `source_path`）产生的 false 也保留在原始记录，补报告按实际路径重新核验。

[原生矩阵位模式](../output/model-accessibility-live-2026-09-08/native-asset-place-development/cold-root-matrix-signbit.json)定位到根矩阵的一个 `+0.0` / `-0.0` 表示变化。修复只归一浮点零，不舍入非零值；217 条 canonical 断言、42 项 Merkle 检查已通过。安装修复插件、完全退出并重启后，仅追加了[一次只读核验](../output/model-accessibility-live-2026-09-08/native-asset-place-development/signed-zero-restart-verification.json)：完整回读、正确文件、文件 SHA 不变及模型干净均通过，新 revision 为 `964243…`，与旧版本保存前的 `415e5f…` 不相等，检查结果保留为 `passed:false`。这次比较跨越了零值规范化算法变更，不能据此断言修复后的同版本重开仍有缺陷，也不能证明已经解决；尚缺修复版本内的完整前后证据。按用户 token 限制不继续扩展诊断。

## 外观测试准备

独立板件测试文件 [appearance-fixture.skp](../output/model-accessibility-live-2026-09-08/appearance-fixture-native-development/appearance-fixture.skp)包含 P 与独立保护标记物，实测 P 为 1800 × 900 × 30 毫米。文件为 45267 字节，SHA 为 `f19b972a30d03b6bfa255756d28e4223cfa86bb2d3a2d53b94cab7a00134ac17`；实际关闭、磁盘重开后，文档身份更新，完整修订值、文件 SHA 和完整递归读回均通过。

通过原生 UI 启用“显示逼真材质”、新建样式并使用“另存为”实际导出 [native-photoreal-2026.style](../output/model-accessibility-live-2026-09-08/native-photoreal-2026.style)，4276 字节，SHA 为 `29463cad1d0c0f8029911324634158690f719f48ece18d5650f2e6362c92a06f`。没有修改样式 XML 或猜测 Ruby 渲染枚举。导出用的临时模型改动未保存；再次重开原板件文件后，原文件 SHA、完整版本与“显示逼真材质=0”均已确认。模型必须通过接口自行应用素材并加载此样式，不能把宿主准备当成模型完成。

## 仍待完成

- 资产重开修订差异，以及真实单实例资产替换和同伴保护。
- 参数修改、保存关闭重开后的源身份恢复与再次修改。
- 新 PBR/HDR 简明入口的真实审批、原生显示与文件重开验证。
- 固定版本下三模型全部任务的对照运行与独立评分。

GLM-5.3-Flash 的第十轮 PBR 开发运行已经以预算停止结束，未进入批准或修改模型；字段读取及错误输入污染的修复已落地，尚未重跑实机。详情见[外观开发报告](model-accessibility-appearance-development-2026-09-08.md)。用户要求减少不必要测试后，本轮没有启动新模型或批量验收；最后只读核验结束后已关闭模型并正常退出 SketchUp。
