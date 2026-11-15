# Sweet DeepSeek O'Mine

[English](README.md) | 简体中文

基于 DeepSeek 官方开源 `chat-demo` 和 DeepSeek API 的独立社区聊天工具，不代表 DeepSeek 官方产品。

当前仓库已迁移为 pnpm workspace。Web 端通过同源后端接口使用 GitHub OAuth，聊天、附件和语音请求都由服务端代理；DeepSeek API Key 不再进入浏览器存储。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/HarcicYang/sweet-deepseek-of-mine.git
cd sweet-deepseek-of-mine
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

### 本地服务端

服务端默认运行在 `http://localhost:8787`，Web 开发服务器会把 `/api` 代理到该端口。

1. 在 GitHub 创建 OAuth App，回调地址填写 `http://localhost:8090/api/auth/github/callback`。
2. 复制 `.env.example` 为 `.env`，填写 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`。
3. 使用 `openssl rand -base64 32` 生成 32 字节 `APP_MASTER_KEY`。
4. 在两个终端分别运行：

```sh
pnpm dev
pnpm dev:server
```

登录与安全边界见[认证与 API Key](docs/authentication.md)。

生成静态产物：

```sh
pnpm build
```

产物位于 `apps/web/dist/`。完整应用还需要部署 Hono 服务端，并把同源 `/api` 请求转发到该服务端；不能只打开静态 `index.html` 使用在线聊天。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- GitHub 登录、服务端会话、加密 Key 存储与同源 API 代理。
- 会话与常用设置云端同步、账号隔离的 IndexedDB 缓存、离线 outbox 和冲突副本。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 数据

Web 端只保存普通设置，DeepSeek API Key 由服务端使用 AES-256-GCM 加密保存。会话文本以及思考、搜索、TTS 音色和位置设置会同步到云端，并按账号缓存在 `chat-demo:<userId>` IndexedDB 中；主题、语言和侧栏状态保持设备本地。附件原件目前仍是本地数据；通过服务端上传到 DeepSeek 的附件由服务端代理。

会话同步协议、删除墓碑、离线 outbox 和冲突策略见[云端会话同步](docs/sync.md)。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](apps/web/src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令              | 用途                    |
| ----------------- | ----------------------- |
| `pnpm dev`        | 启动开发服务器          |
| `pnpm dev:server` | 启动 Hono 服务端        |
| `pnpm build`      | 构建到 `apps/web/dist/` |
| `pnpm type`       | TypeScript 类型检查     |
| `pnpm lint`       | oxlint 检查             |
| `pnpm test`       | 运行服务端测试          |
| `pnpm format`     | oxfmt 格式化            |

[apps/web/rspack.config.ts](apps/web/rspack.config.ts) 将 `/api` 代理到本地 Hono 服务端；`API_PROXY_TARGET` 可覆盖开发代理目标。

聊天默认使用 `deepseek-flash`，通过 Anthropic 兼容的 Messages / Files API 通信；语音使用 ASR / TTS 接口。请求使用搜索、链接阅读、标题和 `latest_reminder` 等扩展，接入服务需支持相应能力。附件实际支持的格式以服务端校验为准。

```text
apps/
  web/                 React 聊天客户端
  server/              TypeScript + Hono 服务端
packages/
  contracts/           前后端共享协议与运行时校验
docs/                  架构与协议说明
```

## 许可证

[MIT](LICENSE)。构建会将许可证复制到 `apps/web/dist/LICENSE`，分发时请一并保留；第三方依赖遵循各自的许可证。
