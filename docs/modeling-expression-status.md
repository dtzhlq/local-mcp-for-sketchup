# 建模表达能力现状与官方差距

更新时间：2026-07-14

## 官方基线

当前公开官方口径仍是 SketchUp Connector v1：从对话生成新的 `.skp`，主要工具为 `get_docs`、`evaluate_py`、`save_model`。`evaluate_py` 在 live model 上执行 Python code，并在成功后生成 snapshot；`save_model` 返回 `.skp` URL。官方帮助页还说明 Claude 建模使用 inches，完成后提供静态 thumbnail 和下载链接。参考来源：[SketchUp Connector for Claude](https://help.sketchup.com/en/sketchup-claude-connector)、[Trimble newsroom 2026-04-28](https://news.trimble.com/2026-04-28-Trimble-Links-SketchUp-with-Anthropics-Claude%2C-Bringing-New-Conversational-AI-powered-Capabilities-to-3D-Modeling)。

本文中的 “facade coverage R2” / “facade expression R3” 是本仓库 restricted Python facade 的内部里程碑名，不是 SketchUp 官方 API 版本，也不表示完整覆盖。现有 `qa:official-api-r3:*` 脚本名为兼容保留的内部标识。

## 当前本地表达能力

| 层级 | 当前能力 | 证据入口 |
|---|---|---|
| MCP 工具闭环 | 当前 `src/mcp-server.mjs` `tools/list` 为 34 个工具，新增两个 review-gated image artifact adapter；工具数不等同于 91 个 safe DSL operation | `src/mcp-server.mjs`、`src/bridge.mjs`、`src/image-structured-mcp-adapter.mjs`、`test/mcp-server.mjs`、`test/image-structured-mcp-adapter.mjs` |
| ModificationIntent v1 | `plan_modification_intent` 把 selection、target resolution 和几何事实转成可审计 intent，记录 evidence refs、confidence、`requires_confirmation`、`safe_to_execute`、limitations 和可选 JSON DSL patch；`iterate_model` 可消费 `intent` / `intent_file`，仅在安全门控满足时执行 | `src/modification-intent.mjs`、`src/iteration.mjs`、`src/mcp-server.mjs` |
| 安全 JSON DSL | 91 个 operation，56 个 component_definition scope；覆盖 primitive/profile/surface/product/architecture/component/view/appearance/object/boolean/file-inspection 主要子集 | `src/capabilities.mjs`、`test/operation-contract.mjs` |
| Python SDK facade P0-P0.5 | `model`、点/向量/颜色/变换、材质、GeometryInput/LoopInput、Face/Loop/Edge 返回对象、Curve/ArcCurve、Group、ComponentDefinition/Instance、Camera/Scene/Style/Shadow/RenderingOptions、Layer/Texture/Image/ImageRep | `src/python-sdk-compiler.mjs`、`examples/python-sdk-*-fixture.py` |
| Python SDK facade P1 | 受限 `def` / `return`、局部 scope、位置/关键字/默认参数，用 helper function 复用建模片段 | `examples/python-sdk-helper-functions-fixture.py` |
| Python SDK facade P2 | list/dict comprehension、tuple/list destructuring、dict `keys/values/items/get/update`、`list/tuple/dict/enumerate/zip/sorted/sum/reversed/all/any`、dict/string/list iterable、负索引和简单 slice | `examples/python-sdk-comprehension-fixture.py` |
| Restricted facade coverage R2（仓库内部） | `model.entities/materials/layers/definitions/pages/selection/active_view`、`Entities.add_face/add_group/add_instance/add_3d_text`、object `set_attribute/layer=/material=/transform_by`、Rendering/Shadow key-value、`Face.pushpull` 默认真实几何 | `docs/sketchup-ruby-api-coverage-matrix.md`、`examples/python-sdk-official-api-coverage-fixture.py` |
| Restricted facade expression R3（仓库内部） | `Face.followme`、`Face.mesh`、`Entities.add_faces_from_mesh/fill_from_mesh`、`Face.position_material`、runtime `Selection`、Page transition/layer/object visibility/rendering/shadow fields | `examples/python-sdk-official-api-expression-r3-fixture.py`、`test/python-sdk-compiler.mjs` |
| Bridge-expanded intent layer | `material_preset`、`kitchen_component`、`fixture_embed`、`presentation_camera` 在 bridge 中展开为稳定 registry ops；`build_report` 同时保存原始 DSL、展开 DSL、限制报告和 QA accepted warnings | `src/dsl-expansion.mjs`、`src/limitations-report.mjs`、`examples/interior-expression-suite.json`、`test/mock-validation.mjs` |
| runtime | mock runtime 离线 QA；queue runtime 通过 SketchUp Ruby plugin 生成真实本地 `.skp` | `src/mock-runtime.mjs`、`src/queue-runtime.mjs`、`sketchup_plugin/` |
| QA/证据 | snapshot、warning_summary、geometry_input metadata、mock-vs-queue 对照、artifact report、layout/reference QA | `src/snapshot.mjs`、`src/snapshot-diff.mjs`、`src/model-qa.mjs` |

## 当前验证证据

- `node test/python-sdk-compiler.mjs`：覆盖 P0-P2 facade fixtures、Official API coverage R2 fixture 和 Official API expression R3 fixture；当前 `official_api_operations=18`、`official_api_r3_operations=12`。
- `npm test`：覆盖 mock validation、operation contract、Expert compiler、Python SDK compiler、MCP server、queue lock 和 registry check。
- `npm run plugin:check`：registry 与插件包检查通过。
- `npm run qa:official-api-r3:mock`：保存 `output/python-sdk-official-api-expression-r3-mock.json`，并断言 12 ops / 5 groups / >=16 faces / warnings 0 / selection / scene advanced fields / followme / positioned texture / fill mesh。
- `npm run qa:official-api-r3:queue`：保存 `output/python-sdk-official-api-expression-r3-queue.json` 和 `output/python-sdk-official-api-expression-r3.skp`；queue snapshot 为 12 ops / 5 groups / 10 faces / 29 edges / 25 vertices / selection 1 / scene 1 / warnings 0。
- `src/mcp-server.mjs` 文档核对：当前 `tools/list` 为 34 个工具；其中 `plan_modification_intent` / `iterate_model` 属于可审计门控编排层，不代表自动语义建模智能体；两个图片 adapter 只做受审制品校验和 DSL preview，不自动执行。
- `iterate_model` mock smoke：在 active session 上记录 before/after snapshot、change summary、snapshot diff、QA、manifest 和 versioned model artifact；MCP 回归覆盖增量 patch 后 group 计数变化和 artifact 落盘。
- `ModificationIntent v1` live queue smoke：Face+Edge selection 生成 preview/blocked intent，不自动执行；top-level group 安全 `set_attribute` intent 可通过 `iterate_model --intent-file` 执行，并写出 before/after、modification-intent、intent-patch、intent-manifest、snapshot-diff 和 `.skp` artifact。
- `node src/cli.mjs evaluate_py --code-file examples/python-sdk-comprehension-fixture.py --input-format python_sdk --runtime mock`：mock snapshot 为 3 groups / 3 faces / warnings 0。
- live queue `evaluate_py input_format=python_sdk`：`output/python-sdk-comprehension-queue.json` 为 3 groups / 3 faces / 12 edges / warnings 0，SketchUp plugin compatibility `ok`。
- live queue Official API coverage R2：`output/python-sdk-official-api-coverage-queue.json` 为 18 operations / 2 groups / 1 instance / 18 faces / 36 edges / 24 vertices / warnings 0；`Face.pushpull` 在 queue 中生成真实 bbox 高度。
- mock Official API expression R3：`examples/python-sdk-official-api-expression-r3-fixture.py` 为 12 operations / 5 groups / 16 faces / warnings 0；snapshot 证明 `followme_realized`、`face_uvs.mapping`、runtime `selection` 和 scene `transition_time/layer_visibility/drawingelement_visibility/rendering_options/shadow`。
- live queue Official API expression R3：`output/python-sdk-official-api-expression-r3-queue.json` 为 12 operations / 5 groups / 10 faces / 29 edges / 25 vertices / selection 1 / scene 1 / warnings 0，保存 `output/python-sdk-official-api-expression-r3.skp`；queue 复验证明 followme bbox、position_material mapping、runtime selection 和 Page advanced fields。
- bridge-expanded interior expression suite：`node src/cli.mjs build_report --code-file examples/interior-expression-suite.json --model-spec-file examples/model-qa/interior-expression-suite.json --output-dir output/interior-expression-suite/mock --runtime mock --no-save-model` 输出 21 source ops -> 152 expanded ops；snapshot 为 58 groups / 67 instances / 3073 faces / 6924 edges；raw bbox warnings 4，`model_qa` pass / issues 0 / accepted_warning_count 4，并写出 `expanded.dsl.json` 与 `limitations.md`。

## 仍然明确落后官方的部分

- **云端 Connector 形态**：没有官方 OAuth / DCR / Bearer token / refresh token / hosted MCP endpoint / 云端 session / 下载 URL；我们是本地 Node bridge + stdio MCP + file queue。
- **完整 Python 执行环境**：不执行 Python bytecode，不支持 import、stdlib/numpy、文件/网络、异常处理、decorator、nested closure、varargs/kwargs、reflection、`dir()`、`globals()`、直接 SketchUp API 调用。
- **完整官方 SDK 类行为**：当前 facade 仍是现有 DSL 的安全对象包装；集合 erase/transform、`Page.update(flags)` 透传和同脚本 positioned Face 的只读 UVQ 查询已有第一刀，但动态 active-model UVHelper、EntitiesBuilder、intersect/query API、Page flags 的完整宿主语义、section plane、observer/UI/runtime reflection 仍未覆盖。
- **完整 SketchUp API 面**：Layer/Tag 管理、Scenes/Pages、Style/Rendering key 枚举、材质/贴图/UV/嵌入图像、attribute/classification 版本差异已有更多 facade 第一刀，但还不是完整 API。
- **通用 CAD kernel**：已有 boolean/manifold 第一版，但复杂曲面、任意边 fillet/chamfer、文字 solid union/subtraction、复杂 sweep frame、自动拓扑修复仍不完整。
- **官方云端迭代体验**：官方在同一 chat 中跟踪版本并提供下载；本地新增 `iterate_model` 记录 active session 的 before/after/diff/QA/version artifact，但仍不是官方云端版本链或下载 URL。
- **自动语义建模智能体**：本地 `ModificationIntent v1` 只是可审计意图层和执行门控，不会自行越过 `requires_confirmation` / `safe_to_execute` 边界，也不应表述为自动规划并完成任意语义改模。
- **图片到结构化模型**：仍属于 `projects/image-structured-modeler` 上游子项目；不计入主线 MCP 表达力完成度。

## 当前判断

不考虑图像结构化子项目，主线已经接近官方 v1 的工具闭环和常用建模表达体验：工具形状、snapshot、保存、文件 lifecycle、真实 SketchUp queue、91-op JSON DSL、受限 Python SDK facade P0-P2 都已覆盖。

差距的核心不再是“能不能生成模型”，而是三件事：

1. 官方是云端 Python SDK runtime；我们是本地安全 DSL + AST facade。
2. 官方能让 Claude 写更自由的 Python；我们只允许可验证、可限制的结构化 Python 子集。
3. 官方 SDK/SketchUp API 面理论上更大；我们正在覆盖可回归的高频建模对象子集，R3 已把 followme、mesh/fill、position_material、runtime selection 和 Page 高级字段拉近一截；bridge-expanded intent layer 已把室内/厨房这类高阶表达组合能力拉近一截，但仍是展开到安全 DSL，不是完整官方 Python runtime。
