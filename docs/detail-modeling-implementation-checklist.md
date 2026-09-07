# 详细建模实现与验收清单

## 最终交付状态（2026-09-07）

本轮本机 SketchUp 2026 交付完成。厨房 final-v1 与入口 final-v2 均已完成真实退出重开、原生几何及外观保留和画面审阅；入口最后批准修订的 166 个铺装部件、36 条通道全部通过。最终文件、证据及兼容范围见 [交付索引](/Users/07zhang/Library/CloudStorage/OneDrive-个人/work/项目/sketchup-mcp-replica/output/detail-modeling-implementation-2026-09-06/交付索引.md)。以下“尚未完成”“待验”等内容为阶段历史，已由最终交付记录取代；旧失败证据继续保留。

## 阶段历史


截至 2026-09-06，本清单记录代码实现及离线测试入口。它不等于 SketchUp 实机验收，也不代表详细模型任务已经完成。实时证据必须来自当前插件源码版本、当前场景和对应部件实例路径。

## 最新实机状态（2026-09-07）

- 最终收尾新增：厨房 `kitchen-living-v1-delivery-final-v1.skp`（37,081,552 字节）已完成布局镜像、单椅高靠背资产版本替换、镜像场景相机和原生外观保存。74 个其他根对象/材质未变，柜体 720/800 mm 保留。真实退出重开后根对象与原生外观一致，同相机截图经视觉复核通过但字节不完全相同。最终验收见 `evidence/kitchen-living-v1/delivery-final-v1/final-acceptance.json`。入口镜像的 20 个根对象也已保存，单盆资产替换和最终外观继续收尾；全计划尚未完成。以下较早条目保留为阶段历史，不覆盖这一最新结果。

- 厨房与入口原生 PBR、两份 HDR、独立风格和场景绑定均已保存并经过真实退出重开；厨房 192 项、入口 182 项原生读取检查通过。入口墙面偏暗、铺装挡排水的视觉缺陷仍保留，最终成片未通过。
- 厨房单柜 800→740 mm，真实退出重开后继续改为 720 mm；另一个柜体保持 800 mm，47 个部件身份保持。720 mm 文件自身已在新进程中从磁盘加载，参数绑定一致，实测目标 720 mm、同伴 800 mm；总览和柜体近景已复核。
- 七类材质控制样片的 1,154 项原生读取、133 项纹理嵌入后的像素一致性、三组面级 UV 保存重开通过。最后新增的独立法线 0/1 灰色面板已在近景显示清楚差异；最终 133 MB 文件已真实退出重开，1,176 项读取及新增法线贴图像素一致性通过。12 个无来源贴图的案例明确记为不支持。
- 0.005 mm 普通与批量网格均在原生 SketchUp 创建为 6 面、12 边封闭实体，并通过退出重开后的几何比对；不使用包围盒修复。原失败事务完整回滚的证据保留。
- 普通与批量 800 面网格首次近景发现正反面不一致，已修正为遵循输入顶点绕序，新的实机对照图通过；原失败样片保留。共享 32 个零件仅新增 38 个存储面，展开为 1,216 面；单次原生构造约 32/152 ms，仅为本机性能样本。
- 栏杆圆管平滑及六角螺栓棱线的独立样片近景通过；两套主场景尚未应用这项外观修正。铺装三变体 174 部件/38 净空、墙体节点三变体 36 部件/36 净空已实机通过并补充近景。窗三变体 75 部件已实机通过；门、柜体、水槽、栏杆三变体合计 366 部件/18 净空通过，六处支承局部补建后 421 个原有几何实例完整保留，仅新增六个支承。12 张补充全景已审阅，三组排水孔的俯视均可见真实贯通；门合页位置修正后的独立三变体已经实机通过：63 部件、六张近景/总览，保存 382,707 字节。檐口排水原三变体143部件通过数值检查，但近景发现檐底板封堵管内通道，人工验收保留失败。配方新增穿管孔及装配级通道净空检查，新版三变体 143 部件及 3 条装配通道已实机通过，9 张总览/近景已审阅；修正文件保存为 991,281 字节，旧缺陷样片保留。窗框封孔但保留声明的原生负例被准确拦截，任务保持待修正；其余 24 个负例已分三组在原生 SketchUp 中执行并逐项检测到预设缺陷，共 25 个负例通过应失败验收。三组任务均保持 awaiting_input，冻结要求未改写；原生读取为主要证据，部分旧近景取景不足，已补拍绑定缺陷部件的近景。
- 参数修改检查相机已改为根据较窄画幅轴计算完整包围球取景距离；高门、宽栏杆的取景约束测试通过，新增公式已在三组门实例实机捕获中验证完整取景与状态恢复。
- 厨房门合页修正已应用主场景：仅替换一个门实例，74 个其他根对象及材质保持一致，720/800 mm 柜体尺寸保留；贴近合页图通过，副本保存 36,812,198 字节。新副本自身冷重开待验。
- 入口窗外框已实机改为 1,800 mm，五层宿主墙均测得 1,800 × 1,550 mm 真实贯通孔；18 个其他根对象和材质保持一致，窗台后沿修正保留，副本已保存并完成内存回读，冷重开待验。
- OneDrive 曾将 `src/visual-correction.mjs` 变为 dataless 占位文件并连续读取超时；用户要求重试后，文件 41,327 字节及完整编辑脚本加载均已恢复。入口檐口主场景修正已继续进入原生编辑流程，先前加载失败未提交任何模型操作。
- 入口檐口修正已应用主场景，场景级落水通道原生检查通过，出口近景可见内壁；19 个其他根对象及材质未变，副本保存 36,055,447 字节。退出重开后 594 个原生实例记录的非 UV 字段完全相同，UV 最大差异 2.7×10⁻¹⁵；严格原始比较及限于 UV 的容差比较均保留。
- 入口门合页修正已应用并通过整体及贴近视图，19 个其他根对象及材质未变，副本保存 36,115,179 字节。门副本冷重开后的 594 个实例非 UV 字段一致，UV 仅浮点末位差异。入口栏杆修正也已实机完成，整体、底座螺栓和扶手回弯近景通过；19 个其他根对象及材质不变，副本保存 36,295,717 字节，其自身冷重开待验。
- 最新完整离线回归 58/58 通过，运行期间源码未变：`output/detail-modeling-offline-2026-09-07T07-27-16-809Z-xAnA5v/report.json`。
- 本地 SKP 保留根组件导入已实机通过：55 个嵌套节点、1,772 个展开面、17 种材质，来源文件未改动。保存后完全退出并重启，实例层级、原生几何、尺寸、材质及同相机 PNG 完全一致。目录记录不自行升级为原生验收证明；该独立试验尚不代表主场景资产替换完成。
- 全计划仍未完成：两场景剩余参数变化、镜像与单实例资产替换，最终文件保存重开、入口铺装修订及两套完整成片尚待完成。此前专项铺装尺寸答复仍待确认，解锁不替代该答复。

