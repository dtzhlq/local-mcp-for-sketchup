# 盲测的本地主机批准与同会话恢复

`gateway-adapter.mjs` 为每轮创建独立任务目录。实机 `queue` 的批准目录默认复用 `defaultStateDir/agent-contract-v1/approvals`，与本地批准主机默认设置一致；模型不能选择该目录或取得批准密钥。旧实现把挑战写入每轮 `root/approval`，默认端口 3978 的主机看不到这些挑战，已修正。

主机可在启动本轮前显式设置：

```sh
export MODEL_ACCESSIBILITY_STATE_ROOT='/absolute/path/to/a-new-run-state'
export MODEL_ACCESSIBILITY_RUNTIME='queue'
export MODEL_ACCESSIBILITY_APPROVAL_STATE_DIR='/absolute/path/to/the-existing-host-approvals'
export MODEL_ACCESSIBILITY_APPROVAL_HOST_URL='http://127.0.0.1:3978'
```

批准目录必须与已经配置的 `local-approval-host` 的 `approvalStateDir` 一致。自定义主机 URL 只改变挑战页面地址，不能代替目录配置。默认目录沿用 `ALMA_SKETCHUP_STATE_DIR`/系统默认路径。主机代码也可调用 `createGatewayAdapter({stateRoot,runtime,approvalStateDir,approvalHostUrl})`。`mock` 固定使用本轮 `stateRoot/approval`；试图共享其他批准目录会被拒绝。

这些设置只进入宿主适配器。给模型的工具仍只有 `start_agent_task`、`resume_agent_task`、`submit_agent_task_input`、`read_agent_artifact`。适配器不会启动批准主机、初始化身份、读取口令、提交批准决定或签发批准 token。

`agent-loop.mjs` 自动使用适配器的宿主专用 `waitForApproval`。模型创建出真正的 `awaiting_review/request_user_approval` 后：

1. 原始工具响应原样留在原会话中，写出 `approval-pause-N.json` 和事件记录；暂停后续模型请求。同一批模型调用中排在审批之后的调用不会派发。
2. 用户通过现有本地主机的具体挑战页面审阅并决定。等待器只调用 `verify_agent_task_authorization_ready`，读取并验证服务端原计划及签名决定；不调用 `resume`、连接、提交或原生操作。
3. 只有 `approved_pending_execution` 才恢复。同一个 `run_id`、完整消息历史、工具定义及累计预算继续使用；原会话收到固定的批准状态通知，没有设计参数、答案、密钥或替模型编写的执行调用。
4. 模型自己查询原任务，按实际返回重新连接并向原任务提交。参数父任务仍使用父 `task_id`；受审子任务的绑定由服务端验证。

仅 `APPROVAL_REQUIRED` 会继续等待；拒绝、过期、已消费、签名/计划异常与其他未知状态停止本轮，不重试执行。服务器策略自动批准和 Copy Fast 状态不能记作人工批准。

等待默认最多 600 秒，可在预先固定的 `limits.approval_wait_seconds` 中指定正数、上限 900 秒；原 `max_wall_seconds` 继续计入等待时间，token、调用次数和请求上限不重置。不要为已经开始的正式验收事后修改预算。必须保持 runner 进程存活；当前仅支持进程内连续等待与恢复，暂停 JSON 是证据，不能用作跨进程自动重放凭据。超时、终止或进程退出后保留原 task 和全部记录，不以新上下文宣称完成同一次盲测。

每个经核验的批准决定单独记为 `human_intervention.kind=system_unlocks`。总结提供 `observed_system_unlocks`、`approval_pause_count` 和 `approval_wait_seconds`；这些字段不证明没有其他人工干预，也不替代原生几何、外观、文件生命周期或模型能力验收。

定向测试：`node test/model-accessibility-approval-loop.mjs`。测试使用独立目录、真实批准存储读取与离线 readiness/provider fixtures；不访问 Alma、原生 SketchUp 或登录页面，不发行人工批准决定，不声称实机通过。
