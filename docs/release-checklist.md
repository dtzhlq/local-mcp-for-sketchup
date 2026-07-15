# Release Checklist

更新时间：2026-07-15

本清单用于把当前本地 replica 收成可安装、可回归、可打包的技术预览 slice。

发布边界调整：2026-05-25 验收复盘后，当前版本不再把 `projects/image-structured-modeler` 的照片级/多图产品建模能力与主线 MCP runtime 发布 gate 混写。下面的检查用于验证主线 MCP 的基础 runtime、Expert Mode、queue 回归、仓库内部 restricted facade expression R3 和 RBZ 打包是否健康；子项目正式发布仍需独立的产品样本/照片级验收。这里的 R3 不是 SketchUp 官方 API 版本。

## 1. 本地静态检查

```bash
npm run plugin:check
npm test
npm run qa:mock
npm run qa:model-layout
npm run qa:expert:mock
npm run qa:budget:mock
npm run qa:python-sdk-high-value:mock
npm run qa:nested-edit:mock
npm run qa:existing-model-edit:mock
npm run qa:mock-session-isolation
npm run test:python-sdk-source-compat
npm run qa:mcp-capability-suite -- --runtime mock
npm run test:image-structured
node test/image-structured-mcp-adapter.mjs
git diff --check
```

通过标准：

- Ruby 插件主文件和所有子模块 `ruby -c` 通过。
- Operation contract 输出 manifest / mock / Ruby dispatch 为 `101 / 101 / 101`，component registry / dispatch 为 `57 / 57`。
- Expert Mode fixture 编译和 mock build 通过，且安全拒绝场景由 `test/expert-compiler.mjs` 覆盖。
- MCP stdio server 的 `tools/list` 必须精确为 36；两个 image artifact adapter 和两个 reviewed existing-model edit 工具的 allowed/blocked 合同分别由 targeted tests 与 capability suite 覆盖。
- Python source corpus 必须为 35 cases / 29 canonical golden / 6 stable unsupported / 0 unclassified；mock session 并发隔离必须通过。
- mock QA、model layout QA、Expert mock QA 与 mock budget 均 Verdict `pass`；`qa:model-layout` 必须生成 Switch、救护车和儿童房的正交 preview/report，且 issues 为 `0`。

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
- supported operations 数量为 `101`。

## 3. Queue 回归

```bash
npm run qa:queue
npm run qa:expert:queue
npm run qa:budget:queue
npm run qa:official-api-r3:queue
npm run qa:python-sdk-high-value:queue
npm run qa:nested-edit:queue
npm run qa:existing-model-edit:queue
npm run qa:mcp-capability-suite -- --runtime queue --queue-required --timeout-ms 180000
```

`queue` runtime 绑定当前 SketchUp 进程和 file queue，发布验证必须串行执行这些命令。Node 侧会用 `~/.sketchup-mcp-replica/queue-runtime.lock` 防止多个 queue 命令互相插入。

通过标准：

- `output/qa-reports/queue/index.md` 中 10 个默认样例 `OK: true`；聚合 Verdict 允许为 `review`，因为 mock/queue 真实拓扑差异会保留 warning。
- `output/boolean-manifold-queue-report.md` 使用 solid boolean 专用 topology/bbox tolerance 后 Verdict `pass`，Total Diffs 为 `0`。
- `output/model-qa/ambulance-reference-rerun-queue/report.md` Verdict `pass` / Level `ok` / issues `0`；救护车样例必须由 `npm run acceptance:generate-ambulance` 重新生成后再跑 queue。
- `output/qa-reports/expert-queue/index.md` Verdict `pass`，Expert fixture 编译、queue 构建、SKP artifact 保存、runtime compatibility、warnings 和基础预算均通过。
- `output/performance-budgets/queue/index.md` Verdict `pass`，四个发布样例低于默认 face / edge / vertex / group / instance / SKP size budget。
- `output/python-sdk-official-api-expression-r3-queue.json` 断言全部通过，并保存 `output/python-sdk-official-api-expression-r3.skp`；当前基线为 `12 operations / 5 groups / 10 faces / 29 edges / 25 vertices / selection 1 / scene 1 / warnings 0`。
- 高频 Python SDK、nested edit 和 Existing Model Editing Engine queue gate 必须保存对应 JSON/SKP；后者还必须证明 deep path/revision 在 save/reopen 后稳定。image adapter 只生成离线 preview，不进入 queue 执行。

## 4. 打包 RBZ

```bash
npm run plugin:package
npm run release:manifest -- --live-status passed --offline-gate npm-test --offline-gate test-image-structured --offline-gate plugin-check
```

输出：

```text
out/releases/alma-sketchup-mcp-<PLUGIN_VERSION>.rbz
out/releases/alma-sketchup-mcp-<PLUGIN_VERSION>.sha256
out/releases/release-manifest-<PLUGIN_VERSION>.json
```

checksum 文件中的 RBZ 名是同目录相对路径，应在 `out/releases/` 内运行 `shasum -a 256 -c <file>.sha256`。

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
- `alma_sketchup_mcp/feature_operations.rb`
- `alma_sketchup_mcp/boolean_operations.rb`
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
