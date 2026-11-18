# 远程 MCP 工具

当前实现复用官方 [`@modelcontextprotocol/client`](https://github.com/modelcontextprotocol/typescript-sdk)
和 DeepSeek Harness 的工具命名、探测与错误处理思路。只支持远程 Streamable HTTP，
不启动 `stdio` 子进程。

## 账号隔离

- MCP 服务属于登录账号，所有查询和修改都使用服务端会话中的 `userId`。
- 数据库主键为服务端生成的服务器 ID；同时限制 `(userId, slug)` 唯一。
- 请求头整体序列化后使用 AES-GCM 加密，附加认证数据绑定用户 ID 和服务器 ID。
- 浏览器只能拿到请求头名称，不能重新读取已保存的敏感值。
- 工具执行接口会再次验证服务器属于当前用户并处于启用状态。

## API

- `GET /api/mcp/servers`：列出当前账号的服务。
- `POST /api/mcp/servers`：添加服务。
- `PUT /api/mcp/servers/:serverId`：更新服务；省略 `headers` 时保留原请求头。
- `DELETE /api/mcp/servers/:serverId`：删除服务。
- `POST /api/mcp/servers/:serverId/probe`：连接、读取服务信息并发现工具。
- `POST /api/mcp/servers/:serverId/oauth/start`：启动 OAuth 授权并返回授权地址。
- `POST /api/mcp/servers/:serverId/oauth/disconnect`：清除该服务的 OAuth 授权。
- `GET /api/mcp/oauth/callback`：接收授权码并交换 token。
- `GET /api/mcp/registry/servers`：代理官方 MCP Registry 的服务发现查询。
- `GET /api/mcp/tools`：汇总当前账号所有已启用服务的工具。
- `POST /api/mcp/call`：执行一个经过确认的 MCP 工具。

`probe` 的失败作为 `{ "ok": false, "stage": "connect" | "list", ... }` 返回，
不会让设置页把超时和空工具列表混为一谈。

## Registry 发现

- 设置页从官方 `https://registry.modelcontextprotocol.io/v0.1/servers` 读取 `version=latest`
  的服务，并只展示状态为 `active`、包含 Streamable HTTP `remotes` 的条目。
- 官方搜索只匹配服务名称；1–2 个字符时客户端筛选当前已加载结果，3 个字符以上才请求完整
  Registry。分页 cursor 原样使用，不自行构造。
- Registry 中的 stdio/npm/PyPI 包不会显示。服务描述、请求头名称、仓库地址和版本都按不可信数据
  校验，远程地址必须通过现有 HTTPS / 私网策略。
- 导入只会预填名称、命名空间、URL 和静态认证方式，仍需用户确认后保存。重复 URL 会标记为已添加。
- Registry 只提供服务元数据，不提供工具清单。添加后通过现有“测试”操作建立连接并调用
  `tools/list`；SDK 会自动聚合多页工具列表。
- Registry 标记需要认证时，用户可填写静态请求头，或选择 OAuth。选择 OAuth 后“保存并授权”会在
  保存成功后立即打开授权窗口；Registry 提供的占位值不会作为凭据保存。

## OAuth

每个 MCP 服务可以选择静态请求头或 OAuth 授权：

- OAuth 使用 MCP SDK 的 `OAuthClientProvider`、RFC 9728 资源元数据发现、PKCE 和动态客户端注册。
- 状态、client information、code verifier、discovery state、access token 和 refresh token 全部
  加密保存在 `mcp_oauth`，并绑定用户 ID 与服务器 ID。
- 设置页在用户点击授权后打开独立窗口。后端返回授权地址，授权服务器回调到
  部署固定的 OAuth 回调地址。
- 回调必须同时匹配登录会话和一次性 `state`；成功后轮换 `state`，旧回调不能重放。
- 后续请求由 SDK 自动附带 Bearer token，并在过期时尝试 refresh token。
- OAuth Client ID、Client Secret 和回调 URI 属于部署配置，不出现在用户设置页，也不由每个用户填写。
- `0005` migration 会清空旧版本可能保存过的用户级 OAuth Client 字段；MCP 服务定义和已授权
  token 不受影响。
- 支持动态客户端注册的服务无需额外配置，会由 MCP SDK 自动注册。
- 不支持动态注册的服务由部署方通过 `MCP_OAUTH_CLIENTS` 配置，例如：

  ```json
  [
    {
      "resource": "https://mcp.example.com",
      "clientId": "<provider client id>",
      "clientSecret": "<provider client secret>"
    }
  ]
  ```

  `resource` 可以是 MCP 服务 origin，也可以是精确 URL；精确 URL 优先。`redirectUrl`
  通常无需填写，默认使用部署的 `/api/mcp/oauth/callback`。只有迁移到已有回调端点时才需要覆盖。

- GitHub Copilot MCP 发布标准 protected-resource metadata，但 GitHub 不提供动态客户端注册。
  本项目直接复用部署现有的 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 和
  `GITHUB_CALLBACK_URL`（默认 `/api/auth/github/callback`）。用户不需要创建 GitHub OAuth App，
  也不需要填写 Client ID、Secret 或回调地址。
- 如果部署方希望为 GitHub MCP 使用另一套 OAuth App，可以显式配置 `MCP_OAUTH_CLIENTS`；
  精确配置会覆盖内置的 GitHub 默认映射。

## 模型工具循环

MCP 工具不是单独页面或单独聊天模式。DeepSeek Provider 的原生
`deepseek_web_search` / `deepseek_read_url` 由上游执行；其他 Provider 的同名函数工具
和 MCP 工具一起进入客户端回复循环：

1. 请求前读取当前账号启用的 MCP 工具，并和内置工具合并。
2. 模型返回 `tool_use` 后，客户端查找工具目录并执行服务端 MCP 调用。
3. 工具结果以 `tool_result` 追加到当前助手回复，再继续请求模型。
4. 正文、思考、搜索步骤和 MCP 工具步骤按原始顺序显示。
5. 用户停止时取消 MCP 请求；失败的 MCP 调用以错误 `tool_result` 返回给模型，
   让模型可以解释失败或选择其他方案。

工具名使用稳定的 `mcp__<serverSlug>__<rawName>` 格式，超过 DeepSeek 的 64 字符限制
或含非法字符时追加 SHA-256 截断哈希，避免不同工具合并。

## 权限

- 每个 MCP 服务默认使用“全部询问”模式，忽略远端 `readOnlyHint`，所有工具调用都必须显示
  参数确认弹窗。
- 用户可以在添加或编辑服务时改为“完全信任”。该模式信任远端 MCP 的 `readOnlyHint`：
  标记为只读的工具可以直接执行，其余工具仍需确认。信任模式由服务端保存并参与审批判断。
- 用户拒绝后，模型收到失败的 `tool_result`，不会产生外部副作用。
- MCP 返回值、服务描述和工具定义都视为不可信输入，不能覆盖 system prompt。
- 创建公开分享快照时，MCP 调用参数和结果会被隐藏，避免服务内部数据进入公开链接。
- 单次回复的 MCP 工具循环有宽松上限，避免模型无限重复调用；用户仍可随时停止。

## 网络与部署

- 默认只允许 HTTPS 目标，拒绝 URL 中的账号密码、片段、私有 IP 和 localhost。
- 这些检查是基础配置校验，不应视为网络隔离边界。后端会直接连接 MCP 地址，请只添加可信服务；
  私网地址在不同部署环境中的可达性可能不同。
- 默认禁止重定向，避免公开 URL 跳转到内网。
- 本地或 ECS 自托管如果需要 `http://localhost` 或局域网 MCP，设置
  `MCP_ALLOW_PRIVATE_NETWORK=true`。这只应在受信任的单用户部署中启用。
- Worker 使用 D1 表 `mcp_servers`；Node 使用 `MCP_DB_PATH` 指向的 JSON 文件。

## 当前范围

- 支持工具发现和工具调用，不支持 MCP prompts/resources。
- 工具结果目前只把文本投影到模型上下文；图片、音频和嵌入资源会以诊断文本代替。
- 连接按探测或调用请求建立，Workers 不依赖持久连接、Durable Objects 或队列。

## 归属

- MCP 协议客户端使用 MIT 许可的 `@modelcontextprotocol/client`。
- 工具命名、探测和错误分类参考 MIT 许可的 DeepSeek Harness
  `@deepseek-ai/dsh-mcp-client`（Copyright © 2026 DeepSeek），本项目仅保留适配所需的轻量实现。
