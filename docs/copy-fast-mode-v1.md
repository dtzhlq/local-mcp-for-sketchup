# 副本快速模式 v1

副本快速模式（Copy Fast Mode）用于一个很简单的场景：用户把可丢弃的 SketchUp 副本放进专用目录，服务器确认当前模型位于该目录后，Agent 可以连续修改，不再要求用户逐次打开审批页。

它省掉的是“每次修改都点批准”，不是取消全部保护。目标不明确时，Agent 仍应只用普通语言询问“要改哪一个”；模型切换、版本过期、预算越界、目录越界或重复请求仍由服务器拦截。

## 一次性配置

请新建一个只放副本的目录，不要把原始模型目录加入白名单。启动 MCP 服务前配置：

```bash
export ALMA_SKETCHUP_COPY_FAST_MODE=1
export ALMA_SKETCHUP_COPY_ROOTS="/绝对路径/SketchUp-副本"
export ALMA_SKETCHUP_COPY_FAST_ALLOWED_RISKS="S1,S2,S3,S4"
export ALMA_SKETCHUP_COPY_FAST_MAX_AFFECTED_INSTANCES=200
export ALMA_SKETCHUP_COPY_FAST_ALLOW_SAVE=0
export ALMA_SKETCHUP_COPY_FAST_SESSION_TTL_MS=28800000
```

多个目录使用当前系统的 path delimiter 分隔；macOS/Linux 是 `:`。修改环境变量后需要重启 MCP 服务。

`ALMA_SKETCHUP_COPY_FAST_ALLOW_SAVE` 默认关闭。只想让 Agent 修改当前内存模型时保持 `0`。如果副本允许生成保存版本，可显式设为 `1`；带路径的保存目标也必须位于命中的同一副本 root，且 Existing Model Editing Engine 继续使用 versioned、non-overwrite 保存合同。目录外目标会 fail closed。

旧的 `ALMA_SKETCHUP_TRUSTED_COPY_*` 变量仍兼容，但新部署建议使用上面的 `COPY_FAST_*` 名称。

## 用户实际怎么用

1. 从原文件复制一份 `.skp` 到配置好的副本目录。
2. 在 SketchUp 打开这份副本并启动插件。
3. 像平常一样告诉 Agent 要改什么。
4. 若模型和计划符合策略，任务会返回 `execution_mode=copy_fast`、`task_state=approved`、`next_action=execute_copy_edit` 和 `user_action_required=false`。Agent 可直接继续，无需用户阅读 hash、JSON 或审批挑战。
5. live queue 仍需要 fresh Session Contract。它是 Agent/服务器的只读握手，不是用户点击审批；模型、插件或服务器重启后会重新建立。

同一 MCP 服务进程、同一模型副本、同一 runtime 和同一可信 root 下的后续任务复用短期会话。默认有效期 8 小时，允许范围为 5 分钟到 24 小时。

## 仍然会停下来的情况

- 当前模型不在配置 root 内。
- Agent 只声称“这是副本”，但服务器路径没有命中配置。
- 模型 identity、runtime 或服务器进程发生变化。
- 会话过期或已撤销。
- risk、operation、受影响实例数或保存行为超出服务器策略。
- 显式保存路径越出命中的副本 root。
- 模型 revision 与计划不一致。
- 目标有歧义、对象被锁定或 operation 本身不安全/不受支持。

这些情况不会退化成 Agent 自我批准。目录外 S2-S4 保持本机真人审批；S1 也只有命中 Copy Fast 或服务器另行启用 S1 auto policy 才能无点击执行。

## 服务端保证

- Agent 的 `client_capabilities` 或输入字段不能启用 Copy Fast。
- 旧 `trusted_model_copy` 绑定不能单独授权；当前计划缺少服务器持有的 Copy Fast 会话时必须失败。
- Copy Fast 会话由服务器内存 authority 创建，绑定 policy、canonical source path/root 指纹、model key、runtime、初始 revision、签发时间和 expiry。
- 每个计划仍独立绑定 plan hash、当前 model revision、risk、allowed operations、affected-instance budget、save contract 和 idempotency claim。
- 执行前重新只读观察活动模型并复核副本范围；一次 submit 仍必须留下 durable mutation receipt。
- 服务重启不会继承旧会话。重复 idempotency key 不会造成第二次修改。
- 公开结果只包含 opaque session id 和状态，不返回本机 root、canonical path 或私有指纹。

