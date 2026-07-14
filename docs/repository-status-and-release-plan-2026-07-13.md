# Repository Status and Two-Week MCP Release Plan

审计日期：2026-07-13（Asia/Shanghai）

## 结论

- 当前 checkout 是 `codex/runtime-registry-split`，审计起点 HEAD 为 `9d1872f`。审计开始时该 checkout clean；本轮只留下事实口径修正、optional `result` 兼容修复/回归和本报告，没有 staged file、merge、cherry-pick、commit、reset、revert 或删除。
- `main` 停在 `42be030`，当前分支相对 `main` 单向领先 46 个提交；仓库没有配置 remote/upstream。`main` 不是当前发布事实源。
- 当前 HEAD 实测 MCP `tools/list` 为 32 个工具；operation registry 为 91 个 operation，其中 56 个允许 `component_definition` scope。91 个 operation 只是本项目 DSL registry，不等于完整 SketchUp/Cloud Python API。
- 当前 HEAD 已有静态 `ParametricRecipe -> FeatureMappingPlan` 编译、依赖拓扑和 `first_output_then_fanout` 声明校验；`PartGraphCorrectionPatch -> applied/reviewed PartGraph -> safe JSON DSL` 的完整 first-output 制品链只在 `codex/organize-parametric-worktree` 的 `8aa7fb6`，尚未进入当前分支。
- 当前与参数化分支的完整离线门禁均通过；本轮新鲜 queue handshake 在 10 秒超时，因此 live SketchUp/queue 状态是 **未新鲜验证**。`plugin:check` 只证明 registry、Ruby 语法和包清单健康，不能替代 live queue 证明。
- 两周发布路径必须先完成分支收敛、事实合同和新鲜 live gate，再扩 SDK facade、nested edit 和图片结构化 MCP adapter。第 6 项“真实发布级样本”明确排除，最后另议。

## 1. Git 与 worktree 真实状态

### 1.1 分支关系

| Ref | HEAD | 相对关系 | 结论 |
|---|---|---|---|
| `codex/runtime-registry-split` | `9d1872f` | 比 `main` 多 46 commits | 当前事实源；本轮审计修改未提交 |
| `codex/organize-parametric-worktree` | `8aa7fb6` | 与当前分支 merge-base 为 `02c40a8`；当前独有 4 commits，参数化分支独有 6 commits | 仅最后的 `8aa7fb6` 是当前分支明确缺少的完整参数化 continuation |
| `main` | `42be030` | 是当前分支祖先 | 尚未接收 46 个主线提交；不能直接作为发布 branch |

`git cherry` 把两边提交都视为不等价，但 file/blob 对照显示：

- `54c6dd9` 路径可移植性已由当前 `3e4f6ea` / `be0912b` 吸收并继续演进；
- `2bfbc46` 的最小 ParametricRecipe slice 已进入当前 `3e4f6ea`，核心 schema/compiler/fixture blob 与参数化分支 continuation 的父提交一致；
- `30e44ba` 主线 runtime/expression 能力已进入当前 `3e4f6ea`；
- `db2e595` image-structured calibration 已被当前 `be0912b`、`9e2def5`、`9d1872f` 继续演进；
- `f07e046` 文档口径已被当前文档覆盖；
- `8aa7fb6` 新增 patch/apply/DSL continuation、runner、fixture 和 gating tests，当前没有等价实现。

因此不建议 merge 整个 `codex/organize-parametric-worktree`。建议在用户确认后只整合 `8aa7fb6`；审计时的三方 `merge-tree` 模拟没有产生冲突标记，`package.json` 与 `test/part-graph-compiler.mjs` 会发生双边自动合并，仍必须在真实 cherry-pick 后人工审查并跑完整门禁。

### 1.2 worktree 清单

