# Release Checklist

更新时间：2026-05-25

本清单用于把当前本地 replica 收成可安装、可回归、可打包的 release slice。

## 1. 本地静态检查

```bash
npm run plugin:check
npm test
npm run qa:mock
npm run qa:expert:mock
npm run qa:budget:mock
git diff --check
```

通过标准：

- Ruby 插件主文件和所有子模块 `ruby -c` 通过。
- Operation contract 输出 manifest / mock / Ruby dispatch 为 `64 / 64 / 64`，component registry / dispatch 为 `42 / 42`。
- Expert Mode fixture 编译和 mock build 通过，且安全拒绝场景由 `test/expert-compiler.mjs` 覆盖。
- MCP stdio server 的 `tools/list` 和 `tools/call compile_expert/build_expert_model` 由 `test/mcp-server.mjs` 覆盖。
- mock QA、Expert mock QA 与 mock budget 均 Verdict `pass`。

## 2. 安装 SketchUp 插件

```bash
npm run plugin:install
```

安装目录默认是：

```text
~/Library/Application Support/SketchUp 2026/SketchUp/Plugins
```

安装后完全退出并重新打开 SketchUp，然后执行：

```bash
node src/cli.mjs get_capabilities --runtime queue --timeout-ms 10000
```

通过标准：

- `runtime.version` 等于当前 `PLUGIN_VERSION`。
- `runtime.compatibility.ok` 为 `true`。
- `runtime.compatibility.issues` 为空。
- supported operations 数量为 `64`。

## 3. Queue 回归

```bash
npm run qa:queue
npm run qa:expert:queue
npm run qa:budget:queue
```

`queue` runtime 绑定当前 SketchUp 进程和 file queue，发布验证必须串行执行这些命令。Node 侧会用 `~/.sketchup-mcp-replica/queue-runtime.lock` 防止多个 queue 命令互相插入。

通过标准：

- `output/qa-reports/queue/index.md` Verdict `pass`，9 个默认样例 Total Diffs 为 `0`。
- `output/qa-reports/expert-queue/index.md` Verdict `pass`，Expert fixture 编译、queue 构建、SKP artifact 保存、runtime compatibility、warnings 和基础预算均通过。
- `output/performance-budgets/queue/index.md` Verdict `pass`，四个发布样例低于默认 face / edge / vertex / group / instance / SKP size budget。

## 4. 打包 RBZ

```bash
npm run plugin:package
```

输出：

```text
out/releases/alma-sketchup-mcp-<PLUGIN_VERSION>.rbz
```

打包内容必须包含：

- `alma_sketchup_mcp.rb`
- `alma_sketchup_mcp/operation_registry.rb`
- `alma_sketchup_mcp/object_operations.rb`
- `alma_sketchup_mcp/materials.rb`
- `alma_sketchup_mcp/geometry_operations.rb`
- `alma_sketchup_mcp/primitive_operations.rb`
- `alma_sketchup_mcp/product_operations.rb`
- `alma_sketchup_mcp/profile_operations.rb`
- `alma_sketchup_mcp/surface_operations.rb`
- `alma_sketchup_mcp/demo_operations.rb`
- `alma_sketchup_mcp/architecture_operations.rb`
- `alma_sketchup_mcp/component_operations.rb`
- `alma_sketchup_mcp/view_operations.rb`
- `alma_sketchup_mcp/snapshot.rb`

## 5. 提交切片建议

当前主线变更已经跨多个功能面，建议按下面顺序拆 commit：

1. Operation registry / runtime contract：`src/capabilities.mjs`、`src/docs.mjs`、`src/bridge.mjs`、`src/snapshot-diff.mjs`、`test/*`。
2. DSL capability slices：新增 examples 和对应 mock/queue runtime 行为。
3. Runtime split：`src/object-*`、Ruby `alma_sketchup_mcp/` 子模块、主插件加载和 contract 更新。
4. Release docs / QA scripts：`docs/*`、`scripts/*`、`package.json`、README/PROJECT_STATUS。

提交前用 `git diff --name-only` 过滤 OneDrive mode-bit 噪声和无关生成物。
