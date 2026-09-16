# Local MCP for SketchUp

独立、开源、可本地运行的 SketchUp MCP。当前正式版为 [0.2.0](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0)：Apple Silicon Mac + SketchUp 2026，内置 Node 服务包及签名插件，包含图片结构化新路径。

## 让 Agent 帮你安装或升级

把这句话发给 Agent；后续正式更新无需更换口令：

> 请在 GitHub 搜索用户 dtzhlq 的公开项目 local-mcp-for-sketchup，读取 main 分支根目录的 INSTALL_FOR_AGENTS.md，按其中的平台安装清单安装或升级到最新支持版本，保留现有配置和回退文件；找不到就停止，不要猜测或从第三方下载。

直接入口：

- [GitHub 安装入口](https://github.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md)
- [Gitee（码云）镜像入口](https://gitee.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md)

旧的“在码云搜索并读取 INSTALL_FOR_AGENTS.md”口令仍可用于读取已同步的入口；最终版本和下载文件以 GitHub 正式 release 的清单为准。不能访问清单时明确报告，不退回旧的未签名预览包。

Agent 会发现最新正式版，固定该版本清单，校验服务包和签名插件，按真实平台安装或升级，再验证客户端工具发现和 SketchUp 连接。无需系统 Node、克隆 main 或运行 npm。SketchUp 安装/重启、系统安全提示等步骤视 Agent 能力可能需要用户操作；“一句话发起”不等于所有客户端无人值守。

## 版本与支持范围

0.2.0 支持 Apple Silicon Mac / SketchUp 2026，暴露 44 个工具；建筑、室内、产品共用图片理解及建模接口。真实尺寸未知时使用相对尺度，不可见部分补全仍为假设。

Windows x64 / SketchUp 2026 现有独立的 [0.2.0 Windows 安装预览](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0-windows-preview.1)：内置 Windows Node、依赖及签名 RBZ，已通过 Windows CI 的启动、44 工具发现和图片结构化检查；Windows SketchUp 实机验收尚未完成，因此明确标为预览。Agent 会先匹配平台，向 Windows 用户说明并提供此安装选项，不再直接报告整个项目只支持 M 芯片 Mac。

Intel Mac 和其他 SketchUp 版本暂无对应安装包。RBZ 已独立签名，但未上架 Extension Warehouse，不代表官方认可。

**main 是安装文档入口，不是当前正式版的源码安装目标。** 实现和验收文档请查看 [v0.2.0 标签](https://github.com/dtzhlq/local-mcp-for-sketchup/tree/v0.2.0)。本分支保留的旧源码、41 工具注册表、预览安装脚本及草稿模板不用于安装新版；后续版本按清单自动选择。

安装与回退见 [INSTALL_FOR_AGENTS.md](INSTALL_FOR_AGENTS.md)、[安装说明](docs/INSTALL.md)。

## 设计原则

- 安装完成后可在本地运行，不要求持续联网；
- 不包含遥测、运行时许可证校验或正版识别；
- 只接受结构化、可审阅的建模输入；
- 变更模型前执行能力、目标、路径和审批检查；
- 未知 MCP 客户端只生成手动配置片段，不猜测或覆盖其配置；
- Mock、离线和实机证据分层记录。

## 开发者源码与客户端配置

普通安装使用正式 release 包；开发者需要源码时，应检出目标 release 的标签并读取该版本文档。main 中的旧预览脚本仅供历史开发维护，不能作为正式安装回退路径。

Agent 根据客户端真实配置格式进行最小修改：Codex 使用已确认的 TOML 配置，Cursor 使用已确认的 JSON 配置，其他客户端按其文档或返回手动片段。升级前备份，仅更新已确认属于本项目的条目，保留无关服务和用户设置。签名 RBZ 通过 SketchUp Extension Manager 安装。

## 隐私和联网

常规运行不上传模型、队列内容或使用记录。下载安装时可以联网；安装完成后
不设置强制联网。详细的本地数据范围见 [PRIVACY.md](PRIVACY.md)。

未来中国大陆官方安装渠道的登记表单属于独立服务，将在收集数据前单独说明
字段、用途、保存期限和联系方式。登记不用于验证 SketchUp 是否为正版。

## 开源与贡献

核心代码使用 [Apache License 2.0](LICENSE)。第三方组件见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。贡献采用 DCO 1.1，请阅读
[CONTRIBUTING.md](CONTRIBUTING.md)。

安全问题请勿公开披露，按 [SECURITY.md](SECURITY.md) 联系
<dtzhlq@126.com>。

## 独立项目声明

本项目不是 Trimble Inc. 或 SketchUp 的官方产品，也未获其赞助、认可或合作
伙伴授权。“SketchUp”仅用于描述兼容对象。详见
[TRADEMARKS.md](TRADEMARKS.md)。