## 已实现，使用离线回归核对

| 实现项 | 代码及主要测试 | 离线检查能够证明的范围 |
| --- | --- | --- |
| PartGraph v2 嵌套装配与 v1 兼容 | `part-graph-compiler.mjs`；`detailed-modeling.mjs`、旧 `part-graph-compiler.mjs` 测试 | 显式装配引用、定义复用、无效图拒绝、原 v1 产物兼容 |
| 根与嵌套组件的镜像放置 | `component-operations.mjs`、`component_operations.rb`；`component-instance-mirror.mjs` | 同一个原生构造方法接镜像负比例→Z 旋转→原点与平移；Ruby/JS 数值替身实际点坐标一致，不改叶子身份和局部空腔要求 |
| 八类详细构件与厨房、入口立面基准 | `src/detailed-modeling/`；`test/detailed-modeling.mjs` | 构造数据、隔离 mock 构建、冻结细节规格、基准与参数变体可重编译 |
| 四类家具灯具资产 | `furnishing-assets.mjs`；`test/furnishing-assets.mjs` | 阅读椅、边桌、吊灯、盆栽的厚度、封闭曲面、接缝、空心构造、共享定义与参数身份稳定 |
| Agent 设计计划的组合执行 | `compose-design.mjs`；`test/compose-design.mjs` | 将明确的 additions、放置、独立 shape 与视图重新编译为 PartGraph；保留原基准近景及设计输入，不替代 Agent 设计判断 |
| 任务创建范围与失败后继续修正 | `agent-dsl-policy.mjs`、`agent-gateway.mjs`；creation-scope、detail-quality 系列测试 | 新资源隔离、失败不报告创建完成、重复调用不重建、规格与修正预算约束 |
| 原生几何证据与局部视图回执 | `geometry_evidence.rb`、`capture_detail_views.rb`；对应 Ruby fixture 测试 | 数值、拓扑反例及捕获/恢复 API 调用契约；不是真实画面质量 |
| 上下文空腔与洞口未被遮堵 | `geometry_regions.rb`、detail-quality/Gateway；`detail-context-regions.mjs` 和几何证据 Ruby 测试 | 冻结局部区域、实例路径与模型版本绑定；真实三角面/封闭体数值夹具识别封板、填充和缺失边界；不把单个部件自身的孔当作整个场景畅通的证明 |
| 材质、环境与显示 API | appearance/environment 模块；Node 与 Ruby appearance 测试 | 参数和 API 接线；不证明当前 SketchUp 版本实际渲染效果 |
| 路径截面、斜墙洞口和连续墙角 | surface/architecture 两端模块；`surface-wall-geometry.mjs` | 实际构造网格半径、法向、接缝、体积、洞口射线以及 Ruby/JS 一致 |
| 按弦高控制圆周分段 | `curve-resolution.mjs`；curve-resolution、detail-geometry-budget 测试 | 分段最小需求、预算、真实离散误差和顶点/面数增长关系 |
| bulk 与小尺寸网格构造 | `primitive_operations.rb`；`native-mesh-construction.mjs` | 真实 Ruby 构造方法在数值 API 替身中，0.005 mm 尺寸放大后精确还原、800 面 bulk/standard 坐标一致、退化边和非平面输入拒绝 |
| 根组件资产导入 | native import 与 mock preserve-root；`import-preserve-root.mjs` | mock 定义、材质、标签、图像引用和嵌套实例的冲突重映射、失败保留与旧 append 兼容 |
| 本地资产来源、许可与文件有效性 | `asset-catalog.mjs`；`asset-catalog.mjs` 测试 | 十二类本地构件/家具检索，来源许可原样保留，文件哈希变化、缺失及目录伪装失效；catalog 记录与文件匹配仅说明 `recorded_evidence_matches_file`，不能由可编辑记录伪造原生几何已验收 |