| Worktree | 状态 | dirty/untracked | 内容归类 |
|---|---|---:|---|
| 主 checkout | `codex/runtime-registry-split@9d1872f` | 审计前 `0/0`；审计后 10 个 intentional modified + 本报告 | 当前工作区 |
| `49e8` | `codex/organize-parametric-worktree@8aa7fb6` | `0/0` | clean；完整参数化 continuation |
| `0095` | detached `02c40a8` | `40/40` | 65 路径精确等于当前、11 精确等于参数化分支、4 为中间态混合文件 |
| `1c93` | detached `02c40a8` | `34/39` | 57 路径精确等于当前、9 精确等于参数化分支、7 为较早文档/测试中间态 |
| `32db` | detached `02c40a8` | `33/39` | 57 路径精确等于当前、12 精确等于参数化分支、3 为中间态 |
| `fa6a` | detached `02c40a8` | `33/39` | 57 路径精确等于当前、12 精确等于参数化分支、3 为中间态 |

四个 detached worktree 的 `git diff --check` 都通过，但它们包含未提交用户内容。对照结果强烈表明它们是已经被当前/参数化分支吸收或被后续事实覆盖的中间快照；仍不能在没有用户确认和备份包的情况下删除。

### 1.3 生成物

- `output/`：约 2.2 GB / 8,605 files，包含旧 queue、QA、image-structured 和本轮测试输出；被 `.gitignore` 忽略。
- `.alma-snapshots/`：约 94 MB / 1,157 files；被忽略。
- `out/releases/`：本轮生成当前插件版本 RBZ：
  - `out/releases/alma-sketchup-mcp-queue-plugin-0.1.0-natural-iteration.2.rbz`
  - 64 KB
  - SHA-256 `d44cae77d54148a14b758079ab64b1e3ced2c5953254c0e9fb51b724e714f7fc`
- 已安装的 17 个 Ruby 插件源文件与当前 `sketchup_plugin/` 文件逐个 `cmp` 一致，版本字符串也是 `queue-plugin-0.1.0-natural-iteration.2`；但 SketchUp Bridge 本轮没有响应，所以这不是 live 加载证明。

本轮不删除或压缩任何生成物。发布前应另做“保留/归档/清理”决策，避免把旧 artifact 当成当前 RC 证据。

## 2. 当前能力边界

### 2.1 当前 HEAD 已具备

- 32 个 MCP 工具；`ModificationIntent v1` / `iterate_model` 是可审计、fail-closed 编排层，不是自主语义智能体。
- 91-op safe JSON DSL registry / 56 component-definition-scoped operations；不是完整 API。
- restricted Python SDK facade P0-P2、内部 facade coverage R2 / expression R3 slices；R2/R3 是仓库内部里程碑名，不是 SketchUp 官方 API 版本。
- 静态 ParametricRecipe contract：schema、Switch recipe、FeatureMappingPlan fixture、编译器、依赖顺序和 first-output 声明门禁。
- `adopt_open_model(recursive=true)` 可以索引 nested entities，但所有 nested entries 明确是 `editable:false` / `nested_read_only`；当前编辑目标仍以 top-level group/component instance 为主。
- `projects/image-structured-modeler` 有完整的独立 artifact/review/test 管线，但没有进入正式 `src/mcp-server.mjs` tools/list。

### 2.2 只在参数化 worktree 具备

`8aa7fb6` 把链路推进到：

`ParametricRecipe -> FeatureMappingPlan -> PartGraphCorrectionPatch -> applied/reviewed PartGraph -> safe JSON DSL`

本轮 targeted runner 新鲜生成并验证：

- `feature-mapping-plan.json`
- `parametric-recipe-compile-report.json`
- `part-graph-correction-patch.json`
- `part-graph.applied.json`
- `safe-json-dsl.json`

输出目录为 `49e8/.../output/parametric-recipes/switch-thumbstick-variants/baseline/`。baseline 为 4 patch edits / 2 skipped no-op bindings；fanout candidate 必须先消费 passing first-output report。它仍是安全制品链和 mock 证明，不是开放脚本执行，也没有在本轮 live queue 执行。

## 3. 本轮事实口径与兼容修正

已修正但未提交：

