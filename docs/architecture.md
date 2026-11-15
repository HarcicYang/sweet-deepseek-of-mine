# Workspace 与信任边界

当前仓库使用 pnpm workspace：

```text
apps/
  web/                 React 聊天客户端
  server/              TypeScript + Hono 服务端
packages/
  contracts/           前后端共享协议和运行时校验
  json-render/          JSON UI schema、提取和静态白名单校验
```

## 边界

- `apps/web` 负责界面、本地缓存、流式渲染和用户交互；迁移完成后不持久化 DeepSeek API Key。
- `apps/server` 负责登录会话、服务端密钥、DeepSeek 代理和后续的 MCP 网关。
- `packages/contracts` 同时被客户端和服务端引用，保存可序列化协议、共享常量和不可信输入的校验函数。
- `packages/json-render` 只保存可序列化 UI 协议和纯校验逻辑；React 组件仍在 Web 端静态注册。
- 静态注册的 UI 组件、Skill manifest 和 MCP 返回值不进入共享协议包，直到对应能力开始实现。

JSON-Render 的协议、校验、回退和分阶段计划见[JSON-Render 引入规划](json-render.md)。

## 当前迁移状态

服务端已实现 GitHub OAuth 登录会话、加密 API Key 存储，以及聊天、附件和语音代理，
协议见[认证与 API Key](authentication.md)。Web 端通过同源 `/api` 接口调用服务端，
不再直接请求 DeepSeek API，也不在浏览器持久化 API Key。会话、删除墓碑和账号常用设置
已接入云端同步；同步协议见[云端会话同步](sync.md)。

## 边缘运行时边界

后端代理不要求所有数据都在边缘 Worker 内完整缓冲。实现按控制面和数据面拆分：

- 控制面适合直接运行在 Worker：OAuth、会话 Cookie、API Key 管理、权限检查、同步元数据和小型 JSON API。
- 聊天 SSE 和 TTS 响应直接转发上游流，不在服务端聚合。
- 附件和 ASR 的 multipart 请求体使用限长流直接转发，不在边缘调用 `formData()`、
  `arrayBuffer()` 或 `text()` 整体读取。
- 大文件、断点续传、对象留存或需要独立生命周期的数据应通过对象存储 adapter 处理；
  业务层只依赖存储接口，不直接耦合具体云厂商。
- 会话同步不能长期依赖单次请求上传完整会话快照。大历史需要增量变更、消息分页或分块存储，
  避免受边缘请求体、内存和数据库单行大小限制。

当前仓库只实现了 Node adapter。边缘部署仍需要 Worker 入口，以及 `AccountStore`、
`SyncStore` 和对象存储的对应 adapter；不能只把 Node 文件存储直接打包进 Worker。
附件原件尚未进入云端存储，后续对象存储方案应同时服务附件和大会话载荷。
