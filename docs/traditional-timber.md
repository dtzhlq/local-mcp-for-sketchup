# 中式木构研究配方（song-study-v1）

> 历史研究原型，保留原有身份。下文的“本轮”指原研究工作，不是 v0.4.0 正式预设或本次发布验收。当前研发状态见 [implementation-status.md](traditional-timber/implementation-status.md)。

本轮提供柱头、直檐、翼角、一个开间和三间屋架五个确定性生成器，复用 PartGraph v2、safe JSON DSL 和现有受限组件替换流程。定位为可拆解、可调参的构造研究原型；不是经过史学鉴定的宋代建筑复原，也不是施工或结构安全模型。瓦作、门窗、彩画、完整榫卯和转角铺作制度不在本轮实现中。

## 使用

在仓库根目录运行：

```sh
node scripts/traditional-timber/compile.mjs column_head
node scripts/traditional-timber/compile.mjs straight_eave
node scripts/traditional-timber/compile.mjs corner_eave
node scripts/traditional-timber/compile.mjs bay
node scripts/traditional-timber/compile.mjs hall
```

`--params /absolute/parameters.json` 接收参数文件，`--id unique-id` 避免与已有定义重名，`--out /absolute/output` 指定输出目录。生成 bundle.json、model.dsl.json、parameters.json，不写入 SketchUp。DSL 内部统一为 mm，不含 reset。**创建 DSL 只用于新建；同一 ID 不可直接重放到已有模型作为更新。**

JavaScript 集成：

```js
import {compileDetailedAssemblyRecipe} from './src/product-modeling/parametric-recipe.mjs';
const bundle = compileDetailedAssemblyRecipe(
  {kind:'timber_column_head',id:'my-node',parameters:{fen_mm:10}},
  {origin:[2000,0,0]}
);
```

MCP 专家工作流读取 `model.dsl.json` 后走既有 build_model / fresh handshake。已有模型编辑使用 prepareAssemblyParameterEdit / applyAssemblyParameterEdit，并保留现有策略和原生读回。自动生成新定义，只替换指定根实例；不原地修改共享定义。当前没有增加新的公共 MCP 工具或普通任务目录入口，需要本地编译步骤。

## 参数

所有 `_fen` 字段按 `fen_mm` 线性换算；默认 10 mm 是工程尺度，不是历史材等。

| 参数 | 默认 | 含义 |
|---|---:|---|
| fen_mm | 10 | 一份对应的毫米数，研究范围 1–50 |
| column_height_fen | 300 | 建筑柱高；柱头试件固定保留 120 份柱段 |
| bay_width_fen | 360 | 开间或独立直檐宽 |
| depth_fen | 480 | 建筑进深；单开间默认 320 |
| step_fen | 60 | 檐部内侧步架水平投影 |
| pitch | 0.35 | 独立直檐、翼角的坡度；建筑由进深推导举高 |
| rafter_spacing_fen | 15 | 目标椽距；直檐两侧留半径余量后均分 |
| rafter_diameter_fen | 8 | 檐椽直径 |
| shengchu_fen | 24 | 角部生出增量 |
| shengtou_fen | 9 | 生头高度，按扇面参数平方渐变 |
| corner_width_fen | 150 | 翼角与直檐交接宽度 |

本轮的进深、柱网和角部宽度存在相容约束，生成前会拒绝不相容组合。柱头试件只有 fen_mm 控制尺寸；建筑的独立檐坡参数 pitch 不生效，屋面采用明确的研究举高关系。不能将“参数可输入”理解为所有阶段均会使用该参数。

## 来源与假设

规则台账位于 `data/traditional-timber/song-study-v1.json`，每个 bundle 附带来源和假设。卷四支持材高 15、厚 10、栔高 6 以及泥道栱 62、华栱 72、令栱 72、慢栱 92 份等尺寸。斗宽 32 份结合教程标尺；总高、斗高、连接槽、对称组合和承托顺序是工程假设。

翼角插值、生头木分段、后段望板垫条及整屋举高由本项目编写。各栱目前共用简化卷杀轮廓，尚未逐类落实古籍全部瓣数、瓣长及放样法；构件名称不能作为形制复原认证。保留完整组件层次，部分榫接以接触或局部搭接表示。

## 精简验证

只运行 `node test/traditional-timber.mjs`：单位/关键尺寸、零份值拒绝、一次局部替换编译，附带每种配方一次轻量 mock 构建检查。mock 通过不等于 SketchUp 验收。

原生证据集中在 `output/traditional-timber/live-20260921/`。局部与整屋各做一次保存重开；中间只查新增构件和一次相关参数变化。记录实际问题后只补最小回查，不执行无关全仓测试。

本机运行插件为 v0.3.0，研发目录服务契约较旧。原生研究脚本可通过 `TIMBER_RUNTIME_ROOT` 指向与已安装插件一致的服务源码，仍必须通过正常版本握手。此选项只选择服务实现，不跳过校验，也不代表本分支已发布。

## 本次原生研究脚本

`scripts/traditional-timber/live.mjs start` 仅接受用户准备的新建、未修改文档，并保存为独立研究副本；不会清空默认人物或其他对象。`stage.mjs` 按顺序添加阶段模型；`edit.mjs` 对指定根实例进行单次参数替换，检查其他根对象不变。这些是显式试验脚本，不是自动执行的安装钩子。所有写入仍通过新鲜握手和现有 reviewed-edit 流程。

每个阶段目录中的 `bundle.json` 为创建基准，`next-bundle.json` 为本次调参结果。脚本用于本轮一次性演示；再次修改须以最新 bundle/DesignIntent 和当前模型建立新的变更计划，不能盲目重放脚本或旧计划。运行失败先读回状态，`stage.mjs --resume` 只继续已生成阶段的读回、截图和保存，不重建几何。

整屋的完整实例树会展开为大量面、边记录，现有参数编辑读回可能需要数分钟。首轮保留其范围保护，尚未进行性能优化或长期稳定性验收。

本次大模型读回曾触发 Node 默认堆内存上限；已确认原生修改提交后只读恢复，没有重放写操作。后续研究命令使用 `NODE_OPTIONS=--max-old-space-size=4096`，仅对当前命令生效。圆椽采用 12 段离散截面，共面网格侧面保留四边形，减少面边记录；不宣称加工精度。早期阶段文件是当时的研究快照，最新整合几何以最终三间模型为准。

大型读回可能超过握手有效期。`prepareAssemblyParameterEdit` 可传入异步 `sessionContractProvider`，在模型修订及绑定核对完成后、创建新定义之前取得新凭证。原有传入凭证的接口保持兼容，Bridge 仍负责验证签名、身份、有效期及权限。
