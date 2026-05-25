# Expert Mode v1

更新时间：2026-05-25

Expert Mode 是 JSON DSL 的受限生成层。它不会直接调用 SketchUp API，也不会替代 `build_model` 的安全 JSON DSL；当前第一切片只做：

```text
Expert script -> AST 白名单解释器 -> JSON DSL -> 现有 mock/queue runtime
```

## 使用

编译为标准 DSL：

```bash
node src/cli.mjs compile_expert --code-file examples/expert-parametric-fixture.js --format dsl
```

编译后直接用 mock runtime 构建：

```bash
node src/cli.mjs build_expert_model --runtime mock --code-file examples/expert-parametric-fixture.js --seed 7
```

`build_expert_model` 内部仍然调用现有 `build_model`，所以 queue runtime 后续可直接复用：

```bash
node src/cli.mjs build_expert_model --runtime queue --timeout-ms 60000 --code-file examples/expert-parametric-fixture.js --seed 7
```

## 允许的子集

- `const` / `let` / `var`
- 命名函数、函数表达式、箭头函数
- `for` / `for...of` 循环，带全局 loop limit
- 数组、对象、数字、字符串、布尔值、template literal
- 数学表达式、比较、条件表达式、`if`
- `Array.push`、`Array.map`、`Array.filter`、`Array.flatMap`、`Array.reduce`、`Array.concat`
- 内置 helper：`range`、`random`、`rand`、`clamp`、`lerp`、`rad`、`deg`、`vec.add`、`vec.sub`、`vec.scale`、`vec.mid`、`vec.lerp`、`vec.dot`、`vec.cross`、`vec.length`、`vec.distance`、`vec.norm`、`vec.normalize`、`dsl`
- 白名单 `Math` 函数：`abs`、`ceil`、`floor`、`max`、`min`、`pow`、`round`、`sign`、`sin`、`cos`、`tan`、`asin`、`acos`、`atan`、`atan2`、`hypot`、`sqrt`

脚本最后一个表达式必须返回 `operations` 数组，或返回 `{ version, units, operations }` 文档对象。

## 禁止项

- 文件系统、网络、shell
- `import` / `require`
- `eval` / `new Function`
- 直接 SketchUp/Ruby API
- `while` / 无限循环类语法
- `class`、`new`、`await`、object spread / call spread
- `__proto__` / `prototype` / `constructor` 成员访问

## 限制

默认限制：

- `maxOperations = 2000`
- `maxLoopIterations = 10000`
- `maxStatements = 50000`
- `maxOutputBytes = 5000000`
- `expertTimeoutMs = 1000`

CLI 参数：

```bash
--max-operations 2000
--max-loop-iterations 10000
--max-statements 50000
--max-output-bytes 5000000
--expert-timeout-ms 1000
--seed 7
```

## 验证

当前第一切片由 `test/expert-compiler.mjs` 和 Expert QA 脚本覆盖：

- 参数化 fixture 编译为 19 个 DSL operations
- `range().map(...)`、函数、双层 `for`、seeded random 和 `vec` helper
- `Array.filter` / `flatMap` / `reduce`、`clamp` / `lerp` / `rad` / `deg`、`vec.cross` / `vec.norm` / `vec.distance` 等扩展 helper
- mock 构建后得到 12 个 component instances、2 个 groups、0 warnings
- 拒绝 `require`、超 loop limit、超 operation limit、缺 required field、component_definition 内嵌不支持的 op 和 `while`

发布回归命令：

```bash
npm run qa:expert:mock
npm run qa:expert:queue
```

输出：

```text
output/qa-reports/expert-mock/index.md
output/qa-reports/expert-queue/index.md
```

每个报告检查 Expert 编译、runtime build、artifact 保存、runtime compatibility、snapshot warnings 和基础预算。mock artifact 保存为 JSON，queue artifact 保存为 SKP。

当前验证结果：

- `qa:expert:mock` Verdict `pass`：19 compiled ops，562 faces / 1548 edges / 2 groups / 12 instances，warnings 0，artifact JSON 53663 bytes。
- `qa:expert:queue` Verdict `pass`：19 compiled ops，739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances，warnings 0，SKP artifact 207147 bytes。

SketchUp Bridge 重启后，live queue 单例也已通过：

```bash
node src/cli.mjs build_expert_model --runtime queue --timeout-ms 60000 --code-file examples/expert-parametric-fixture.js --seed 7 --output-file output/expert-parametric-queue.json
```

验证结果：编译 19 个 operations，queue snapshot 为 739 faces / 2079 edges / 1386 vertices / 2 groups / 12 instances，warnings 0；`Expert_Parametric_Label` 为真实 `text_3d`，277 faces / 771 edges。

## 扩展原则

后续新增 Expert helper 仍按白名单收口：只增加确定性数学、向量、数组和 DSL 生成辅助，不开放文件系统、网络、动态 import 或直接 SketchUp API。

## MCP 工具

stdio MCP server 已暴露：

- `compile_expert`：输入 Expert Mode script，返回编译后的 JSON DSL 文档和 compiler metadata
- `build_expert_model`：输入 Expert Mode script，先编译为 JSON DSL，再用 `mock` 或 `queue` runtime 构建模型

`test/mcp-server.mjs` 会启动真实 `src/mcp-server.mjs` 子进程，验证 `tools/list` 和 `tools/call` 路径。
