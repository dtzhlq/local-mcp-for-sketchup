# Local MCP for SketchUp — 品牌物料

本目录基于 `brand/BRAND.md` 的 VI v1，使用本地 HTML/CSS 确定性排版。
所有文字都由浏览器渲染，不由图片生成模型生成。

## 第一批物料

| 输出 | 尺寸 | 用途 |
| --- | ---: | --- |
| `dist/avatar-1024.png` | 1024 × 1024 | Discord / GitHub 头像 |
| `dist/github-social-1200x630.png` | 1200 × 630 | GitHub Social Preview / Open Graph |
| `dist/github-social-1280x640.png` | 1280 × 640 | GitHub 仓库设置推荐尺寸 |
| `dist/readme-header-1600x480.png` | 1600 × 480 | README 品牌头图 |
| `dist/release-technical-preview-1600x900.png` | 1600 × 900 | 技术预览发布页与发布帖 |
| `dist/install-guide-cover-1086x1448.png` | 1086 × 1448 | 安装指南封面 |

## 可编辑源

`render.html` 通过 `?asset=` 选择画板：

- `avatar`
- `social`
- `readme`
- `release`
- `install`

示例：

```text
brand/materials/render.html?asset=social
```

## 字体与离线边界

当前机器没有安装 Space Grotesk、Inter 和 JetBrains Mono，因此首批输出使用
VI 允许的系统回退字体：

- 西文与数字：Helvetica Neue / Arial
- 中文：PingFang SC
- 代码：SF Mono / Menlo

模板不加载 Google Fonts 或其他远程资源，可离线复现。

## 使用边界

- 对外产品名统一为 `Local MCP for SketchUp`。
- `for SketchUp` 始终是描述性副标题，不与 `Local MCP` 使用相同强调层级。
- 技术预览物料保留 `NOT GA` 或 `TECHNICAL PREVIEW` 边界。
- 橙色只用于警告和限制信息。
- `logo-concept-*` 不作为公开物料或图片生成参考。
