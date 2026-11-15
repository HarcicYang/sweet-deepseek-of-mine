# Workspace 与信任边界

当前仓库使用 pnpm workspace：

```text
apps/
  web/                 React 聊天客户端
  server/              TypeScript + Hono 服务端
packages/
  contracts/           前后端共享协议和运行时校验
```

## 边界

- `apps/web` 负责界面、本地缓存、流式渲染和用户交互，不持久化 DeepSeek API Key。
- `apps/server` 负责登录会话、服务端密钥、DeepSeek 代理和后续的 MCP 网关。
- `packages/contracts` 同时被客户端和服务端引用，保存可序列化协议、共享常量和不可信输入的校验函数。
- 静态注册的 UI 组件、Skill manifest 和 MCP 返回值不进入共享协议包，直到对应能力开始实现。

## 当前迁移状态

Web 端暂时保留原来的浏览器直连模式和 `localStorage` API Key。下一阶段先实现服务端登录边界、Key 存储和聊天代理，再把 Web 端的请求切换为同源后端接口。