## 统一回归入口

2026-09-06 本轮综合回归 **56/56 通过**，受检源码在运行期间没有变化：
`output/detail-modeling-offline-2026-09-06T09-11-57-326Z-9ZBTop/report.json`。
这是离线契约、数值几何与 mock 回归。包含冻结预算、真实构造净空适配器、镜像、完整资源统计；不替代下面的实机项目。

当前插件已完成完整退出/重启，SketchUp 26.2.242 新鲜能力回执保存于
`output/detail-modeling-implementation-2026-09-06/evidence/runtime-kitchen-canonical-v1/capabilities.json`。
原生能力可调用不等于最终场景已通过验收。

实机测试每次只保留一个模型窗口，完成保存和证据核验后关闭窗口并正常退出 SketchUp，再开始下一样片。多模型批次已禁止；macOS 的 `open_model` 会保留已有窗口，必须同时关闭启动时的空白窗口。进程被结束后的磁盘文件必须重新检查，不能把先前的内存几何回执当作保存成功。

运行 `npm run test:detail-modeling`。也可运行 `node scripts/run-detail-modeling-offline-tests.mjs --output-dir <尚不存在的目录>`。

每轮创建唯一报告目录，保存精确测试清单、逐项日志、源码 SHA-256、JSON 与 Markdown 报告。每个测试进程使用独立工作目录、mock session、authority state、queue simulation 目录和临时目录，避免复用已有输出。两个进程并行执行，状态不会共享。

报告中的 `ok` 要求测试全部通过，且受检源码在运行期间未改变。`live_runtime_executed` 和 `release_acceptance` 固定为 `false`。Ruby 测试使用 API 替身；测试记录的耗时是离线运行耗时，不能当作 SketchUp 建模速度或 bulk 加速比。

## 本轮实机发现与恢复边界

墙体沿边开门洞导致旧面失效的问题已定位并修复；建面后只移除新构件内部不关联任何面的残留边。墙体原生净空检查随后通过，但近景发现墙角分层体重叠，视觉验收仍不通过。墙角配方改为互不重叠的 L 形截面；这项最新改动需要在完整场景近景中继续验证。

厨房与生活区已收到原生提交回执，但调用端提前超时，原创建任务仍记录执行结果不确定。外层授权运行时的超时参数已修正并纳入回归。随后已实际保存、关闭并重新打开厨房基础 SKP：几何统计和部件证据一致，但完整模型指纹变化仍待定位，不能记为全部持久化验收通过。两盏吊灯经过普通编辑预检后替换为新定义，72 个未选中根对象的前后快照一致；独立副本 `kitchen-living-v1-pendant-scoped-v2.skp` 已保存。其脚本内再次打开文件仅证明当前模型可读，真正关闭重开仍待继续。

