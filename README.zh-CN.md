# Sweet DeepSeek O'Mine

[English](README.md) | 简体中文

基于 DeepSeek 官方开源 `chat-demo` 和 DeepSeek API 的独立社区聊天工具，不代表 DeepSeek 官方产品。

当前仓库已迁移为 pnpm workspace，Web 端暂时保留原有浏览器直连模式；服务端代理和账号体系正在逐步接入。

## 运行

准备 Node.js 22.12+ 和 pnpm：

```sh
git clone https://github.com/HarcicYang/sweet-deepseek-of-mine.git
cd sweet-deepseek-of-mine
pnpm install
pnpm dev
```

打开 http://localhost:8090 。

生成静态产物：

```sh
pnpm build
```

产物位于 `apps/web/dist/`，可部署到静态服务器，也可直接打开 `apps/web/dist/index.html`。直接打开时，浏览器和 API 服务需允许 `file://` 页面的存储与跨域请求。

## 功能

- 多会话、自动标题、重命名与删除；编辑提问、重新生成和切换消息分支。
- 流式回答、深度思考、智能搜索、链接阅读与来源引用；支持停止和符合条件的继续生成。
- 附件上传、粘贴与拖拽，语音输入和回复朗读；移动端录音时输入框首行显示实时频谱。
- Markdown、代码高亮、KaTeX 公式和 Mermaid 图表。
- 简体中文与英文、浅色与深色主题、移动端布局、位置设置、历史导入导出。

## 数据

API Key 和设置保存在浏览器 localStorage，会话及附件原件保存在 IndexedDB，本地数据按浏览器用户配置和站点源（origin）隔离。发送对话、上传附件和使用语音功能时，相应内容会提交给配置的 API 服务。

设置中的历史导入导出使用 ZIP 格式。导入会在确认并校验成功后替换全部本地会话和附件；导出包含会话与本地可用的图片原件，不包含 API Key、设置或非图片附件原件。格式与保留范围见[历史导入导出](apps/web/src/services/chat/history/README.md)。

设置 → 数据管理 → 删除所有对话，会在确认后清空全部本地会话、附件原件和未发送的草稿，停止正在生成的回复并回到新对话。API Key 和其他设置保留，已上传到 API 服务的文件不受影响。

## 开发

| 命令          | 用途                    |
| ------------- | ----------------------- |
| `pnpm dev`    | 启动开发服务器          |
| `pnpm build`  | 构建到 `apps/web/dist/` |
| `pnpm type`   | TypeScript 类型检查     |
| `pnpm lint`   | oxlint 检查             |
| `pnpm format` | oxfmt 格式化            |

[apps/web/rspack.config.ts](apps/web/rspack.config.ts) 默认连接 `https://api.deepseek.com`。`createConfig({ apiOrigin, devServer })` 支持自定义 API 地址和开发服务器代理。

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
