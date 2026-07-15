# HTTP 本地服务安全与运维

`src/http-server.mjs` 是可选的本地 bridge。localhost 不是信任边界：同一台机器上的其他进程、浏览器页面和被入侵的应用都可能访问本地端口。

## 默认安全边界

- 显式绑定 `127.0.0.1`，不依赖 Node 的未指定 host 默认值。
- `GET /health` 和 `GET /tools` 可不授权读取，但不返回 session secret、模型内容或本地路径。
- 所有 `POST /tools/<name>` 都要求 `Authorization: Bearer <session-secret>`。
- 未配置 secret 时，进程启动时生成 32-byte random secret，只在本地 stderr 显示一次。生产性使用应显式设置环境变量。
- 默认 body limit 为 1 MiB，工具 timeout 为 60s，HTTP request timeout 为 65s。
- 路径默认只允许项目 workspace 和 `~/.sketchup-mcp-replica` state root。读写越界均 fail closed，并校验已存在路径的 symlink/realpath。
- 错误返回稳定 code 和 request id，不回显内部 stack、secret 或越界路径。

## 启动与调用

```bash
ALMA_SKETCHUP_HTTP_SESSION_SECRET='replace-with-at-least-16-bytes' npm run server
```

```bash
curl http://127.0.0.1:3977/health
curl http://127.0.0.1:3977/tools
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

## 稳定错误码

| HTTP | code | 含义 |
|---:|---|---|
| 400 | `INVALID_JSON` | body 不是有效 JSON |
| 401 | `AUTH_REQUIRED` | 缺少或错误 Bearer secret |
| 403 | `PATH_NOT_ALLOWED` | 输入路径越界 |
| 403 | `OUTPUT_PATH_NOT_ALLOWED` | 输出制品路径越界 |
| 404 | `NOT_FOUND` / `TOOL_NOT_FOUND` | endpoint/tool 不存在 |
| 413 | `BODY_TOO_LARGE` | body 超出上限 |
| 504 | `TOOL_TIMEOUT` | tool 超时 |
| 500 | `INTERNAL_ERROR` | 内部失败；用 request id 对应本地日志 |

HTTP timeout 不是取消已被 SketchUp 消费的修改的事务机制。修改性 queue 工作必须继续使用 task/idempotency/revision/review 合同，不能依赖 HTTP 超时猜测是否执行。