`node scripts/run-detail-modeling-live.mjs inspect-created <模型标签> <唯一检查标签>` 可对现有创建进行独立复核。它读取原任务冻结要求和服务端实例映射，获取新鲜几何、近景和净空证据，并再次检查版本一致性。不会重放创建代码、读取迟到回执作为质量证据，或改写原失败任务。缺件、捕获失败、恢复失败、模型版本变化及冻结规格哈希不匹配均有离线反例；该入口已运行厨房实机复核，21 个净空区域通过；仍发现布局包围盒疑点及两项吊灯身份缺失。后续吊灯替换和路径重绑定已完成，但不能把旧复核记录改为通过。

## 仍需实机完成并保留证据

- 安装当前插件后读取真实 capabilities 与源码版本；静态打包检查不能替代这一项。
- 对八类构件和两个完整场景进行原生构建，按真实实例路径检查必要部件、材质、独立板件尺寸、孔槽、型材、实体闭合与可见性。
- 获取整体和局部截图，验证窗框层次、柜体内部与抽屉、盆壁排水、门五金、扶手固定、墙层节点、檐口排水与铺装排水细节；检查截面拍摄后模型状态恢复。
- 对删件、封孔、把圆角退回直角、只写 metadata、隐藏必要部件等情况，在同一质量门确认明确失败；通过离线反例不等于实机反例已通过。
- 保存并重新打开模型，核对组件层次、材质和局部视图；执行指定参数修改，确认宿主开孔同步、无关组件保持不变。
- 对 standard 与 bulk 用相同真实几何测量面数、构建耗时和稳定性；验证 SketchUp 小边容差下的 0.005 mm 样件。离线数值恢复尚不能证明原生拓扑成功。
- 核对 local SKP 的根组件保留、嵌套复用与材质冲突，完成模型文件哈希与验收证据绑定。

只有上述实机项目有相应产物，才能把它们从“待验收”改为“已验收”。几何支持范围、失败条件及尚未实现的通用能力见 `detail-modeling-geometry-notes.md`。

## 最新修正与待安装边界

显式 `recursive_roots` 可以只展开待编辑根组件，仍保留整个模型的原生版本指纹；局部完整不冒充全模型完整，全部关联实例修改需要与全局定义实例数相符。现有编辑授权与版本预检继续适用。

包围盒碰撞疑点增加原生三角面与实体占据检查，只有某一侧在交集区域确实为空才消除误报；不确定和占据证据保留原结论。模型坐标查询的 Ruby 接线已通过数值测试，尚未安装到当前运行中的 SketchUp。

厨房门周围侧墙和水槽安装高度已更新到新配方，`detail-spec-v6.json` 单独保留新增门洞要求，旧冻结规格不变。配方编译、组合、局部重编译及 22 项构造净空数值检查通过；当前 SKP 中的局部补建仍待解锁后执行。上述配方、补建入口及报告语义修改已纳入最新 54 项综合回归；原生运行仍待继续。

## 后续实机定位结果

厨房实际关闭重开后，原有 504 项部件要求和 21 项净空检查通过；单独新增的门洞侧墙通过 Gateway 新事务补建，原任务要求保持不变。构件级原生分离检查已确认台面贴墙、水槽安装及门扇与门洞不存在内部穿插。生活区墙角改到远端，吊灯安装位置已校正；最后一次完整复核仍留下窗台板与搁架支架两项穿插，随后搁架已调整并保存，窗台板参数修改继续验收。不能把这份阶段记录当作完整场景已通过。

模型指纹的 JSON 排序与闭合环起点选择减少了重复序列化，200 项旧算法字节对照以及 38 项原有 Merkle 检查通过。模型版本规则没有放宽；当前源码与运行时哈希保持对应。实际性能提升仍需同模型同操作测量。

## 2026-09-06 17:30 厨房原始规格复查通过

`kitchen-living-v1-sill-seat-v2.skp` 已保存。窗台采用单实例定义替换，参数记录与保存后的当前模型一致。原始冻结规格的 504 项部件、21 项净空及布局检查全部通过，剩余项和检查错误均为空，证据位于 `output/detail-modeling-implementation-2026-09-06/evidence/kitchen-living-v1/independent-inspection-sill-shelf-final-v1.json`。历史创建任务的执行状态未被改写。单独补建的门洞墙仍按自身任务复查；本记录不代表整套计划或材质环境验收完成。

新版 `examples/detailed-modeling/agent-compositions/kitchen-living-plan-v2.json` 保留旧方案，把生活区墙体转角修正为远端镜像放置。当前基础配方组合后共有 505 项要求，包含新增门洞墙；不以新规格替换历史冻结规格。

