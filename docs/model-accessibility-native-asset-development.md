# 原生资产主机开发验证

`scripts/model-accessibility/native-asset-development.mjs` 是主机诊断入口，不是给测试模型的教程或正式验收运行。固定任务是从服务端目录加载 `local-chair` 的完整 SKP 根，保持原尺寸，世界毫米坐标 `[1000,1200,0]`，绕 Z 轴旋转 30°。

三个命令使用同一组绝对路径参数：

```text
node scripts/model-accessibility/native-asset-development.mjs prepare --catalog ABS_CATALOG --state-dir ABS_TASK_STATE --output-dir ABS_EVIDENCE
node scripts/model-accessibility/native-asset-development.mjs status  --catalog ABS_CATALOG --state-dir ABS_TASK_STATE --output-dir ABS_EVIDENCE
node scripts/model-accessibility/native-asset-development.mjs apply   --catalog ABS_CATALOG --state-dir ABS_TASK_STATE --output-dir ABS_EVIDENCE
```

`prepare` 要求已经打开真正空白的原生模型；只读原生资源计数必须完整，所有根、散边面及定义内存储几何都为空。脚本不创建、清空或关闭模型。它通过现有 Gateway 生成真实 S3 受审计划，保存 `prepared.json`、计划摘要和审批链接。保存唯一版本副本及执行后截图也是该计划的一部分。

审批目录默认复用 `~/.sketchup-mcp-replica/agent-contract-v1/approvals`，主机地址默认 `http://127.0.0.1:3978`。可以传 `--approval-state-dir` 与 `--approval-host-url` 对齐已经配置的审批主机。独立任务状态目录不会创建新的审批身份。脚本不会启动审批主机、初始化身份、读取口令或发行批准。审批主机未运行时，由主任务启动真实主机，并让用户在具体挑战页面完成审阅。

`status` 只读已持久化任务及审批决定，不调用 SketchUp，也不执行 `resume_agent_task`。`apply` 在真实批准缺失时返回 `ready_to_apply:false`，不会发起原生连接；批准已存在时重新建立 Gateway 连接，再提交一次受审执行。执行开始后不论成功、失败或响应不明，重复命令都不会再次提交。

证据包括执行前后原生快照、完整递归回读、原生实例矩阵、测得的世界包围盒、源文件前后 SHA、保存文件的字节数与 SHA，以及现有受审执行生成的截图和文件工件。矩阵平移按 SketchUp 原生英寸读取，与目标毫米值换算比较。旋转后的包围盒不能冒充资产局部尺寸测量。此运行只提供主机开发证据；不证明模型自主完成任务、正式验收、视觉质量或关闭重开。

离线测试：`node test/model-accessibility-native-asset-development.mjs`。测试使用显式假队列和合成文件，不调用原生模型、不发行批准。
