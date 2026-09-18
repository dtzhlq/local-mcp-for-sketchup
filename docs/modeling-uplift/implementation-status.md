# 通用建模升级交付状态

状态：本地开发候选。版本 0.3.0；尚未发布，也不宣称完成全部平台或全部工具分支的发布验收。

基线：v0.2.0 / 1d27e9c8c4ab34e8b7cdc1ae24d83f4530a855d3。
分支：codex/modeling-api-uplift。
独立工作树：/Users/07zhang/.codex/worktrees/modeling-api-uplift/sketchup-mcp-replica。
原 OneDrive 工作树的已有未提交内容保留。

## 已交付

- 48 个工具；新增真实几何查询、测量、局部编辑、最多三阶段的建模程序入口。
- 矩阵、SDK 旋转中心/坐标轴/逆矩阵、通用单环扫掠、不同点数及凹轮廓放样。
- 共用既有 Session Contract、编辑审查、原子事务和执行回执。共享实例沿路径隔离，程序按实际回执重新定位。
- 独立工具注册表，公开 schema、运行时参数校验、结构化输出验证与 annotations；Legacy 和 Modern 共用处理器。
- 三个程序请求示例、使用说明、48 工具验证表、机器可读验收报告。
- macOS arm64 自带 Node 24.18.0 的服务包、RBZ 插件包、单个组合验收 SKP、三个原生视图。

## 验收证据

| 场景 | 结果 |
|---|---|
| 非圆截面三维扫掠、沿程缩放/扭转、闭合扫掠 | 原生网格与封闭性、固定视图通过 |
| 不同点数截面和凹轮廓端盖 | 原生封闭；凹轮廓解析体积 336,000 mm³ 一致 |
| 旋转嵌套共享组件 | 目标顶部 +20 mm，体积 240,000 mm³；对照顶点不变，体积 192,000 mm³ |
| 三阶段程序 | 循环生成 → 分割面 → 读取真实新面并推拉 60 mm；未选面片保持不变 |
| 生成物继续编辑 | 放样顶部 +10 mm 后仍封闭；同幂等键重取回执未再次修改 |
| 失败处理 | 修改后受控失败完整回滚，旧引用拒绝；未知执行状态不重放有离线证据 |
| 完整矩阵 | 镜像与非均匀缩放的世界坐标和解析体积 18,000 mm³ 一致 |
| 保存、关闭、重开 | 新文档身份，16 个上下文可重新定位，拓扑/坐标在 1e-7 容差内一致，模型版本一致 |
| 候选服务包 | 解包后 119 个源码文件逐字节一致，48 工具可加载，随包 Node 实际完成原生只读查询 |

四组核心离线检查和受影响的旧 MCP、Expert、版本合同检查通过。没有重跑无关发布矩阵。各检查的范围、已知未验证项见 acceptance-report.json；工具数量不代表原生验收覆盖率。

## 安装与运行

本机候选 Ruby 插件已安装，并通过完整重启激活。旧发布版扩展 loader 因覆盖候选实现而移至 `output/modeling-uplift/plugin-backup/local_mcp_for_sketchup.rb`；同目录 restore.json 记录恢复位置。旧扩展目录没有删除。不要同时启用两个 Bridge loader。

最终交付目录：`out/modeling-uplift/`。

- 插件：`alma-sketchup-mcp-0.3.0-nonrelease-uplift-20260918.rbz`。
- 服务：`nonrelease-uplift-candidate-20260918-local-mcp-for-sketchup-0.3.0-darwin-arm64.tar.gz`。
- 同目录早期 nonrelease 包仅是中间检查产物，以带 `uplift-candidate` 的服务包为准。

解压服务包后，MCP stdio 的 command 指向 `local-mcp-for-sketchup/node/bin/node`，args 指向 `local-mcp-for-sketchup/app/src/mcp-server.mjs`，使用绝对路径。可直接运行，不依赖系统 Python。RBZ 可由 SketchUp 扩展程序管理器安装；更新后完整退出并重启 SketchUp，再启动 Bridge。候选包未作官方签名，不修改客户端审批策略。

本机解包验证入口位于 `out/modeling-uplift/verify-candidate/local-mcp-for-sketchup/`。当前用户已有客户端配置未自动改写；测试使用独立服务实例及专用 SKP。

验收模型：`output/modeling-uplift/native/modeling-uplift.skp`。
图片：同目录 overview.png、top.png、front.png。overview 为完整场景；front 是辅助近景，不能独立证明整个场景边界。

## 限制与后续

- 跨模型收益未实测；Windows 原生验收未运行。
- mock 局部拓扑操作是部分实现，原生分面/推拉需 queue。
- 新编辑入口要求组或组件上下文；模型根级散线散面可读取，尚不直接通过新工具编辑。
- 单个超大上下文没有顶点分页；超预算时返回不完整状态，需缩小范围或提高预算。
- 旧工具输出合同允许保留扩展字段，没有逐项枚举所有可选嵌套结果。有效材质赋值、边属性等编辑分支没有分别做原生样例验收。
- 未人为丢弃原生响应；不重放未知状态由离线检查覆盖，已提交回执的重取由原生检查覆盖。
- 任意曲面倒角、NURBS、带孔/分支放样、通用约束求解和图像完整参数恢复仍在后续清单。

本轮证据支持：以前难以表达的扫掠/放样可生成；已有旋转嵌套模型可准确局部修改；四个新工具提供了明确参数和可恢复流程。普通模型的实际任务成功率是否提高，需要后续跨模型抽测。

实际工具调用、输入缓存/输出 token 及统计口径记录于验收报告 usage 字段；它是交付前的遥测快照，不是账单金额。验证触发的主要修正项共 8 类，详见报告。
