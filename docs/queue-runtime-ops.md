# Queue Runtime 验收与排障

更新时间：2026-05-22

本文是 SketchUp queue runtime 的手动验收清单和故障排查入口。自动化回归仍以 `npm test`、`npm run qa:mock`、`npm run qa:queue` 和单例 `compare_model` 报告为准；手动验收用于确认插件加载、版本漂移、视觉结果和 SketchUp 侧限制。

## 快速验收顺序

`npm run qa:mcp-capability-suite` 默认仅运行 mock，不发送 queue 请求。只有显式使用下列参数才能进入 live queue：

```bash
npm run qa:mcp-capability-suite -- --runtime queue --queue-required --timeout-ms 180000
```

该命令会在运行前警告，并会重置/修改当前 SketchUp 模型。未确认当前模型可被覆盖时不得运行。SIGINT/SIGTERM/异常退出会按进程 owner 清理本次 request 和 lock，不会删除其他 queue 进程的文件。

1. 确认插件已加载：

```bash
node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000
```

通过标准：

- `runtime.name` 为 `queue`。
- `runtime.compatibility.ok` 为 `true`。
- `runtime.compatibility.issues` 为空。
- `runtime.supported_operations` 数量与 `src/capabilities.mjs` 的 registry 一致。
- `runtime.plugin_version` 是本次安装后的版本；如果仍是旧版本，需要完全退出并重新打开 SketchUp。

2. 跑离线基线：

```bash
npm test
npm run qa:mock
```

通过标准：

- contract 输出 manifest / mock dispatch / Ruby dispatch 数量一致。
- mock QA index Verdict 为 `pass`。

3. 跑 queue golden set：

```bash
npm run qa:queue
```

`npm run qa:queue` 默认使用 180s queue timeout。不要和其他 queue 命令并行运行；当前插件通过单个 SketchUp timer 串行消费 file queue。

通过标准：

- `output/qa-reports/queue/index.md` Verdict 为 `pass`。
- 默认允许 `--face-tolerance 1 --edge-tolerance 3`，用于吸收 SketchUp 真实拓扑和 mock 估算的轻微差异。

4. 对高风险 slice 单独出报告：

```bash
node src/cli.mjs compare_model --code-file examples/appearance-texture-slice.json --expected-runtime mock --actual-runtime queue --timeout-ms 60000 --face-tolerance 1 --edge-tolerance 3 --format markdown --output-file output/appearance-texture-queue-report.md
node src/cli.mjs compare_model --code-file examples/golden-product.json --expected-runtime mock --actual-runtime queue --timeout-ms 180000 --face-tolerance 1 --edge-tolerance 3 --format markdown --output-file output/golden-product-queue-report.md
node src/cli.mjs build_model --runtime queue --timeout-ms 60000 --code-file examples/text-3d-slice.json
```

通过标准：

- Markdown 报告 Verdict 为 `pass`。
- Total diffs 为 `0`，或仅存在明确记录过的 topology tolerance 差异。
- Warnings 只包含预期 warning，例如旧 SketchUp 版本的 `material.pbr_unsupported` 或缺失贴图路径的 `material.missing_texture`。

## Queue 诊断与视口捕获

不确定 Bridge 是否在处理请求时，先跑本地诊断。它不会向 SketchUp 写请求，只检查 queue/response 目录和 lock 文件：

```bash
node src/cli.mjs queue_diagnostics --include-files
```

通过标准：

- `lock.exists=false`，或 lock 未 stale 且确实有另一个 queue 命令在运行。
- `queue.count=0`，否则说明有未处理请求。
- `responses.count=0`，否则说明有中断命令留下的孤儿 response。

SketchUp Bridge 可用后，可以保存当前或标准视角截图作为可见证据：

```bash
node src/cli.mjs capture_view --runtime queue --view iso --width 1280 --height 720 --path output/queue-capture.png --timeout-ms 60000
```

`capture_view` 会返回图片路径、文件大小、相机参数和模型摘要。它是 live queue 证据辅助工具，不替代 snapshot、layout QA 或 reference visual QA。

## Gated Ruby Expert 调试入口

`run_ruby_expert` 只用于本地调试和 SketchUp Ruby API 能力探测，不是建模验收路径，也不能替代 JSON DSL、operation registry、snapshot compare 或 QA gates。默认调用会返回 `blocked:true`，不会向 SketchUp 发送执行请求。

要启用它，Node 命令和 SketchUp 插件进程都必须设置同一个环境变量。macOS 上通常需要从带 env 的终端启动 SketchUp，不能只在 CLI 命令前加 env：

```bash
ALMA_SKETCHUP_ENABLE_RUBY_EXPERT=1 node src/cli.mjs run_ruby_expert --runtime queue --code 'Sketchup.active_model.title' --audit-path output/ruby-expert-audit.json --timeout-ms 60000
```

通过标准：