基础信息读取省去不会返回的派生几何证据，12 项 Ruby 断言验证返回内容不变。最新综合回归 56/56 通过，且运行期间源码未变：`output/detail-modeling-offline-2026-09-06T09-29-47-922Z-LAQDm8/report.json`。这项基础读取优化尚未安装到当前 SketchUp 进程，不报告原生加速成绩。

后续独立门洞墙检查也已通过（1 项部件、1 项净空），与原有 504/21 检查使用同一模型版本，汇总见 `combined-geometry-review-v1.json`。新增的窗台和门套接缝近景已经检查。真实剖切的第二组相机显示盆壁、盆底、贯通排水口、台面开孔和窗框玻璃层次；第一组相机遮挡截面，保留为未采纳记录。剖切已停用，剖切对象保留供继续编辑，详见 `section-visual-review-v1.json`。

基础读取优化随后已安装：29 个文件校验通过，安装清单 SHA 为 `63f7a3af78e3cfb0817e8fffa3139be93fb780cf288c8ef071339fa75630d634`。旧进程正常退出后，新进程通过原生打开对话框读取模型，`runtime-kitchen-info-lean-v1/capabilities.json` 确認版本兼容。窗体 DesignIntent 重开匹配通过。626 个实例测量只有一处约 `8.49e-13` 度差异，外观状态一致；严格模型指纹不同，未把这一记录标记为完整全模型持久化验收，也未放宽编辑版本检查。

### 2026-09-06 装配修改后检查中断恢复

- 入口场景窗台替换已完成，随后路径登记的只读检查在默认30秒超时。已保留原始执行和迟到响应证据，未重放替换操作。
- 登记检查统一使用有上限的120秒超时；在检查之前持久保存绑定任务、冻结规格及修改结果的签名交接记录。现有继续任务入口可恢复这一步，仍验证实际模型版本和必需部件路径。
- 新增模拟中断、重启恢复、篡改拒绝及恢复不重复修改模型的测试。历史运行的未签名JSON不自动升级为可信记录。
- 原生入口模型当前尚未完成修改后另存和验收；队列迟到响应归档等待明确授权。此项代码验证不代表入口模型或整轮PBR/HDR交付已通过。

### 2026-09-06 18:45 独立复测与入口安装修正

- 已按用户明确批准，仅归档第一份迟到只读响应并核对原字节，窗体修正版已实际另存为 `models/entry-court-v1-sill-seat-v1.skp`（1,134,849字节）；旧文件仍保留。
- 五处安装位置修正返回原生提交成功，迟到响应已完整备份；其归档授权及修改后另存尚待完成。原生响应中的世界包围盒与变换记录支持墙体镜像、格栅平移等已经执行，不把该历史响应直接视为新鲜质量验收。
- 独立检查支持显式提出同一根组件内的新部件路径。重新读取原生对象、核验原根组件持久ID、拒绝未知/重复/缺失路径、保留冻结规格哈希和全部几何要求。该绑定只服务这次独立检查，不更新原任务，不生成可信编辑凭据，也不宣称恢复旧执行。
- 已补充身份变化、错误根组件、缺失路径、未知逻辑部件和实际几何缺陷负例。离线56/56通过：`output/detail-modeling-offline-2026-09-06T10-42-52-811Z-oMADrB/report.json`。
- 本轮实机驱动脚本的单次等待上限改为600秒，以适应当前较慢的原生处理；不会在等待超时后自动重放模型操作。服务端原有授权边界保持有效。

## 续接核验：入口场景已保存重开并通过几何检查
用户已确认本轮自行提交请求的迟到响应归档授权，需核实请求身份、完整字节备份和校验，不重放操作；未知请求不在授权内。归档凭据见 evidence/entry-court-v1/authorized-installation-response-archive/authorization-and-receipt.json。旧三项楼梯尺寸修改提案未实施；改用前场铺装和两条路缘整体向外移动 900 mm 的位置修正，冻结尺寸不变。
入口派生模型 entry-court-v1-sill-seat-v1.skp 已保存（1134254 bytes），正常退出旧进程后安装新插件并重新从磁盘打开。当前单一 SketchUp PID 40908。运行插件 manifest 0b108ee12e6bac8cd1f69d5a956cad037bfcdc6b66af5995512a890f054820b4，fresh capabilities compatibility ok。
独立 inspection-court-foot-reopened-v1：398/398 部件、12/12 孔洞通过，布局问题 0，8 张捕获均验证且状态恢复；原冻结 hash 969e8d25420780d5d536eeec2415758a67c041f065c353b1fa8a7e9e15b67888 不变，原任务历史未改写。
视觉检查发现原墙角和铺装近景取景不足，完整窗/场地总览也需补充。新增 supplemental-views-v1.json 正在捕获（session 71258）。后续补真实剖视并保存，然后推进原生 Photoreal/PBR/HDR、变化任务和剩余构件/性能验收；两套模型尚未获得最终完整验收，PBR/HDR 尚未应用。

