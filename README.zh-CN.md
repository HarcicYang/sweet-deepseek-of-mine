## Sweet DeepSeek O' Mine

[English](README.md) | 简体中文

基于 DeepSeek 官方 `chat-demo` 与 API 的独立社区聊天工具，旨在拓展 DeepSeek 聊天体验。

**不是官方产品**

[Demo on Cloudflare Workers](https://sdom.harcic.me/)

## 核心功能

- **多会话管理**：自动生成标题，支持重命名、删除、消息分支与重新生成。
- **安全代理**：GitHub OAuth 登录；API Key 由服务端 AES-256-GCM 加密保存，所有请求经同源后端转发。
- **多模型提供商**：复用 Pi 的完整提供商目录和协议实现，并支持自定义 OpenAI/Anthropic/Responses 兼容端点。DeepSeek 仍是默认提供商。
- **云端同步与缓存**：会话与设置同步云端，IndexedDB 按账号隔离缓存，离线改动写入 outbox，冲突保留副本。
- **可安装 PWA**：可添加到主屏幕并从应用壳启动；断网时仍可查看本地缓存会话，联网请求会等待恢复连接。
- **多模态与富文本**：流式输出、深度思考、联网搜索、链接阅读与来源引用；Markdown、代码高亮、KaTeX、Mermaid 完整渲染，表格可复制、下载、全屏。
- **生成式界面**：模型返回 JSON-Render 结构（卡片、轮播、指标、步骤、图表、折叠详情、代码块），服务端校验，失败回退 Markdown。
- **远程 MCP 工具**：按账号添加 Streamable HTTP MCP 服务，支持静态请求头或 OAuth；与联网搜索共用工具时间线，非只读工具需确认。
- **Skills**：导入导出 Harness 兼容文本 Bundle（`SKILL.md` 加相对路径资源）；请求只带名称与说明，按需用 `skill` 加载正文、`read_skill_resource` 读取资源，也可用 `/name` 直接调用。
- **临时分享**：生成 1–30 天有效的只读快照链接，访客不能发消息或获取附件原件。
- **自定义指令**：账号级 system prompt 补充，跨设备同步。
- **多媒体交互**：附件拖拽上传、语音输入与朗读。
- **个性化**：中英双语、明暗主题、iOS 26 主屏幕液态玻璃效果、移动端适配、历史记录导入导出。

## 快速开始

运行前需要 **Node.js 22.19+** 和 **pnpm**。

### 1. 克隆与安装

```sh
git clone https://github.com/HarcicYang/sweet-deepseek-of-mine.git
cd sweet-deepseek-of-mine
pnpm install
```

### 2. 配置环境变量

1. 在 GitHub 建一个 OAuth App，回调地址填 `http://localhost:8090/api/auth/github/callback`。
2. 把 `.env.example` 复制成 `.env`，填入你的 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`。
3. 生成 32 字节的主密钥，写进 `.env`：

```sh
openssl rand -base64 32
```

### 3. 运行服务

开两个终端，分别执行：

```sh
pnpm dev         # 启动前端开发服务器 (http://localhost:8090)
pnpm dev:server  # 启动 Hono 后端服务 (http://localhost:8787)
```

> **注意**：在线聊天要靠 Hono 服务端做同源 `/api` 转发，只打开静态的 `index.html` 是用不了的。部署细节见[认证与 API Key](docs/authentication.md)和[部署说明](docs/deployment.md)。

### 4. 交给 Agent 部署

> **如果你很懒**
>
> 把这个发给你的 Agent：
>
> > 请你根据 https://github.com/HarcicYang/sweet-deepseek-of-mine/blob/main/docs/AGENT_INSTRUCTION.md 帮我部署 Sweet DeepSeek O' Mine，并完成真实浏览器验收。

Agent 应阅读 [AGENT_INSTRUCTION.md](docs/AGENT_INSTRUCTION.md)，与你确认使用 Cloudflare Workers Free 还是 Node 部署，并且不得打印、提交或泄露任何密钥。

---

## 项目结构

```text
apps/
  web/               React 聊天客户端
  server/            TypeScript + Hono 服务端
packages/
  contracts/         前后端共享协议与运行时校验
  json-render/        版本化 JSON UI schema 与校验
  skills/             Harness 兼容 Skill 解析、目录与加载格式
docs/                架构与协议说明
```

---

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

- **API Key 保护**：API Key 只在服务端加密存放（AES-256-GCM），不写进浏览器本地存储。
- **MCP 凭据**：MCP 配置按账号隔离，请求头、OAuth Client Secret 和 OAuth token 都在服务端加密保存，不会回传给浏览器。
- **Skill 数据**：Skill Bundle 和文本资源按账号存在后端；分享出去的会话会把工具结果里的 Skill 内容隐去。
- **数据同步**：会话文本、思考过程、搜索内容和相关设置会同步到云端，同时缓存在 `chat-demo:<userId>` 这个 IndexedDB 库中。
- **导入导出**：历史记录可以按 ZIP 格式导入导出。导出包里含会话和图片原件，不含 API Key 和敏感凭据。

同步协议和设计细节见[云端会话同步说明](docs/sync.md)。

---

## 许可证

[MIT](LICENSE) © HarcicYang