## 当前证据边界

当前源码已有严格 session/public-summary schema、11 个 schema 负例、13 个 runtime 负例，以及 mock Gateway 闭环：S1/S4、跨任务与 revision 复用、零逐任务 challenge、幂等重放、目录外拒绝、Agent 自报无效、重启/过期/撤销失效均通过，live queue 调用为 0。

证据见 [`copy-fast-session-v1-mock-evidence.json`](evidence/copy-fast-session-v1-mock-evidence.json)。它不是新的 live SketchUp、跨版本或发布验收；历史 live 证据不会因本功能改写。

## 当前源码 live 替代验收

仓库提供一个单进程验收器，在同一 Node 进程内完成 Copy Fast session 创建、S4 reviewed plan、fresh Session Contract、一次执行、同 idempotency key 重放和事后只读核验。默认命令只检查专用副本的文件名/SHA-256/大小，以及已安装插件的 22 个受管文件是否与当前工作区逐字节一致，不进入 queue：

```bash
npm run qa:copy-fast:check
```

live 验收只允许使用以下精确副本：

```text
output/live-validation/next-models/controlled-s4-delete-2026-07-22-v1/Fire Escape.disposable.skp
```

先在 SketchUp 打开该文件，完整退出并重开 SketchUp、启动当前插件；确认活动文档仍是该副本后，再显式运行：

```bash
npm run qa:copy-fast:queue -- \
  --runtime queue \
  --queue-required \
  --ack-disposable-copy \
  --fresh-sketchup-confirmed
```

该命令会在当前内存模型中删除 `pid:9287.9289`，并清理其空父组 `pid:9287`。它固定 `save_model=false`，会核对磁盘 SHA 前后不变；完成后应关闭 SketchUp 且不要保存。写盘前会同时验证正式 JSON Schema、Copy Fast session/model revision 交叉绑定、已加载 Boolean/Model Revision source attestation 和 22-file installed/workspace manifest。当前 rc.3 runner 生成 source/version-bound `copy-fast-session-live.v2`，成功记录写入 create-new-only 的 `output/live-validation/copy-fast-session-v2/<run-id>/copy-fast-session-live-evidence.json`。

2026-07-24 已在 SketchUp `26.2.242` 完成一次 rc.2 `copy-fast-session-live.v1` 历史 capture：S4 plan 直接进入 `approved`，未创建 approval challenge；一次 submit 返回 finalized mutation receipt，target/empty parent 均不存在；同 idempotency key 重放没有第二次修改；模型 revision 改变而磁盘 SKP SHA 不变，queue 前后 `0/0/0` 且无 lock。严格公共证据见 [`copy-fast-session-v1-live-evidence-2026-07-24.json`](evidence/copy-fast-session-v1-live-evidence-2026-07-24.json)，文件保持不可变。

rc.3 发布候选必须另行采集并严格验证 v2 successor；v1 历史证据不能替代它。两类验收都只证明一个精确副本上的 Copy Fast S4 路径，不证明宽泛破坏性编辑、视觉质量、多 Agent 兼容、保存/重开或跨 SketchUp 版本，也不会单独把 `release_acceptance` 改为 `true`。

2026-07-24 的 rc.3 successor 已在 SketchUp `26.2.242` 完成：server/plugin/capability/manifest 与 13 个源码/合同 hash 精确匹配，S4 task 为 0 challenge / 1 submit，receipt finalized，同 idempotency key 重放没有重复修改，原 SKP 字节不变，queue 前后全清。公共 create-new evidence 为 [`copy-fast-session-v2-live-evidence-2026-07-24.json`](evidence/copy-fast-session-v2-live-evidence-2026-07-24.json)，SHA-256 `1357a42face31640096cdadcc462d736f8c4825a626e8cae41115e4de51b56e2`。该单项仍保持 `release_acceptance=false`；它与独立的 18/18 offline gate 组合后才进入 rc.3 manifest 的 scoped candidate signoff。
