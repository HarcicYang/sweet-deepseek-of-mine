# Sweet DeepSeek O'Mine

[English](README.md) | 简体中文

基于 DeepSeek 官方 `chat-demo` 与 API 开发的独立社区聊天工具（非官方产品）。采用 pnpm workspace 架构，提供前后端分离的完整聊天体验与安全凭据管理。

## 核心功能

- **多会话管理**：支持自动标题、重命名、删除、消息分支切换与重新生成。
- **安全代理**：通过 GitHub OAuth 登录，DeepSeek API Key 由服务端经 AES-256-GCM 加密存储，所有 API 请求均由同源后端代理，不暴露在浏览器端。
- **云端同步与缓存**：会话与设置支持云端同步、账号隔离的 IndexedDB 缓存、离线 outbox 及冲突副本处理。
- **多模态与富文本**：支持流式响应、深度思考、网络搜索、链接阅读与来源引用；支持带复制、下载和全屏工具的 Markdown 表格、代码高亮、KaTeX 公式与 Mermaid 图表。
- **生成式界面**：支持经服务端校验的 JSON-Render 卡片、轮播、指标、步骤、图表、折叠详情和代码块，并提供 Markdown 回退与安全复制/继续操作。
- **远程 MCP 工具**：可在设置中按账号添加 Streamable HTTP MCP 服务。MCP 工具与联网搜索、链接阅读进入同一回复循环和工具时间线，非只读工具需要用户明确确认。
- **临时分享**：可生成 1–30 天有效的只读对话快照链接，访客不能发送消息或访问附件原件。
- **自定义指令**：可在设置中添加账号级 system prompt 补充，并跨设备同步。
- **多媒体交互**：支持附件拖拽上传、语音输入及朗读。
- **个性化**：支持中英双语、明暗主题、移动端适配及历史记录导入导出。

## 快速开始

本项目需要 **Node.js 22.12+** 和 **pnpm**。

### 1. 克隆与安装

```sh
git clone [https://github.com/HarcicYang/sweet-deepseek-of-mine.git](https://github.com/HarcicYang/sweet-deepseek-of-mine.git)
cd sweet-deepseek-of-mine
pnpm install

```

### 2. 配置环境变量

1. 在 GitHub 中创建一个 OAuth App，回调地址填写：`http://localhost:8090/api/auth/github/callback`。
2. 复制 `.env.example` 为 `.env`，填入你的 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`。
3. 运行以下命令生成 32 字节的主密钥并写入 `.env`：

```sh
openssl rand -base64 32

```

### 3. 运行服务

在两个终端分别执行以下命令：

```sh
pnpm dev         # 启动前端开发服务器 (http://localhost:8090)
pnpm dev:server  # 启动 Hono 后端服务 (http://localhost:8787)

```

> **注意**：完整应用需要配合 Hono 服务端进行同源 `/api` 转发，无法仅靠静态 `index.html` 运行在线聊天。
> 详细部署方案可参考 [认证与 API Key](https://www.google.com/search?q=docs/authentication.md) 及 [部署说明](https://www.google.com/search?q=docs/deployment.md)。

---

## 项目结构

```text
apps/
  web/               React 聊天客户端
  server/            TypeScript + Hono 服务端
packages/
  contracts/         前后端共享协议与运行时校验
  json-render/        版本化 JSON UI schema 与校验
docs/                架构与协议说明

```

## 开发命令

| 命令              | 说明                            |
| ----------------- | ------------------------------- |
| `pnpm dev`        | 启动前端开发服务器              |
| `pnpm dev:server` | 启动 Hono 服务端                |
| `pnpm build`      | 构建生产产物 (`apps/web/dist/`) |
| `pnpm type`       | TypeScript 类型检查             |
| `pnpm lint`       | oxlint 代码检查                 |
| `pnpm test`       | 运行服务端测试                  |
| `pnpm format`     | oxfmt 代码格式化                |

---

## 数据与隐私

- **API Key 保护**：API Key 仅由服务端使用 AES-256-GCM 加密存储，不保存在浏览器本地。
- **MCP 凭据**：MCP 服务配置按账号隔离，请求头由服务端加密保存，不会返回浏览器。
- **数据同步**：会话文本、思考、搜索及相关设置会同步至云端，并缓存在 `chat-demo:<userId>` IndexedDB 中。
- **导入导出**：支持 ZIP 格式的历史记录导入导出（导出内容包含会话与图片原件，不包含 API Key 及敏感凭据）。

更多同步协议与设计细节请查阅 [云端会话同步说明](https://www.google.com/search?q=docs/sync.md)。

---

## 许可证

[MIT](https://www.google.com/search?q=LICENSE) © HarcicYang
