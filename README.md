# Local MCP for SketchUp

**0.3.0 development candidate — 48 MCP tools.** Native verification covers Apple Silicon Mac and SketchUp 2026. This branch adds general modeling and CAD surface capabilities on the fixed `v0.2.0` baseline; it is not a new signed release.

An independent local MCP server for generating and editing SketchUp models through reviewed operations. Deterministic geometry, native measurement and execution recovery live in the MCP service and are available to any compatible model/client.

[Changes](CHANGELOG.md) · [48 tools](docs/tool-registry.md) · [Modeling guide](docs/modeling-uplift/usage.md) · [NURBS and curved-edge fillets](docs/cad-surface-kernel/README.md) · [Candidate setup](docs/DEVELOPMENT_CANDIDATE.md)

## What's new

| Capability | What it enables |
|---|---|
| `query_model_geometry` | Real vertices, edges, face loops, transforms and nested instance paths; revision-bound snapshots with bounded paging. |
| `measure_model_geometry` | Native lengths, areas, eligible solid volumes and supported geometric relations, with explicit unavailable results. |
| `edit_model_geometry` | Atomic local edits, root geometry editing, shared-instance isolation and native readback. |
| `run_model_program` | Up to three read–compute–review–execute–readback stages using real intermediate geometry. |
| `sweep_profile` / `loft_profiles_v2` | Non-circular profiles along 3D paths, scale/twist, unequal-point-count lofts and concave caps. |
| `cad_shape` / `replace_cad` | Rational NURBS patches, sewn solids, CAD booleans and selected curved-edge fillets; retained parameters for later regeneration. |

Sweep, loft and CAD operations use the existing creation, editing and program entry points; they do not add more top-level tools. Full transforms, public tool contracts and protocol adapters share the same business handlers. Session contracts, review policy, revision checks, atomic transactions and idempotent receipts remain in force. Unknown execution outcomes are resolved through the original request, not blind mutation replay.

## Verified behavior and limits

The modeling candidate was checked in a combined native SKP: sweep/loft creation, rotated nested-instance edits, staged face splitting and push/pull, rollback, stale references, root edits and save/close/reopen. See the [modeling evidence](docs/modeling-uplift/implementation-status.md).

CAD verification covered rational curves with an analytic radius, parameter changes, intersecting-cylinder curved-edge fillets and a six-patch NURBS solid. A full SketchUp restart and disk reopen passed on 2026-09-19, preserving parameter association and geometry counts. Deliberately modified geometry remained correctly marked stale. See the [CAD acceptance report](docs/cad-surface-kernel/acceptance-report.json).

SketchUp receives editable tessellated faces with retained CAD recipes, not native NURBS entities. Support is bounded to rectangular clamped nonperiodic patches and supported constant-radius fillets. Arbitrary historical mesh reconstruction, trimmed/periodic patches, variable-radius fillets and every complex corner are not supported. An invalid four-edge corner example is retained as a rejected case.

A GLM investigation identified an MCP creation-QA scope issue and missing read-only `String.indexOf` support; both were fixed. Its remaining stages then executed successfully after one model correction, without replaying creation. This is a bounded compatibility result, not a universal model-quality benchmark. Windows and cross-model CAD verification are not claimed.

## 让 Agent 帮你安装或升级

**版本区别：本页介绍的是 0.3.0 源码能力；下面的自动安装入口按已发布的安装清单选择版本。源码合并不会自动更新右侧 Latest Release，也不会把旧版安装包变成新版。**

把这句话发给 Agent；后续正式更新无需更换口令：

> 请在 GitHub 搜索用户 dtzhlq 的公开项目 local-mcp-for-sketchup，读取 main 分支根目录的 INSTALL_FOR_AGENTS.md，按其中的平台安装清单安装或升级到最新支持版本，保留现有配置和回退文件；找不到就停止，不要猜测或从第三方下载。

直接入口：

- [GitHub 安装入口](https://github.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md)
- [Gitee（码云）镜像入口](https://gitee.com/dtzhlq/local-mcp-for-sketchup/blob/main/INSTALL_FOR_AGENTS.md)

旧的“在码云搜索并读取 INSTALL_FOR_AGENTS.md”口令仍可用于读取已同步的入口；最终版本和下载文件以 GitHub 正式 release 的清单为准。不能访问清单时明确报告，不退回旧的未签名预览包。

Agent 会发现最新正式版，固定该版本清单，校验服务包和签名插件，按真实平台安装或升级，再验证客户端工具发现和 SketchUp 连接。无需系统 Node、克隆 main 或运行 npm。SketchUp 安装/重启、系统安全提示等步骤视 Agent 能力可能需要用户操作；“一句话发起”不等于所有客户端无人值守。

## Published platform packages

The signed 0.2.0 release targets Apple Silicon Mac / SketchUp 2026 (44 tools). Windows x64 / SketchUp 2026 has a separate [0.2.0 Windows installation preview](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0-windows-preview.1), with Windows CI server checks but no native Windows SketchUp acceptance. The stable installation entrypoint offers that preview explicitly when no stable Windows target matches. Intel Mac and other SketchUp versions have no matching package in these releases. These older packages do not contain the 0.3.0 candidate capabilities above.

## Install and documentation

- Development source and local candidate setup: [candidate instructions](docs/DEVELOPMENT_CANDIDATE.md).
- NURBS/fillet recipes and limits: [CAD guide](docs/cad-surface-kernel/README.md), [examples](examples/cad-kernel).
- Four modeling tools and reusable programs: [usage](docs/modeling-uplift/usage.md), [tool validation](docs/modeling-uplift/tool-validation.md).
- Single-image reconstruction: [image structure](docs/IMAGE_STRUCTURE.md). These are approximate reconstructions with explicit scale/hidden-geometry assumptions, not single-photo measured replicas.
- Third-party components and local distribution boundaries: [notices](THIRD_PARTY_NOTICES.md).

The historical [signed 0.2.0 release](https://github.com/dtzhlq/local-mcp-for-sketchup/releases/tag/v0.2.0) has 44 tools and separate [installation](docs/INSTALL.md) and [acceptance](docs/RELEASE_ACCEPTANCE.md) records. Its signature and acceptance do not apply to this candidate. Extension Warehouse publication was declined; no listing or official endorsement is claimed. Existing ALMA environment variables and Ruby namespaces remain intentional.

## 设计原则

- 安装完成后可在本地运行，不要求持续联网；
- 不包含遥测、运行时许可证校验或正版识别；
- 只接受结构化、可审阅的建模输入；
- 变更模型前执行能力、目标、路径和审批检查；
- 未知 MCP 客户端只生成手动配置片段，不猜测或覆盖其配置；
- Mock、离线和实机证据分层记录。

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
