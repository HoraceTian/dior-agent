# Dior Agent

私有 WebSocket agent 服务。后端和 collector 运行面使用 Go，前端控制台保留在 `page/`，继续使用 React + TypeScript + Vite。

## 技术基线

- Backend runtime: Go `1.24+`
- Frontend: React / TypeScript / Vite，位于 `page/`，依赖安装使用 Bun `>=1.3.0`
- WebSocket: Go HTTP server + Gorilla WebSocket
- Config: 环境变量 + TOML
- LLM: OpenAI-compatible Chat Completions streaming，支持 Ollama / OpenAI
- Storage: 目录型 session store，默认根目录 `.data`

## 目录结构

```text
cmd/
  agent-server/     Go gateway/supervisor 服务入口
  collector/        Go collector 工具宿主入口

internal/
  app/              环境变量配置
  collector/        agent 侧 collector 发现与 manifest 注册
  collectorapp/     collector 应用、manifest、tool invoke
  logging/          JSONL 风格结构化日志
  model/            模型配置、热更新、OpenAI-compatible client
  session/          session store、runtime、supervisor
  transport/ws/     HTTP + WebSocket 协议层

configs/
  collector.example.toml

page/
  React 前端控制台
```

## 本地运行

```bash
cp .env.example .env

# 修改 .env 里的 AGENT_API_TOKEN 后启动
go run ./cmd/agent-server
```

也可以使用 Makefile：

```bash
make dev
```

服务启动时会自动读取根目录 `.env`。直接执行二进制也可以使用同一份配置：

```bash
make start
```

WebSocket 地址：

```text
ws://localhost:8787/ws
```

健康检查：

```bash
curl http://localhost:8787/health
```

## 配置

`.env.example` 包含主服务环境变量：

```text
AGENT_HOST=0.0.0.0
AGENT_PORT=8787
AGENT_WORKSPACE_ROOT=.data
AGENT_MODEL_CONFIG_PATH=.config/models.toml
AGENT_MODEL_CONFIG_WATCH=true
AGENT_COLLECTORS_CONFIG_PATH=.config/collectors.toml
AGENT_API_TOKEN=change-me
AGENT_ALLOW_QUERY_TOKEN=false
AGENT_ALLOWED_ORIGINS=
AGENT_MAX_MESSAGE_BYTES=65536
AGENT_IDLE_TIMEOUT_MS=120000
AGENT_LOG_LEVEL=info
```

生产环境建议配置 `AGENT_ALLOWED_ORIGINS`，只允许自己的前端 Origin 升级到 `/ws`。浏览器 WebSocket
不能设置自定义 `Authorization` header 时，可以使用 `agent_token` cookie；`?token=...` 默认关闭。

## Session 运行模型

运行形态：

```text
pod
  gateway/supervisor process
    session-runtime <session-A>
    session-runtime <session-B>
    session-runtime <session-C>
```

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
    logs/runtime.log
    workspace/
```

`events.jsonl` 是主事件流；`state.json` 是可重建的快速索引；`lease.json` 是同 Pod/多进程演进时的单写入者保护。
实际工作区放在当前 session 目录内的 `workspace/`。

## 模型配置

模型配置默认读取 `.config/models.toml`。`AGENT_MODEL_CONFIG_WATCH=true` 时，Go 服务会轮询文件修改时间并热更新；
正在运行的 turn 使用启动时的模型快照，新 turn 才读取新配置。

```toml
llm_provider = "ollama"

ollama_base_url = "http://localhost:11434"
ollama_model_name = "deepseek-r1:70b"

openai_api_key_env = "OPENAI_API_KEY"
openai_base_url = "https://api.openai.com/v1"
openai_model_name = "gpt-4.1-mini"
```

当前支持：

- `llm_provider = "ollama"`
- `llm_provider = "openai"`

## Collector 与 Tool 宿主

collector 现在也是 Go 应用。启动前复制示例配置：

```bash
cp configs/collector.example.toml collector.toml
DIOR_COLLECTOR_TOKEN=local-collector-token go run ./cmd/collector
```

collector 默认读取 `COLLECTOR_CONFIG`，未设置时读取当前目录的 `collector.toml`。每个部署节点应该在
`collector.description` 里描述自己的机器角色，后续提示词会用它辅助模型选择同名工具所在的 collector。

已实现端点：

```text
GET  /health
GET  /v1/manifest
POST /v1/tools/{toolName}/invoke
```

`/v1/manifest` 和 `/v1/tools/.../invoke` 需要 `Authorization: Bearer <token>` 或 `x-collector-token`。
当前内置 MVP 工具是只读的 `system.info`。

主服务通过 `.config/collectors.toml` 发现 collector：

```toml
[[collectors]]
id = "local-dev"
url = "http://127.0.0.1:9701"
token_env = "DIOR_COLLECTOR_TOKEN"
enabled = true
trust = "private"
```

collector 被发现不等于所有 session 都能调用。后续 tool loop 接入时继续保持：

```text
CollectorDirectory      全局发现了哪些 collector/tools
AgentProfile            agent 默认允许哪些工具
SessionToolPolicy       当前 session 实际启用了哪些工具
TurnSnapshot            当前 turn 固定使用哪一版工具清单
```

## 前端控制台

前端依赖只安装在 `page/` 下，根目录不需要 `node_modules/`：

```bash
make page-install
```

```bash
make page-dev
```

默认前端地址：

```text
http://127.0.0.1:5173
```

前端流程保持兼容：连接 WebSocket、创建 session、attach 已有 session、发送 turn、流式显示 assistant delta、
取消运行中的 turn、查看 session seq 和活动日志。

## 构建与验证

```bash
make test
make build
make page-build
make test-all
```

`make build` 会输出：

```text
dist/dior-agent
dist/dior-collector
```