1. README 官方 Connector v1 工具名从旧 `build_model` 改为当前公开的 `get_docs` / `evaluate_py` / `save_model`；本地 `build_model` 保留为 safe JSON DSL 工具。
2. `sketchup_sdk_py.txt` 增加 legacy snapshot 标签，避免把旧 `build_model` 文本当作当前公开 contract。
3. 28/32 工具断言分层：28 是 2026-07-02 的历史节点，当前实测为 32。
4. facade R2/R3 改成“仓库内部里程碑”口径；旧 fixture/script/output 名保留为兼容标识。
5. restricted Python facade 的 `result` 改为可选：未定义时省略，`None` 时返回 `null`，非 JSON-compatible 值仍 fail closed；编译器和 `evaluate_py` 都有回归。

保留但必须在发布稿中继续注明：

- 历史日志中的旧 operation/tool/plugin 数字是当时节点，不是当前基线；
- `official-api` 文件/脚本名是内部兼容命名；
- 91 operations 不等于完整 SketchUp API；
- `plugin:check` 不等于 live queue；
- 旧 live artifacts 不能替代本轮 fresh handshake。

## 4. 新鲜验证证据

| Gate | 当前 checkout | 参数化 worktree | 证据/备注 |
|---|---:|---:|---|
| `git diff --check` | pass | pass | 当前 intentional diff 无 whitespace error |
| `npm test` | pass | pass | 91 manifest/mock/Ruby ops；56 component scope；optional-result 回归通过 |
| `npm run test:image-structured` | pass | pass | 当前分支 tier0=8 / tier1=5 / false promotion=0；参数化旧分支 tier0=7 / tier1=3 |
| `npm run plugin:check` | pass | pass | version `queue-plugin-0.1.0-natural-iteration.2`；仅静态检查 |
| `npm run qa:official-api-r3:mock` | pass | 未单独补跑 | 12 ops / 5 groups / 16 faces / warnings 0 |
| Parametric first-output runner | 当前不存在 | pass | 五类制品全部生成；mock PartGraph test 通过 |
| fresh queue handshake | timeout | 未运行 | 当前 queue 为空、无锁、2 个陈旧 response；10 秒未收到插件响应 |

发布判定：**offline green / live unverified / branch convergence pending**，还不能标记为 release candidate。

## 5. 需要用户确认的整合动作

### 决策 A：参数化 continuation

建议动作：只把 `8aa7fb6` cherry-pick 到 `codex/runtime-registry-split`，不 merge 整个参数化分支。该动作会改变分支历史，必须由用户明确确认后执行。整合后必须重新生成五类制品并跑两套完整门禁。

### 决策 B：当前分支如何进入 `main`

`main` 落后 46 commits 且无 remote/upstream。需要用户决定 `codex/runtime-registry-split` 是作为 release branch 继续，还是在 gates 通过后 fast-forward/merge 到 `main`。本轮不移动 `main`。

### 决策 C：四个 dirty detached worktree

建议先为每个 worktree 导出 tracked binary patch、untracked file manifest 和归档包，再执行 `git worktree remove --force`。这会删除工作目录，必须由用户明确确认；本轮全部保留。

### 决策 D：本轮审计修正如何落库

当前有 10 个 modified files 加本报告，未 staged/未 commit。用户需决定是作为独立“fact contract + optional result compatibility”切片提交，还是继续保持工作区修改。本轮不自行提交。

## 6. 两周发布关键路径

### Release-critical