- 未设置 env 时返回 `enabled=false`、`blocked=true`。
- 真正执行时返回 `ok`、`stdout`、`stderr`、`result` 或 `error`。
- 每次插件侧调用都会写入 `audit_path`，默认在 `~/.sketchup-mcp-replica/audit/`。

## 手动视觉检查项

| 能力组 | 样例 | 检查点 |
|---|---|---|
| 身份与编辑 | `examples/editing-identity.json` | `id` / `target_id` 编辑链可执行；rename 后仍能继续 set material / transform / visibility / delete；隐藏对象不计入 totals 和 bbox |
| Transform | `examples/transform-chain-regression.json`、`examples/component-transform-composition.json`、`examples/transform-local-matrix.json` | group 与 component instance 的 center pivot、本地轴、模型轴、平移、matrix/local_matrix 叠加方向正确；matrix decomposition metadata 回传 translation、basis axes、scale、shear、determinant 和 mirrored |
| Profile | `examples/profile-edge-cases.json` | 凹多边形、多洞、`xz` 竖向 profile 和 component_definition 内嵌 profile 成功；洞外、洞重叠等失败样例返回结构化 error |
| 组织元数据 | `examples/metadata-organization-slice.json` | Tags/Layers、attributes、classification snapshot 字段回传；SketchUp attribute dictionary 中有镜像数据 |
| Appearance | `examples/appearance-texture-slice.json` | `texture_transform`、planar/box UV metadata、image plane 和 component_definition 内嵌 image plane 均回传；贴图缺失只 warning 不失败 |
| Text 3D | `examples/text-3d-slice.json` | queue 中应生成真实字体轮廓 3D text；snapshot kind 为 `text_3d`，`Text3D` attribute metadata 回传；mock bbox 是估算值，最终以视觉检查为准 |
| 产品/建筑 golden | `examples/golden-product.json`、`examples/golden-architecture.json` | 组件复用、曲面 helper、建筑 helper、scene/style/shadow 保存稳定；bbox 和主要 group/instance 数量与报告一致 |

## Queue 常见故障

| 现象 | 常见原因 | 处理 |
|---|---|---|
| `get_capabilities` 超时 | SketchUp 未打开、Bridge 未启动、插件 timer 停止、SketchUp 正在处理大模型 | 打开 SketchUp，执行 `Extensions/Plugins -> Alma SketchUp MCP -> Start Bridge`，再用 `--timeout-ms 10000` 重试 |
| 插件版本仍是旧值 | Ruby 文件已复制但 SketchUp 没有重载 | 完全退出 SketchUp 后重新打开；菜单 stop/start bridge 不能重载 Ruby 源文件 |
| `runtime.compatibility.issues` 有缺失 operation | 安装目录缺少主文件或拆分后的子文件 | 重新复制 `alma_sketchup_mcp.rb` 和 `alma_sketchup_mcp/` 子目录，再重启 SketchUp |
| SketchUp 启动时报 `LoadError` | `require_relative` 指向的拆分文件未复制 | 确认 Plugins 目录存在 `alma_sketchup_mcp/` 子目录里的 operation registry、object/material/geometry/primitive/product/profile/surface/demo/architecture/component/view/snapshot 文件 |
| queue 请求卡住 | 上一个请求还在执行、队列文件残留、响应目录不可写 | 先确认 SketchUp 不在处理模型，再检查 `~/.sketchup-mcp-replica/queue/` 和 `~/.sketchup-mcp-replica/responses/`；不要在请求运行中删除文件 |
| queue lock 超时 | 另一个 Node 进程正在持有 `queue-runtime.lock` 跑 queue 命令，或上次进程异常退出留下未过期 lock | 等当前命令结束后重试；确认没有 queue 命令运行时，可删除 `~/.sketchup-mcp-replica/queue-runtime.lock` |
| `material.missing_texture` warning | 贴图路径不存在或相对路径不是预期工作目录 | 用绝对路径，或接受 warning；缺失贴图不会中断建模 |
| PBR 字段被跳过 | SketchUp 版本缺少对应 Ruby Material API | 检查 warning 是否为 `material.pbr_unsupported`；在不支持版本中只验证 base color/alpha/texture |
| golden product 超时 | 曲面、组件和保存耗时超过默认 timeout | 用 `--timeout-ms 180000` 单独跑高成本样例 |
| OneDrive 偶发 `ETIMEDOUT` | 云盘同步干扰文件读取 | 重跑当前命令；看变更时优先用 `git diff --name-only` 过滤 mode-bit 噪声 |

## 安装检查

当前 Ruby 插件由主文件和子目录组成，安装时必须一起复制：

```bash
npm run plugin:install
```

复制后需要完全重启 SketchUp，随后用 `get_capabilities` 确认 `plugin_version`。如果需要生成 SketchUp Extension Manager 可导入的 `.rbz` 包，运行 `npm run plugin:package`。
