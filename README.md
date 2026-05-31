# Dior Agent

一个基于 Bun + TypeScript 的私有 WebSocket agent 服务骨架。主路径使用 Hono 承载 HTTP 路由，`ws`
承载 WebSocket 长连接，Zod 负责配置和协议校验。运行形态是单 Pod 内一个 gateway/supervisor
进程管理多个目录隔离的 session-runtime。

## 技术基线

- Runtime: Bun `>=1.3.0`
- Language: TypeScript / TSX / ESM, strict mode
- HTTP: Hono on Node-compatible server adapter
- WebSocket: `ws`
- Contracts: Zod schemas for env/config and WebSocket messages
- Build: `build.ts` 使用 `Bun.build()`；`vite.config.ts` 提供 SSR bundle 备用构建
- Quality: Biome + TypeScript + Bun test

## 目录结构

```text
src/
  app/            composition root，组装 config/logger/agent service
  config/         环境变量配置解析
  contracts/      外部协议 schema、codec、类型导出
  domain/         agent/session 领域接口、默认 runtime、supervisor
  entrypoints/    服务入口
  infrastructure/ 文件型 session store 等基础设施实现
  observability/  日志等观测基础设施
  runtime/        进程级 server 生命周期
  shared/         ID 等无业务共享工具
  transports/     HTTP、WebSocket、鉴权等传输层 adapter
```

## 本地运行

```bash
bun install
cp .env.example .env

# 修改 .env 里的 AGENT_API_TOKEN 后启动
AGENT_API_TOKEN=local-dev-token bun run dev
```

默认 session 数据目录是 `.data`，可通过 `AGENT_DATA_DIR` 调整。实际工作区根目录默认是
`${AGENT_DATA_DIR}/workspaces`，也可以通过 `AGENT_WORKSPACE_ROOT` 单独配置，便于部署时挂载独立卷。
模型配置默认读取 `.config/models.toml`，可通过 `AGENT_MODEL_CONFIG_PATH` 调整；默认开启文件监听热更新。

WebSocket 地址：

```text
ws://localhost:8787/ws
```

服务端优先读取 `Authorization: Bearer <token>`。浏览器 WebSocket 不能设置自定义
`Authorization` header 时，建议由你的私有 Web 入口签发 `HttpOnly; Secure; SameSite=Strict`
的 `agent_token` cookie，再发起 WebSocket 连接。

```ts
new WebSocket('ws://localhost:8787/ws')
```

生产环境建议配置 `AGENT_ALLOWED_ORIGINS`，只允许自己的前端 Origin 升级到 `/ws`：

```bash
AGENT_ALLOWED_ORIGINS=https://private.example,https://admin.example
```

`?token=...` 默认关闭，因为 query string 容易进入日志。确实需要兼容受限客户端时再显式开启：

```bash
AGENT_ALLOW_QUERY_TOKEN=1 AGENT_API_TOKEN=local-dev-token bun run dev
```

没有 `AGENT_API_TOKEN` 时只有本地临时开发可以设置 `AGENT_ALLOW_INSECURE_DEV=1`，并且必须把
`AGENT_HOST` 设为 `127.0.0.1`、`localhost` 或 `::1`。

健康检查：

```bash
curl http://localhost:8787/health
```

## Session 运行模型

当前落地结构：

```text
pod
  gateway/supervisor process
    session-runtime <session-A>
    session-runtime <session-B>
    session-runtime <session-C>
```

职责拆分：

- `src/transports/websocket/`: 连接认证、消息解析、协议响应。
- `src/domain/sessions/sessionSupervisor.ts`: 管理多个 session-runtime，负责 create/attach/turn/cancel 和 lease。
- `src/domain/sessions/sessionRuntime.ts`: 单 session 串行执行 turn，把 runtime 输出转成事件。
- `src/domain/agent/agentRuntime.ts`: 无工具系统的核心对话 runtime，负责组装消息历史、调用模型流、产出 assistant delta。
- `src/infrastructure/llm/openAICompatibleChatClient.ts`: OpenAI-compatible Chat Completions streaming transport，负责 fetch 和流解析。
- `src/infrastructure/llm/modelProviderStrategy.ts`: 模型 provider 策略层，负责 Ollama/OpenAI 的 URL、鉴权和 request body 差异。
- `src/infrastructure/sessions/fileSessionStore.ts`: 目录型持久化，后续可替换为进程/容器型 runtime 管理。

每个 session 一个目录：

```text
.data/
  sessions/<sessionId>/
    manifest.json
    state.json
    lease.json
    events.jsonl
    turns/<turnId>.json
    snapshots/
    objects/attachments/
    objects/tool-results/
    logs/
  workspaces/<sessionId>/
```