| 里程碑 | 时间 | 可验证切片 | 验收标准 | 测试/制品证据 | 依赖与风险 |
|---|---:|---|---|---|---|
| M0 仓库收敛 | D1-D2 | 确认并整合 `8aa7fb6`；决定 release branch；四个 dirty worktree 只归档不直接删除 | 一个 clean release branch；完整参数化链在同一 HEAD；mainline/subproject commit 边界清楚 | branch graph、integration report、五类 ParametricRecipe artifacts、全量四 gate | 依赖用户确认；全分支 merge 会带回旧 subproject coverage，禁止使用 |
| M1 事实合同 + 官方源码兼容集 | D2-D4 | 把当前文档口径和 optional result 修复落库；新增 12-15 个高频 Cloud Python SDK source fixtures，原样输入 facade | 每个 fixture 要么稳定编译到 expected DSL/result，要么以明确 unsupported reason fail closed；无 `result`、`None`、JSON result 全覆盖 | `source-compat-report.json`、expected DSL fixtures、`test/python-sdk-source-compat.mjs`、32-tool assertion | 官方公开文档不等于完整 SDK；不能把 legacy snapshot 当最新 contract |
| M2 高频原生 API 第一刀 | D4-D6 | 由 M1 失败频率选最多 3 个 API；默认候选是 entity collection edit（erase/transform）、`Page#update(flags)`、`Face#get_UVHelper` 只读/映射第一刀 | 每个 API 有 facade compile、mock effect、queue effect/structured limitation；registry/schema/Ruby dispatch 同步 | API coverage report、targeted fixture、mock snapshot、fresh queue snapshot/SKP | `EntitiesBuilder` / arbitrary `intersect_with` 风险高，除非 corpus 证明发布必需，否则后移 |
| M3 nested entity 可编辑第一刀 | D6-D9 | 从 read-only recursive index 推进到 stable entity path；只支持 component-definition 内 group/component-instance 的受控 rename/material/visibility/transform | definition-wide edit 明确报告受影响 instances；per-instance edit 必须先 make-unique 或拒绝；Face/Edge arbitrary edit 继续 fail closed | nested-edit fixture、before/after recursive index、snapshot diff、mock/queue SKP、ambiguity negative tests | shared definition 传播和 instance path 稳定性是最大风险；不在首刀开放任意子实体几何修改 |
| M4 图片结构化正式 MCP adapter | D8-D10 | 保持子项目独立，只在 mainline 增加 artifact adapter；建议 `prepare_image_modeling_brief` + `compile_reviewed_part_graph`，默认 preview-only | 只消费 schema-valid Observation/MCP brief/reviewed PartGraph；缺 review 或 promotion gate 未通过时不产出可执行 DSL；不自动调用 queue | MCP tools/list/call tests、artifact manifest、review-gate negative fixture、FeatureMappingPlan/DSL preview | 不能把子项目技术基线写成照片级自动重建；避免 shell/open script execution |
| M5 RC 与 fresh live gate | D11-D14 | version truth、安装、串行 queue 回归、RBZ 打包、checksum、release notes | fresh `get_capabilities` compatibility ok；queue QA、budget、expert、facade、nested edit、image adapter smoke 全通过；关键 `.skp` 保存 | release manifest、queue reports、SKP artifacts、RBZ + SHA-256、docs/status diff | 必须有正在运行且加载新插件的 SketchUp；当前 timeout 状态不能签发 RC |

止损规则：M2-M4 任一 slice 在 D10 前没有稳定 mock + targeted tests，则不进入 RC，只保留为 launch-adjacent；M5 的 fresh queue handshake 是硬门禁。

## 7. Launch-adjacent

1. 把 M1 source corpus 扩到更多官方式类/集合与真实生成片段，并按 unsupported reason 统计覆盖率。
2. 扩大 nested edit 到受控 Face/Edge 属性、材质和局部 feature 操作；保持 persistent/entity path 和 confirmation gate。
3. 扩大 high-value API 到 UVHelper 完整读写、scene flags、collection query；仍从频率和用户任务价值排序。
4. 图片结构化 adapter 增加 source-package intake、人工 review artifact 上传/续跑和正式 MCP artifact lifecycle；promotion 继续 fail closed。

## 8. Post-launch

1. `EntitiesBuilder`、通用 `intersect_with`、`transform_by_vectors`、复杂曲面修复和完整 CAD kernel 面。
2. 任意 nested Face/Edge 几何编辑、深层 instance-path mutation 和大规模 shared-definition migration。
3. 完整 Cloud Python runtime、OAuth/hosted session/download、多租户能力；这些不应伪装成 facade coverage。
4. 更深的图片自动理解/多图融合/自动 promotion。

明确排除：此前第 6 项“真实发布级样本”不在本两周计划、launch-adjacent 或 post-launch 的实施承诺中，按用户要求最后单独讨论。
