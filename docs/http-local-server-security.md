# HTTP 本地服务安全与运维

`src/http-server.mjs` 是可选的本地 bridge。localhost 不是信任边界：同一台机器上的其他进程、浏览器页面和被入侵的应用都可能访问本地端口。

## 默认安全边界

- 默认显式绑定 `127.0.0.1`，不依赖 Node 的未指定 host 默认值。显式配置的 `localhost`、合法 IPv4 `127/8` 或 IPv6 loopback 也可用；伪 loopback 字符串和其他 hostname 默认拒绝。`localhost` 只是绑定位置，不是信任或授权边界。
- 只有 `GET /health` 可不授权读取，且不返回 session secret、模型内容或本地路径。
- `GET /tools` 和所有 `POST /tools/<name>` 都要求 `Authorization: Bearer <session-secret>`；本机网页或其他进程不能匿名枚举或调用工具。
- 未配置 secret 时，进程启动时生成 32-byte random secret，只在本地 stderr 显示一次。生产性使用应显式设置环境变量。
- 默认 body limit 为 1 MiB，工具 timeout 为 60s，HTTP request timeout 为 65s；request timeout 必须严格大于工具 timeout，否则服务拒绝启动。
- 路径默认只允许项目 workspace 和 `~/.sketchup-mcp-replica` state root。输入路径、输出制品路径、`source_path` 以及稳定的 queue/state/path/dir 输出键越界均 fail closed；会解析既有 symlink/realpath，并拒绝 dangling、循环或不可解析的 symlink。HTTP 指定的现有 output directory 还会在有界预算内递归拒绝任何 symlink，避免工具生成的默认子制品跟随预置链接逃逸 allowed root。
- HTTP 默认拒绝 `run_ruby_expert` 和 `evaluate_py(input_format=ruby_expert)`，即使 Bearer secret、queue policy 和 Session Contract 都有效也不放行。普通 allowed-roots 检查不是 Ruby 脚本沙箱。
- HTTP 不允许把源码编译与执行合在一次请求里：`build_expert_model`、非显式 `json_dsl` 的 `evaluate_py`，以及携带源码 patch 的非显式 `json_dsl` `iterate_model` 均在分派前拒绝。先调用无执行副作用的 `compile_expert` / `compile_python_sdk`，检查其输出，再把显式 `input_format=json_dsl` 的 JSON DSL 交给执行工具。除请求体预检外，Bridge 会在 intent/artifact 加载和 DSL macro expansion 完成后、进入 runtime 前再次检查最终 DSL 的 Texture/Image 路径；间接载入的 patch 不能绕过 allowed roots。
- HTTP 调用方不能传 `pythonCommand` 选择本机可执行程序；Python AST parser 只能由服务端环境配置。`timeoutMs`、`expertTimeoutMs` 和 `pythonTimeoutMs` 都受服务端 tool timeout 上限约束，compiler 的 operation/loop/statement/output budgets 也有固定硬上限，避免同步 parser/compiler 绕过外层 request timer 或申请无界资源。
- 抛出式 expert 错误与 `ok=false` 的 Agent Gateway result envelope 使用同一 HTTP 状态映射。Gateway 响应保留 `task_id`、非终态 `task_state` 和经白名单净化的 `next_action`，但统一替换为安全消息并移除内部 `details`；approval URL 只允许无凭据的 loopback HTTP(S)，上游任意字段、远端 URL、本地路径和 secret 不会原样转发。
- 错误返回稳定 code 和 request id，不回显内部 stack、secret、内部 details 或越界路径。

## 启动与调用

```bash
ALMA_SKETCHUP_HTTP_SESSION_SECRET='replace-with-at-least-16-bytes' npm run server
```

```bash
curl http://127.0.0.1:3977/health
curl http://127.0.0.1:3977/tools \
  -H 'authorization: Bearer replace-with-at-least-16-bytes'
curl -X POST http://127.0.0.1:3977/tools/get_capabilities \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer replace-with-at-least-16-bytes' \
  -d '{"runtime":"mock"}'
```

## 可配置项

| 环境变量 | 默认 | 说明 |
|---|---:|---|
| `ALMA_SKETCHUP_HTTP_HOST` | `127.0.0.1` | 绑定 host |
| `PORT` | `3977` | 本地端口 |
| `ALMA_SKETCHUP_HTTP_SESSION_SECRET` | 启动时随机生成 | Bearer secret，至少 16 bytes |
| `ALMA_SKETCHUP_HTTP_MAX_BODY_BYTES` | `1048576` | 请求体字节上限 |
| `ALMA_SKETCHUP_HTTP_TOOL_TIMEOUT_MS` | `60000` | 传给支持 `timeoutMs` 的 tool 的最大值 |
| `ALMA_SKETCHUP_HTTP_REQUEST_TIMEOUT_MS` | `65000` | HTTP 请求总超时 |
| `ALMA_SKETCHUP_WORKSPACE_ROOT` | 当前项目根 | 相对路径的解析根 |
| `ALMA_SKETCHUP_STATE_DIR` | `~/.sketchup-mcp-replica` | queue/response/state 允许根 |
| `ALMA_SKETCHUP_HTTP_ALLOWED_ROOTS` | 空 | 额外允许根，多个路径用平台 `path.delimiter` 分隔 |
| `ALMA_SKETCHUP_HTTP_ALLOW_NON_LOOPBACK` | 未设置 | 只有值为 `1` 时允许非 loopback host |

