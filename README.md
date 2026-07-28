# Local MCP for SketchUp

一个独立、免费、开源、可离线运行的本地 MCP 技术预览项目，用于让 Agent
在明确能力、目标和审核边界内与 SketchUp 协作。

> 当前公开版本：`v0.1.0-rc.4.unsigned.1` 无签名技术预览；
> `release_acceptance=false`，不是正式签名版或 GA。

## 让 Agent 帮你安装

不需要先学习 Git 或 GitHub。把下面整句话复制给你的 Agent：

> 请打开
> https://gitee.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md，
> 严格按照其中的当前公开状态安装 Local MCP for SketchUp；不要猜测缺失制品，
> 遇到权限、签名、平台或配置冲突时停止并告诉我需要手动完成什么。

海外或能够访问 GitHub 的 Agent 也可以读取
[GitHub 安装入口](https://github.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md)。
两处入口应描述同一安装边界，Agent 可以选择能够访问的官方镜像。

当前公开制品只支持下载、校验和导入无签名 SketchUp 插件预览，不包含本地
MCP 服务包或随包 Node.js。因此 Agent 必须明确报告“仅安装插件预览”，不能
声称完整 MCP 已经安装。正式的一句话安装将在签名 RBZ、两平台服务包、
固定版本清单和实机验收完成后启用。

面向 Agent 的完整入口见 [INSTALL_FOR_AGENTS.md](INSTALL_FOR_AGENTS.md)；
底层固定版本协议见 [docs/AGENT_INSTALL.md](docs/AGENT_INSTALL.md)。

## 当前边界

当前核心服务暴露 41 个 MCP tools，覆盖能力发现、受控建模、现有模型编辑、
会话与队列诊断、审批和证据输出。工具注册表见
[docs/tool-registry.md](docs/tool-registry.md)。

这仍是边界明确的技术预览候选：

- 不是完整 SketchUp Ruby API 封装；
- 不执行任意 Python 或任意 Ruby；
- 不承诺从照片全自动生成准确模型；
- 不代表所有 SketchUp 版本或所有 MCP 客户端已兼容；
- 离线检查、mock 测试和一次受控实机证据不等于正式发布验收。

首次发布的目标环境：

- SketchUp 2026 on macOS Apple Silicon；
- SketchUp 2026 on Windows x64。

首次发布不支持 Intel Mac。Windows 2026 实机验收尚待完成。

## 设计原则

- 安装完成后可在本地运行，不要求持续联网；
- 不包含遥测、运行时许可证校验或正版识别；
- 只接受结构化、可审阅的建模输入；
- 变更模型前执行能力、目标、路径和审批检查；
- 未知 MCP 客户端只生成手动配置片段，不猜测或覆盖其配置；
- Mock、离线和实机证据分层记录。

## 从源码检查

需要 Node.js 24 和 Ruby。克隆后运行：

```text
npm ci
npm run core:check
```

`core:check` 是离线门禁，不会连接或修改正在运行的 SketchUp 模型。

生成一个明确标记为非正式发布的未签名 RBZ 预览包：

```text
npm run plugin:package -- \
  --output-dir out/previews/local-review \
  --artifact-label local-review
```

正式 RBZ 必须再由 SketchUp Extension Signing Portal 注入官方签名；内部
manifest 中的签署字段不能替代该签名。未签名包可能被 SketchUp 的扩展加载
策略阻止。

## MCP 客户端

首发安装协议为 Codex、Claude Desktop 和 Cursor 提供明确路径：

- Codex：安全合并 `config.toml` 中的 MCP server 表；
- Claude Desktop：采用其本地扩展安装流程，或提供手动配置；
- Cursor：安全合并已确认的 JSON MCP 配置；
- 其他客户端：只输出通用 stdio JSON 片段，由用户自行放入客户端配置。

自动配置必须先备份、拒绝符号链接和冲突项、只写允许的配置目录，并使用
随包 Node.js 的绝对路径。权限不足或客户端未知时，降级为校验下载并指导
用户通过 SketchUp Extension Manager 手动导入 RBZ。

安装协议草案见 [docs/AGENT_INSTALL.md](docs/AGENT_INSTALL.md)。正式固定版本
清单只会在制品签名、校验和平台验收完成后发布。

## 隐私和联网

常规运行不上传模型、队列内容或使用记录。下载安装时可以联网；安装完成后
不设置强制联网。详细的本地数据范围见 [PRIVACY.md](PRIVACY.md)。

未来中国大陆官方安装渠道的登记表单属于独立服务，将在收集数据前单独说明
字段、用途、保存期限和联系方式。登记不用于验证 SketchUp 是否为正版。

## 社区与反馈

欢迎加入 [Discord 社区](https://discord.gg/UXFs9pQbUW)，获取安装协助、提交
可复现问题、讨论功能建议并展示 SketchUp 工作流。邀请链接会进入 `#welcome`
频道，长期有效。

Discord 用于交流和初步排查；需要持续跟踪的问题仍应整理到
[GitHub Issues](https://github.com/dtzhlq/local-mcp-for-sketchup/issues)。
发布日志或截图前，请移除私有模型内容、账号信息、API 密钥和其他敏感数据。

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