`events.jsonl` 是主事件流；`state.json` 是可重建的快速索引；`lease.json` 是同 Pod/多进程演进时的单写入者保护。
服务端日志仍然属于 gateway/supervisor 进程；session-runtime 诊断日志写入当前 session 目录下的
`logs/runtime.log`，用 JSONL 记录 turn started/completed/failed/cancelled 等运行状态。
实际工作区不再放在 session 元数据目录内，而是放在 `AGENT_WORKSPACE_ROOT/<sessionId>`；`manifest.json`
会记录对应的 `workspacePath`。

每次 turn 开始时，`sessionRuntime` 会从 `events.jsonl` 重建轻量 conversation history，再交给
`AgentRuntime` 追加本轮 user message 并调用模型。这样 gateway/supervisor 重启后，attach 同一个 session
仍能延续上下文。当前历史只包含已完成的 user/assistant 文本回合；Tool system 暂未接入。

## 模型配置

模型配置使用 flat TOML，默认路径是 `.config/models.toml`。`AGENT_MODEL_CONFIG_WATCH=true` 时，
服务启动后会监听配置文件变化并异步 reload。reload 通过 Zod 校验后才替换内存快照；如果新配置无效，
保留上一份可用快照。正在运行的 turn 不受影响，新 turn 才会拿到新快照。

示例：

```toml
llm_provider = "ollama"

########## Ollama Settings
# No need to set it unless you want to use your own proxy
ollama_base_url = "http://localhost:11434"
# Check your available models at https://ollama.com/library
ollama_model_name = "deepseek-r1:70b"

########## OpenAI Settings
# Keep secrets in env instead of this file
openai_api_key_env = "OPENAI_API_KEY"
openai_base_url = "https://api.openai.com/v1"
openai_model_name = "gpt-4.1-mini"
```

当前支持：

- `llm_provider = "ollama"`: 使用 `ollama_base_url` 和 `ollama_model_name`。
- `llm_provider = "openai"`: 使用 `openai_base_url`、`openai_model_name` 和 `openai_api_key_env`。

每个 turn 开始时会把解析后的模型快照写入 `turns/<turnId>.json`：

```json
{
    "model": {
        "configVersion": 1,
        "provider": "ollama",
        "baseUrl": "http://localhost:11434",
        "modelName": "deepseek-r1:70b"
    }
}
```

## 消息协议

客户端请求：

```json
{ "type": "ping", "id": "ping-1" }
```

```json
{ "type": "session.create", "id": "create-1" }
```

```json
{ "type": "session.attach", "id": "attach-1", "sessionId": "sess_xxx", "lastSeq": 0 }
```

```json
{ "type": "turn.start", "id": "turn-1", "sessionId": "sess_xxx", "input": "hello" }
```

```json
{ "type": "turn.cancel", "id": "cancel-1", "sessionId": "sess_xxx", "turnId": "turn-1" }
```

服务端响应：

```json
{ "type": "connection.ready", "connectionId": "...", "serverTime": "...", "maxMessageBytes": 65536 }
```

```json
{ "type": "session.ready", "id": "create-1", "sessionId": "sess_xxx", "lastSeq": 1, "replayedEvents": 1 }
```

```json
{ "type": "turn.accepted", "id": "turn-1", "sessionId": "sess_xxx", "turnId": "turn-1" }
```

```json
{ "type": "session.event", "event": { "type": "turn.completed", "seq": 5, "sessionId": "sess_xxx", "turnId": "turn-1", "output": "...", "createdAt": "..." } }
```

## 常用命令

```bash
bun run dev
bun run typecheck
bun run lint
bun test
bun run build
bun run build:vite
```

## 分层说明

- `src/contracts/websocket/`: 对外 WebSocket 协议，只放 schema、codec、协议类型。
- `src/domain/agent/`: agent runtime 业务边界，包含系统提示词、消息类型、模型客户端 contract 和对话 runtime。
- `src/domain/sessions/`: session supervisor/runtime/store contract。这里是未来拆进程、容器、Pod 的核心边界。
- `src/infrastructure/llm/`: 模型 provider adapter。当前用 strategy pattern 拆分 provider 差异，默认策略是 Ollama OpenAI-compatible 和 OpenAI Chat Completions。
- `src/infrastructure/sessions/`: 当前文件型 session store，负责目录结构和 JSONL 事件流。
- `src/domain/auth/`: 认证策略、常量时间 token 校验、认证主体。
- `src/transports/auth/`: WebSocket upgrade 认证 adapter，负责 Origin allowlist 和 Bearer/cookie/query 凭证提取。
- `src/transports/http/honoApp.ts`: 主 HTTP app，负责 `/health`、`/ready`、`/ws` 提示等路由。
- `src/transports/websocket/`: `ws` upgrade、连接生命周期、消息分发。
- `src/runtime/server.ts`: 把 Hono HTTP app 和 WebSocket gateway 挂到同一个 HTTP server。

`AgentRuntime.runTurn()` 是 async generator，会逐步产出 assistant delta，再由 `SessionRuntime` 统一持久化为
session event。协议层已经预留 tool use/tool result 事件类型，但当前 runtime 不会触发工具执行。
