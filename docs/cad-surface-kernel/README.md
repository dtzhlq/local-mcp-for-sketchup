# NURBS 与曲面圆角开发候选

分支 `codex/cad-surface-kernel`，基于上一轮 `d895706`。这是本地开发候选，尚非正式发布。最终验证状态以 acceptance-report.json 为准。

## 已实现的调用能力

- `cad_shape` 创建精确 CAD 参数描述的曲面/实体，再生成 SketchUp 面片。支持有理 NURBS 控制点、正权重、节点及多重度，矩形非周期夹持曲面，次数 1–8，控制网格每方向 2–32 点。
- 多块 NURBS 曲面缝合为壳；闭合壳可构成实体。支持盒体、圆柱，以及 CAD 并集、差集、交集。
- 对 CAD 实体或壳的真实边执行等半径圆角，允许指定边。失败或无效拓扑在修改 SketchUp 前被拒绝。
- `query_model_geometry` 返回参数源、是否仍匹配当前几何、CAD 边清单；原生面含 `cad_face`，对应计算输出的曲面分区。概要保持紧凑，完整信息通过冻结快照/资源读取。
- `edit_model_geometry` 增加 `replace_cad` 类型。在一个对象上下文中修改参数并重建，保留对象变换、复用实例隔离和原有审查/事务。只允许单独一项且为 local 坐标。
- `run_model_program` 和 Python `model.cad_shape(options)` 使用同一入口。顶层 MCP 工具保持 48 个。

## 使用顺序

1. 通过创建入口提交 `{op:"cad_shape",name,recipe}`。recipe 含 `version:1`、顺序 nodes 和 output 节点 id。
2. 查询真实对象，读取 snapshot_handle、entity_path、context.cad。CAD 边清单属于该精确输入，不是 SketchUp 三角网格边的序号。
3. 从参数源构造新 recipe；用 `{op:"replace_cad",recipe}` 提交局部编辑。使用当前快照和稳定幂等键。
4. 根据任务 next_action 完成必要审查，读取实际结果。未知提交结果不可重新创建。

节点：

| kind | 参数 |
|---|---|
| box | min、max，三维对角点 |
| cylinder | radius、height，可选 origin、axis |
| nurbs_surface | poles[u][v][xyz]、可选 weights[u][v]、u/v_degree、u/v_knots、u/v_multiplicities |
| sew | inputs：前序曲面/壳 id；solid：是否构成闭合实体 |
| fuse / cut / intersect | input、other：前序节点 id |
| fillet | input、radius；可选 edges：该输入的 CAD 边清单索引 |

新对象可用 transform 放置。更新仍在对象本地坐标计算，保留已有实例变换。上游拓扑变动后，须重新计算输入边清单再选边，不能猜测旧索引仍代表同一特征。

示例在 `examples/cad-kernel/`：

- `nurbs.json`：有理二次四分之一圆柱曲面。
- `curved-fillet.json`：相交圆柱的真实弯曲交界线圆角。
- `nurbs-solid.json`：六块 NURBS 曲面组成闭合实体。
- `nurbs-solid-fillet.json`：上述实体的两条弯曲屋面边圆角。
- `nurbs-solid-rejected-fillet.json`：四边连同角点一起倒角的已知失败案例，应该被拒绝。

## 数据、精度与预算

参数源保存在 SKP 对象属性中，不依赖模型会话内存。实体/网格匹配指纹记录几何、面朝向、面材质和边属性。手工修改使 `cad.current=false`，禁止用旧参数直接覆盖。指纹 v2 对法线采用 9 位小数并统一零值，避免保存重开后的浮点末位差异误报；真实几何变化仍会被检测。

内核是独立进程中的 OpenCascade WebAssembly，无 Python 或云端计算依赖。只接受数据描述，不接受任意脚本。单配方最多 24 节点、计算超时 30 秒；最多 50,000 顶点和面，另有网格复杂度检查。进程超时不是任意输入下的内存占用保证。

默认网格 tolerance 为 0.2 mm，angular_tolerance 为 0.35 rad。这是内核离散参数，不是经过独立证明的全局误差上限。原生测量针对实际 SketchUp 面片及世界变换；`cad.evidence.volume_mm3` 是参数实体在**本地坐标**下的 CAD 体积。

## 本轮原生证据

macOS Apple Silicon + SketchUp 2026，一个专用 SKP：

- 三阶段连续完成：创建、NURBS 高度 50→60 mm、相交圆柱圆角半径 3→4 mm。
- NURBS 圆柱曲面采样点满足解析半径 30 mm。
- 相交圆柱圆角后仍为原生闭合实体；面片体积与 CAD 体积相差约 0.268%。
- 六块 NURBS 曲面拼接实体的两条曲边圆角成功；体积差约 0.127%，其他对象未变。
- 不可行半径在执行前拒绝；手工移动顶点后拒绝旧参数重建。
- 初次重开发现法线末位导致指纹误报，已修复并通过离线回归；修复后的原生重开状态见报告，不能用离线检查代替。

## 已知边界

没有把任意历史面片自动拟合成 NURBS；没有开放任意修剪域、周期控制网格、STEP 导入导出或变半径圆角。不能保证每个半径及多边交汇角点都成功，已知四边角点失败样本保留。源参数失效时不会自动恢复或丢弃用户手工修改。Windows 及其他模型抽测未运行。

新曲面操作已经接入；“任意曲面均可倒角”仍不成立。后续优先补多边交汇的角点处理、裁剪曲面与旧模型曲面重建。

## 安装

最终包位于 `out/cad-surface-kernel/`，以 acceptance-report.json 指定的服务包/RBZ 配对为准。首次中间包缺少 CAD 依赖或使用旧指纹，不要用于部署。SketchUp 需要加载本轮 RBZ；服务包需要同时更新。当前客户端配置未改写。

许可证与内核来源见 THIRD_PARTY_NOTICES.md；本轮只交付本地开发候选，没有执行正式发布或公开分发。
