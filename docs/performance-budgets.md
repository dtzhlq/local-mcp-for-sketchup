# Performance / SKP Size Budgets

更新时间：2026-05-22

本页固定发布前性能预算入口。它复用 snapshot diff 的 `budgets` 机制，但通过 `save_model` 额外生成 artifact，因此 queue runtime 会写真实 `.skp` 并检查 SKP 文件大小。

## 默认预算

| Budget | Limit |
|---|---:|
| `max_faces` | 5000 |
| `max_edges` | 10000 |
| `max_vertices` | 5000 |
| `max_groups` | 120 |
| `max_instances` | 80 |
| `max_artifact_size_bytes` | 5000000 |

默认样例覆盖：

- `examples/golden-architecture.json`
- `examples/golden-product.json`
- `examples/structured-product-helpers.json`
- `examples/appearance-texture-slice.json`

## 命令

```bash
npm run qa:budget:mock
npm run qa:budget:queue
```

单独调试某个样例：

```bash
node scripts/run-performance-budgets.mjs --runtime queue --example examples/golden-product.json --timeout-ms 180000 --output-dir output/performance-budgets/golden-product-queue
```

调高或调低阈值：

```bash
node scripts/run-performance-budgets.mjs --runtime queue --timeout-ms 180000 --max-faces 3000 --max-artifact-size-bytes 1000000
```

## 输出

- `output/performance-budgets/mock/index.md`
- `output/performance-budgets/queue/index.md`
- `output/performance-budgets/<runtime>/artifacts/`

每个样例会记录：

- build 时间
- save 时间
- faces / edges / vertices / groups / instances
- component definition 和 material 数量
- artifact size bytes
- budget report JSON / Markdown

## 当前基线

最近一次 queue budget 结果：

| Example | Faces | Edges | Vertices | Groups | Instances | SKP Bytes |
|---|---:|---:|---:|---:|---:|---:|
| golden-architecture | 447 | 819 | 446 | 39 | 0 | 215076 |
| golden-product | 1528 | 2570 | 1118 | 24 | 12 | 260263 |
| structured-product-helpers | 297 | 646 | 372 | 7 | 0 | 171462 |
| appearance-texture-slice | 8 | 20 | 16 | 2 | 1 | 152109 |

Verdict: `pass`，报告见 `output/performance-budgets/queue/index.md`。

## 判定规则

- `faces` 超预算按 error 处理。
- `edges`、`vertices`、`groups`、`instances`、`artifact_size_bytes` 超预算会进入 review；`run-performance-budgets.mjs` 的聚合结果会把非 pass 视为失败退出。
- queue runtime 必须先通过 `get_capabilities`，并确认 plugin version 与当前 checkout 对齐。
- 如果批处理因 SketchUp 队列偶发 timeout 中断，先单独重跑失败样例；单例通过后再重跑完整 `npm run qa:budget:queue` 生成统一 index。
