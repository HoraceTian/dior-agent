# Dior Agent

一个基于 Bun + TypeScript 的私有 WebSocket agent 服务骨架。主路径使用 Hono 承载 HTTP 路由，`ws`
承载 WebSocket 长连接，Zod 负责配置和协议校验。

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
  domain/         agent 领域接口、用例服务、默认 runtime
  entrypoints/    服务入口
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

## 消息协议

客户端请求：

```json
{ "type": "ping", "id": "ping-1" }
```

```json
{ "type": "agent.message", "id": "turn-1", "input": "hello" }
```

服务端响应：

```json
{ "type": "connection.ready", "connectionId": "...", "serverTime": "...", "maxMessageBytes": 65536 }
```

```json
{ "type": "agent.message.result", "id": "turn-1", "output": "...", "metadata": { "runtime": "stub" } }
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
- `src/domain/agent/`: agent 业务边界。后续接模型、工具、队列时从这里扩展。
- `src/domain/auth/`: 认证策略、常量时间 token 校验、认证主体。
- `src/transports/auth/`: WebSocket upgrade 认证 adapter，负责 Origin allowlist 和 Bearer/cookie/query 凭证提取。
- `src/transports/http/honoApp.ts`: 主 HTTP app，负责 `/health`、`/ready`、`/ws` 提示等路由。
- `src/transports/websocket/`: `ws` upgrade、连接生命周期、消息分发。
- `src/runtime/server.ts`: 把 Hono HTTP app 和 WebSocket gateway 挂到同一个 HTTP server。

`src/domain/agent/agentRuntime.ts` 是后续接入真实模型、任务队列、工具系统或业务服务的主要扩展点。