用户需要打开/导入/导出 workspace 外模型时，应把具体模型目录加入 `ALMA_SKETCHUP_HTTP_ALLOWED_ROOTS`，不要把 `/`、用户主目录或整个云盘加入允许根。

显式允许非 loopback 只是解除启动保护，不会自动提供 TLS、防火墙、密钥轮换或多用户隔离。不应直接暴露到局域网或公网。

HTTP 不提供 arbitrary Ruby override。需要受控调试时，应使用非 HTTP 的可信 expert surface，并继续满足该 surface 自身的 execution policy、fresh Session Contract 与真人批准边界。普通 HTTP Agent 应使用 safe JSON DSL、restricted compiler 或 Gateway。

## 稳定错误码

下表是当前 Agent Contract **40 个稳定 code** 在 HTTP 边界的分组映射，同时包含 HTTP parser/router 自身的错误；不在文档中手工重复完整 registry。具体 `code` 和 `next_action` 由服务端返回；不要仅根据 HTTP status 猜测是否可重试。

| HTTP | code | 含义 |
|---:|---|---|
| 400 | `INVALID_JSON` | body 不是有效 JSON |
| 401 | `AUTH_REQUIRED` | 缺少或错误 Bearer secret |
| 403 | `PATH_NOT_ALLOWED` | 输入路径越界 |
| 403 | `OUTPUT_PATH_NOT_ALLOWED` | 输出制品路径越界 |
| 403 | `POLICY_DENIED` / `OPERATION_NOT_ALLOWED` | server policy、审查后的 operation scope，或 HTTP arbitrary-Ruby 边界不允许 |
| 403 | `APPROVAL_REQUIRED` / `APPROVAL_INVALID` | 缺少可信用户批准，或 token 无效 |
| 404 | `NOT_FOUND` / `TOOL_NOT_FOUND` | endpoint/tool 不存在；未授权请求仍先返回 401，不泄露 tool 是否存在 |
| 404 | `TASK_NOT_FOUND` / `ARTIFACT_NOT_FOUND` / `MODEL_GRAPH_NOT_FOUND` | task、opaque artifact handle 或持久化 ModelGraph 不存在 |
| 409 | task / idempotency / approval / plan state conflicts | 包括 `TASK_STATE_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`APPROVAL_EXPIRED`、`APPROVAL_REPLAYED`、`PLAN_HASH_MISMATCH` |
| 409 | model / revision / Session Contract drift | 包括 model identity/revision/incomplete-revision 以及除 `HANDSHAKE_REQUIRED` 外的 `HANDSHAKE_*` |
| 409 | queue pending / post-commit recovery conflicts | 包括 `QUEUE_NOT_IDLE`、pending request/response、`MUTATION_RECOVERY_REQUIRED`；按 `next_action` 恢复，不得盲目重发修改 |
| 423 | `QUEUE_LOCK_PRESENT` / `QUEUE_STALE_LOCK` | queue 锁阻止安全执行 |
| 428 | `HANDSHAKE_REQUIRED` | live mutation 缺少 fresh Session Contract |
| 413 | `BODY_TOO_LARGE` | body 超出上限 |
| 504 | `TOOL_TIMEOUT` | 已分类为无持久副作用的读/编译 tool 超时；仍为 `retryable=false`，先检查服务 |
| 500 | `MUTATION_EXECUTION_FAILED` | 修改/制品/task 副作用请求在分派后超时或执行失败；超时返回 `outcome_unknown=true`、`retryable=false`、`next_action.retry=do_not_retry`，先检查 task/模型/制品 |
| 500 | `MUTATION_RECEIPT_INVALID` | 私有 mutation receipt 的 HMAC、claim、plan 或 model/revision 绑定失败；不得执行 finalizer 或重放修改 |
| 500 | `ARTIFACT_INTEGRITY_ERROR` / `MODEL_GRAPH_INTEGRITY_ERROR` | 持久化内容完整性校验失败；按 `next_action` 重新导入或重建 |
| 500 | `INTERNAL_ERROR` | 内部失败；用 request id 对应本地日志 |

HTTP timeout 不是取消已分派工作或已被 SketchUp 消费的修改的事务机制。对可产生持久副作用的 tool，HTTP 外层超时会保守地按 outcome-unknown 处理；客户端断开同样不代表取消。timeout effect 分类来自共享 tool registry，未分类的新工具默认 `persistent_or_unknown`，不会因工具表增长而误落入可重试读操作。修改性 queue 工作必须继续使用 task/idempotency/revision/review/receipt 合同，不能依赖 HTTP 超时或断连猜测是否执行，也不得原样重发。

同理，如果潜在副作用 tool 已完成分派，但返回体包含越界路径，HTTP 不会用普通 `OUTPUT_PATH_NOT_ALLOWED` 暗示“尚未执行”；它返回 `MUTATION_EXECUTION_FAILED`、`outcome_unknown=true` 和 `do_not_retry`。只有明确无副作用的读/编译 tool 在相同输出策略失败时返回 403。