## 19:18 current: visual defect overrides earlier algorithm-only pass
Fresh capabilities compatible. Supplemental-v1 four captures and two actual sections captured. Manual review file supplemental-and-section-visual-review-v1.json marks final acceptance FALSE: lower-court final tile course covers grate waterway, while old part-only hole checks passed. Full-court and full-window images usable; wall section black fill masks layers and requires improved cut display.
Source pavingRecipe now reserves 137 mm for the channel, trims final tile course, adds one actual assembly-scoped waterway void per grate. Offline region negative test places a full tile over grate: fails as intended. Immutable entry-facade/detail-spec-v6.json added; old specifications unchanged. New proposed composed scene 408 parts/48 voids; native frozen scene still398/12. Existing-model repair NOT APPLIED: explicit user question pending for 10 lower-court tiles depth295to158 mm plus10 platform closing tiles58mm, oldspec/history retained. Proposal/bundle in evidence/entry-court-v1/paving-waterway-*-v1.json.
Mac lock now prevents CUA normal UI; manual unlock requested. No new app launched; single PID40908. Native MCP checkpoint save succeeded models/entry-court-v1-sill-seat-v1.skp1134628bytes, save-section-checkpoint-v1.json. PBR/HDR still NOTapplied; nativePhotorealstyleexport requiresunlockedUI. Normalexit requestedbyuser but cannotperformUIwhilelocked; do NOTkillprocess.
Operator second section-disable command reused output basename; native call completed then receipt write EEXIST. Historicalreceipt preserved, no repeat. Added scripts/lib/claim-live-submission.mjs + live-driverclaim beforemutation; tests prove duplicate uncertain submissions, historicalreceipts and concurrentcalls invoke atmostone mutation. Full56 suitepassed report detail-modeling-offline-2026-09-06T11-13-27-781Z-8E7Iku/report.json beforeclaimhelper; expanded57 suite running36067 /tmp/detail-paving-submission-final-regression.json. No AGENTS/SKILL changes. Preservependingrequests; do not applydimensionproposalwithoutanswer. Continue sections/PBR/samplesafterunlock.

## Native appearance continuation after user unlocked (19:35 checkpoint)
The user's latest reply only unlocked the Mac; paving dimension proposal still NOT approved or applied. Native UI Photoreal checkbox enabled on entry derivative, saved1170660bytes, quitPID40908 confirmedgone. CleanrestartPID43370: Styles floatingpanel couldnotbe accessed (app AX/screenshot onlymodelwindow despite Window>Styles). No preferences reset. Native read-only plist shows multi-monitor negative/other-screen frames; no configchanged. Do notclaimstyleexported.
Bridge requires manual Start Bridge after eachrestart (Extensions>Alma SketchUp MCP>Start Bridge). CLIget_capabilities whilemodal/bridgeoff timedout; no pendingqueueartifacts remained. open-test native-appearance-resume-v1 successfullyreopened source.
Applied native-channels-hdr-v1.json: 9 existingservernamedmaterials +studio/daylight environments+studioactivation (12ops), via exacttestmodelguard andnewexclusiveclaim. Sourceassets verifiedcatalog-v2. native-channels-hdr-readback-v1 initially4mismatches:2woodcolors overwrittenbytextureloading,2Environment#path returnsfilenameperofficialAPI. Source materials.rb nowtexturefirstthenexplicitcolor/alpha; tests verifyoverrides. appearance-presets.mjs comparesnativeenvironmentfilename only, withprovenanceassethashes stillseparate; wrongfilename negativefails. Native2color-onlycorrectionapplied througholdplugin, full162getterreadbackpassed native-channels-hdr-readback-v2. NativeDaylightactivated. Studio/daylight4views eachcaptured/restored, overallimagesvisuallyreviewed; colorcorrectionbetweenbatches meansnotstrictsinglevariableHDRcomparisonyet.
SavedNEW independentfile models/entry-court-v1-native-channels-v1.skp35516367bytes; native-channels-saved-v1.json. Geometrysourceentry-court-v1-sill-seat-v1.skp remains1170660bytes, noPBRtextures. Native appearance includes actualUIRenderMode6 (observed2026only,noinventedAPIenum), active_style_changedtrue, selectedstyle[Architectural Design Style]. Noexported.style,noscenebindings/controlmatrixyet.
NativePID43370closedCmdW+CmdQ confirmedgone. Newplugin29filesinstalledexactmanifest b59e31f9d950fc0dba32ec7748f1c07f0991bc8871385adc2a0062eba5ed6e1c (materialtextureorderfix). RestartedSketchUp, enabledBridge, freshcaps /tmp/detail-color-order-installed-capabilities.json compatibilityok. open-test entry-court-v1 native-channels-reopened-v1 --model-name entry-court-v1-native-channels-v1.skp returnedpending_mdi_activation. ACTIVE guard+actualinspect session98454 willverifycorrectsourcepaththenfreshsnapshot; do notoperateUIormutatewhileactive. Needcompare allnativeappearancefieldsbefore(ops-native-daylight-activate-v1 snapshot) vsfreshactualdiskreload. Thenverifynewinstalledfullmaterialtexturecolororderviaonewoodmaterialreapplyonly, save,closequit. Currentoneprocessoneactualtestmodel.
57/57 regressionpassed output/detail-modeling-offline-2026-09-06T11-27-06-578Z-TDV6GR/report.json includesmaterialorder/envfilenamefixes. Afterwardsoneguardaddedto liveinspect action (awaitactive) topreventwrongmodelreadbyevidencelabel; targetedsyntaxcheckpending. Fullplanstillincomplete,kitchenPBRnotapplied,geometrypavingpendingapproval,wallsectionvisualincomplete,remainingmatrix/variations/performance pending.

