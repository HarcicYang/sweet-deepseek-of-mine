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
- `GET /api/mcp/tools`：汇总当前账号所有已启用服务的工具。
- `POST /api/mcp/call`：执行一个经过确认的 MCP 工具。

`probe` 的失败作为 `{ "ok": false, "stage": "connect" | "list", ... }` 返回，
不会让设置页把超时和空工具列表混为一谈。

## 模型工具循环

MCP 工具不是单独页面或单独聊天模式，而是和 `deepseek_web_search`、
`deepseek_read_url` 一起进入同一个回复循环：

1. 请求前读取当前账号启用的 MCP 工具，并和内置工具合并。
2. 模型返回 `tool_use` 后，客户端查找工具目录并执行服务端 MCP 调用。
3. 工具结果以 `tool_result` 追加到当前助手回复，再继续请求模型。
4. 正文、思考、搜索步骤和 MCP 工具步骤按原始顺序显示。
5. 用户停止时取消 MCP 请求；失败的 MCP 调用以错误 `tool_result` 返回给模型，
   让模型可以解释失败或选择其他方案。

工具名使用稳定的 `mcp__<serverSlug>__<rawName>` 格式，超过 DeepSeek 的 64 字符限制
或含非法字符时追加 SHA-256 截断哈希，避免不同工具合并。

## 权限

- MCP 工具声明了 `readOnlyHint: true` 时可以直接执行。
- 没有明确只读声明的工具必须显示参数确认弹窗；用户拒绝后，模型收到失败的
  `tool_result`，不会产生外部副作用。
- MCP 返回值、服务描述和工具定义都视为不可信输入，不能覆盖 system prompt。
- 创建公开分享快照时，MCP 调用参数和结果会被隐藏，避免服务内部数据进入公开链接。
- 单次回复的 MCP 工具循环有宽松上限，避免模型无限重复调用；用户仍可随时停止。

## 网络与部署

- 默认只允许 HTTPS 目标，拒绝 URL 中的账号密码、片段、私有 IP 和 localhost。
- 默认禁止重定向，避免公开 URL 跳转到内网。
- 本地或 ECS 自托管如果需要 `http://localhost` 或局域网 MCP，设置
  `MCP_ALLOW_PRIVATE_NETWORK=true`。这只应在受信任的单用户部署中启用。
- Worker 使用 D1 表 `mcp_servers`；Node 使用 `MCP_DB_PATH` 指向的 JSON 文件。

## 当前范围

- 支持工具发现和工具调用，不支持 MCP prompts/resources。
- 工具结果目前只把文本投影到模型上下文；图片、音频和嵌入资源会以诊断文本代替。
- 连接按探测或调用请求建立，Workers 不依赖持久连接、Durable Objects 或队列。
- 尚未实现 MCP OAuth 交互流程；当前可在请求头中配置静态凭据。

## 归属

- MCP 协议客户端使用 MIT 许可的 `@modelcontextprotocol/client`。
- 工具命名、探测和错误分类参考 MIT 许可的 DeepSeek Harness
  `@deepseek-ai/dsh-mcp-client`（Copyright © 2026 DeepSeek），本项目仅保留适配所需的轻量实现。
