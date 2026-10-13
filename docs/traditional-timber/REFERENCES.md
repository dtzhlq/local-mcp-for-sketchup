# 通用装配参考与自绘示意

2026-10-05 核对。机器索引见 [reference-index.json](reference-index.json)，实际支持范围见 [调用说明](ASSEMBLY.md)。参考用于辨认可见关系；示例尺寸和本版转角节点是项目工程选择，不从照片推算绝对尺寸或宣称复原某座实物。

## 12 张公开参考视图

| 索引 | 原始页面、作者和用途 | 分发边界 |
| --- | --- | --- |
| p01–p04 | [故宫博物院：玉翠亭、凝香亭](https://www.dpm.org.cn/explore/building/236444.html)，页面文字茹競华；整体、屋面方向与檐下近景 | 未确认图片再分发许可，只保留链接。p03 是方向视图，不能当作两亭平面图 |
| g01–g02 | [北京市政府：陈惠展作品](https://www.beijing.gov.cn/tsbj/tszt/hsbj/chz/chzzpjx/202206/t20220628_2754059.html)，2022-06-28；广亮门、如意门绘图 | 只用于门墙、屋盖和门扇关系；不是测绘图，未确认图片再分发许可 |
| r01 | [Gary Todd：长廊亭内仰视](https://commons.wikimedia.org/wiki/File:Summer_Palace_Long_Corridor_(9864902866).jpg)，2007-06-23 | 文件页标明 CC0。画面为多边亭内的放射椽；本版不因此支持多边亭 |
| r02 | [Gary Todd：长廊梁枋斜视](https://commons.wikimedia.org/wiki/File:Summer_Palace_Long_Corridor_(9864826265).jpg)，2007-06-23 | 文件页标明 CC0；用于承托层次，不复制彩画 |
| w01 | [猫猫的日记本：沧浪亭月洞墙](https://commons.wikimedia.org/wiki/File:A_Moon_gate_in_Great_Wave_Pavilion_2012-03.JPG)，2012-03-10 | 文件页标明 CC BY-SA 3.0；本仓库只链接，不复制照片或制作照片衍生图 |
| c01 | [苏州市园林和绿化管理局：留园](https://ylj.suzhou.gov.cn/szsylj/sjyc/201905/b7c0f2058c75498c9ecbacf234e25b08.shtml)，摄影未单列 | 用于院内建筑与敞廊关系；画面中的双层建筑不是本版支持项，未确认图片再分发许可 |
| c02–c03 | [Yan et al., 2023，图 2 与图 4](https://www.mdpi.com/1660-4601/20/4/3158)，DOI 10.3390/ijerph20043158；园林场景与留园中部平面 | 文章标明 CC BY 4.0；图 4 底图权利未独立核对，只保留链接 |

以上图像均实际查看过浏览器像素。索引分别保存原页面与图片 URL、作者、用途、许可说明和核对日期；没有下载远程图像字节进入 Git。`locator_sha256` 仅标识 URL 对，不是图片内容哈希。远程 `content_sha256` 为 null；r01 文件页提供的 SHA-1 独立标注，不冒充本地 SHA-256。

## 5 张项目自绘示意

| 文件 | 明确表达的关系 |
| --- | --- |
| [A 柱网](diagrams/a-bay-grid.svg) | 两列各五柱、四跨，第二跨 3000→3300 后总长 12300 mm；共享根另置，不跟随修改 |
| [B 方攒尖](diagrams/b-pyramid.svg) | 方形四角与共同顶点、周边支承；不表示完整历史雷公柱构造 |
| [支承剖面](diagrams/support-section.svg) | 梁、檩、椽与板的可见承托关系；尺寸为项目选择 |
| [90° 转角](diagrams/corner-miter.svg) | 同标高等宽的 45° 收口与共用柱节点；不是命名历史节点的测绘复原 |
| [C 场地](diagrams/courtyard-plan.svg) | 八个独立根、入口与房廊关系、两段声明通道；不按历史院落比例放样 |

SVG 为项目自绘、非比例工程示意，采用项目 Apache-2.0 许可。索引记录实际文件的 SHA-256。渲染图和原生验收图片留在忽略的 `output/traditional-assembly/v041/`，不作为分发素材包。

运行时规则只引用关系资料，默认尺寸见 [contemporary-chinese-v1.json](../../data/traditional-timber/contemporary-chinese-v1.json)。历史参数需要另有可定位的文献依据；`selected`、`derived`、`simplified` 不升级为 `documented`。