## 19:44 entry native appearance persistence PASSED (scoped only)
Native material-order update was verified with full2woodmaterialreapplication: native-texture-color-order-proof-v1.json. A real restart initially exposed21PBRtexture absolute-path-to-filenamechanges (allothernativeappearancefieldsunchanged). That strict historicalcomparison remainsfailed/native-channels-actual-reopen-comparison-v1.json; notrewritten.
Added native_texture_pixel_fingerprint in snapshot.rb: Texture#image_rep(false), actualdataSHA256+width/height/bits/rowpadding/platform; validatesbytecount, skips >16Mp beforecopywhenimagesizegettersavailable; nevermetadatafallback. Native21/21 channels havefingerprints (8bitroughness/AO,24bitnormal). compareNativeAppearancePersistence onlynormalizeschangedpathwhenfilenameANDactualnativepixelsmatch; samefilename/differentpixels/missingfingerprintnegativesfail. Historicalsnapshotinputsclonednotmutated. evaluateReadback accepts embeddedfilename onlywithactualnativepixelrecord; importsourcehashesremainseparate.
Latest57suitePASSED output/detail-modeling-offline-2026-09-06T11-36-41-029Z-Ulewpo/report.json, includingnewpixeltests andliveinspectpathguard. Installed29filesmanifest758e26de26f65bac25dd794ea87a7ce90f644d172ffbd77fd2aa2ced5c2a4938; normalrestartfreshcapscompatible. Nativepixelbaseline2woodmaterialreapply ops-native-pixel-baseline-materials-v1.json, save-native-pixel-baseline-v1.json, thenclosed+quitPID47382confirmedgone. Actualnewprocess reopenednative-channelsfile andfreshsnapshotinspect-native-pixels-reopened-v1.json.
Evidence native-pixels-actual-reopen-comparison-v1.json: persistenceTRUE/readbackTRUE162fields/21nativepixelchannels/4verifiedabsolute-to-embeddedtransitions. Allnativeenvironment/renderingoptions/sceneexistingstatepreserved. DoesNOTproveexportedPhotorealstyle/newscenepresets/nativechannelcontrolmatrix/finalvisualacceptance. Fullplanstillincomplete,entrypavingrevisionpendingapproval,kitchenPBRnotappliedyet.
Afterpassedinspection entrymodelclosedCmdW+CmdQ, processgone. CURRENT SketchUpNOTRUNNING. Nextstartonecleansession,enableBridge,freshcaps,openkitchen-living-v1-sill-seat-v2.skp. Applyguarded9materialspresets+2HDRasentrywithnewnameskitchen_channels_v1_*, nativeUIenablePhotoreal, capturereadbacks/newindependentSKP/actualreloadpixelproof. Avoidnative.style fabrication; StylesfloatingpanelinaccessiblethroughCUAmainwindowpossiblyotherdisplayframes. Needresolveexport/bindsceneslater. Pendingpaving10tilesdepth295to158plus10platform58closingtilesNOTapprovedbyuser'sunlockonlyreply.

