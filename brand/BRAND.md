# SketchUp Local MCP — 品牌视觉规范 v1

> 定位一句话：本地、安全、可回放的 AI 建模协议（Local-first JSON DSL for SketchUp）。
> 设计语言：瑞士国际主义 × 工程图解 —— 网格、无衬线、黑白打底，单一蓝色强调。

## 1. 品牌名与字标

- 英文工作名：**SketchUp Local MCP**（字标排版：`SKETCHUP` 常规字重 + `LOCAL MCP` 粗体，或全大写等宽排版）
- 中文辅助名：**SketchUp 本地 MCP**
- 字标不生成图片，一律用字体排版实现（避免图像模型文字渲染事故）。

## 2. Logo

构成隐喻：**等轴测六边形 + S 形折带**（呼应 SketchUp logo 的形体语言，开口线框保持品牌距离）+ **顶点四角星火**（AI 驱动）。

| 文件 | 用途 |
| --- | --- |
| `logo-primary.png` | 主标识，蓝线框白底，用于浅色场景 |
| `logo-dark.png` | 深色场景，白线框 + 蓝星火 |
| `logo-icon.png` | 头像 / favicon / 社交头像，蓝底白线框 |

规则：
- 净空 = 六边形高度的 1/2，四边同宽。
- 最小尺寸：屏幕 24px，印刷 8mm。
- 禁止：拉伸变形、改强调色、加阴影/描边/渐变、放在杂乱背景上、旋转非 90° 倍数。
- 星火颜色是唯一允许出现的品牌蓝，禁止把折带填充成实色。

## 3. 色彩

| 角色 | 色值 | 用途 |
| --- | --- | --- |
| Brand Blue | `#002FA7` | 唯一主强调色：星火、索引号、关键标注、链接 |
| Ink | `#111111` | 标题、正文 |
| Paper | `#FFFFFF` | 浅色底 |
| Charcoal | `#141414` | 深色底 / 代码卡 |
| Grey | `#6E6E6E` | 次要文字、图注 |
| Line | `#E5E5E5` | 分隔线、网格线 |
| Signal Orange | `#FF4D00` | 仅用于警告/限制说明，点缀面积 ≤2% |

比例纪律：**70% 白 + 25% 黑灰 + 5% 蓝（橙极少）**。

## 4. 字体

- 西文标题：Space Grotesk（几何无衬线，呼应立方体）；备选 Inter Bold
- 西文正文：Inter；备选 Helvetica Neue / Arial
- 中文：思源黑体 / 苹方（PingFang SC）
- 代码：JetBrains Mono / SF Mono / Menlo

字阶（web 基准）：Display 64 / H1 40 / H2 28 / Body 16 / Caption 13 / Code 14。

## 5. 图形语言

1. **轴测线框**：所有插图统一 1px 线宽、轴测投影，禁止透视照片感 3D 渲染图当插图。
2. **点阵网格**：背景纹理用等距圆点（8px 网格，1px 点，#E5E5E5）。
3. **JSON 卡片**：深底等宽代码，键白 / 字符串蓝 / 标点灰 —— DSL 即视觉素材。
4. **蓝色标注框**：1px #002FA7 线框 + 左上小索引号，用于图注和技术参数。

## 6. 模板（HTML 活模板，见 brand-board.html 第 05 节）

- 文章封面：3:4（1086×1448），白底 + 大黑标题 + 蓝色索引号 + 底部 meta 行
- 社交预览：1.91:1（1200×630），深底 + 白标题 + JSON 卡片
- 模板用 HTML/CSS 渲染后截图出图，**不让图像模型生成任何文字**。

## 7. 图片生成纪律（2026-07-28 踩坑沉淀）

- prompt 里**禁止出现颜色名缩写**（IKB、Klein、克莱因），一律写 `saturated deep ultramarine blue`。
- prompt 里禁止任何需要渲染的文字内容，文字一律后期排版。
- 需要参考图时，只参考当前干净正式图，不复用历史临时图。

## 8. 文件清单

```
brand/
├── BRAND.md            # 本规范
├── brand-board.html    # 品牌展示板（可预览，含活模板）
├── logo-primary.png    # 主标识 1254×1254
├── logo-dark.png       # 深色版 1254×1254
├── logo-icon.png       # 头像图标 1254×1254
├── logo-candidates.html# A/B 候选对比页（存档）
└── logo-concept-*.png  # 候选原图存档，不作生成输入
```