## Kitchen native appearance in progress
Current sole SketchUp session is kitchen-living-v1-sill-seat-v2.skp, with UNSAVED PBR/HDR and finish tuning. Entryprocess previouslyclosed+quitverified. NewsessionBridgeenabled,freshcapscompatible /tmp/detail-kitchen-appearance-capabilities.json. Openreceipt open-native-appearance-resume-v1.json; nativeUIPhotorealcheckbox38set1.
Freshsnapshot inspect-native-appearance-before-v1.json; samecatalog-v2 +originalservercreationmaterialmap generated9materialops+2independentHDR kitchen_channels_v1_studio/daylight. Appliedops-native-channels-hdr-v1.json,162getterreadbackPASS/native-channels-hdr-readback-v1.json. Captured3studio views native-studio-v1 (overview/sink/cabinet). Viewedoverview/sink: originalstone normaltooheavy/paintdark/fabricredchecked/sourceglassalpha.75 tooopaque. Daylightactivatedops-native-daylight-activate-v1.json.
One appearance-only tuning9ops applied via native-finish-tuning-v1.json: paint#e6e0d4 normal.2 roughness.9;wood#aa794a normal.25 roughness.7;stone#d2d0c8 normal.08 roughness.45;fabric#cdc8bd normal.35 roughness1;metal#d4d7da normal.12 roughness.3;glass#adcbd1 alpha.25 roughness.04; colorize_type tint. Alloriginalgeometry/frozenrequirementsuntouched. Expectedfullmergedmaterials native-finish-tuning-preview-v1.json. Actual162getterreadbackPASS/native-finish-readback-v1.json.
ACTIVE capture63963: native-daylight-refined-v1 usingnative-channel-views-v1.json3views. WaitcompletionbeforeUI/mutation. Needviewimages, capturematchingstudioaftertuning forcontrolledHDRcomparison, saveNEW models/kitchen-living-v1-native-channels-v1.skp (notyetexists), closequitactualreloadinspect+pixelpersistenceexpected21channels/162values. DoNOTloseunsavedchangesorclosetillMCPsaveverified. Noprimitivecreationreplayed.
Pendingasyncinformationquestion askswhereStylesfloatingpanelis(otherdisplay/notseen/besidemodel); NOANSWERyet. Thisisnotapproval. PendingentrypavingdimensionsrevisionstillNOTapproved. Keepworkingindependently. Fullplanincomplete.

## 2026-09-06 原生样式与厨房外观续验

当前综合离线回归 57/57 通过：`output/detail-modeling-offline-2026-09-06T12-12-57-334Z-PY1one/report.json`。

`style_load` 可选 `capture_current_display: true`，要求 `activate: true`；从真实 .style 导入新样式，复制当前原生渲染选项并用官方 `Styles#update_selected_style` 提交。其他样式内容取自导入文件；不是任意当前样式的完整克隆。不覆盖同名样式，不自行推断 Photoreal 枚举。能力 `style_capture_current_display` 由原生 API 检测。外观执行器支持 `--capture-current-display true`，仍须提供真实 `--style-path`。

厨房原生 PBR/HDR 保存重开已通过 162 项读回及 21 通道像素校验；随后原生样式与六场景绑定通过 192 项读回，六张受控场景捕获完成且状态恢复通过。证据：`evidence/kitchen-living-v1/native-bound-scenes-review-v1.json`（位于本轮 output 目录）。场景绑定的第二次完整退出重开验证仍在进行。入口铺装修正、通道对照及几何变化任务等尚未全部验收，不能标记总计划完成。

## 2026-09-06 原生场景重开及普通柜体参数修复

厨房六场景绑定经完整退出、重新启动、磁盘重开后，192 项读回及全部原生外观持久性比较通过：`native-bound-actual-reopen-comparison-v1.json`。

补充按指定基础配方装配传参的 `assemblyParameters` / `base_assembly_parameters`，只接收该配方明确声明的参数；保留其他装配、实例放置、既有参数和冻结输入。实机 760 mm 变化暴露旧柜脚标识包含坐标的问题，修改已单独保存，质量对应失败记录保留。基础柜体重新编译现按明确四角构造保留原柜脚标识，拒绝歧义构造。

新 740 mm 单实例实机变化已读回目标740/另一只800 mm，47 个细部对应成功，另一实例未变；完整原生材质与环境状态未变。变化模型已保存；磁盘重开与后续编辑尚待续验。映射成功不等于把旧800 mm冻结要求改写为已通过。

执行器增加提交后质量对应失败时先另存变化模型再返回错误，禁止重放或伪造质量通过。最新离线57/57：`output/detail-modeling-offline-2026-09-06T12-35-02-249Z-SObKC5/report.json`。
