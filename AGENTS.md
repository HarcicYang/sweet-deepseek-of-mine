# AGENTS.md

## 项目定位

Sweet DeepSeek O'Mine 是一个基于 DeepSeek 官方开源 `chat-demo` 和 DeepSeek API 的聊天工具。
它是独立社区项目，不代表 DeepSeek 官方产品。

目标是一个完整的在线聊天产品：

- 默认使用账号、云端历史和跨设备同步。
- API Key 默认保存在服务端，由服务端代理 DeepSeek 请求。
- 保留官方 `chat-demo` 的 UI 风格和交互习惯。
- 提供接近 Claude / ChatGPT 的聊天体验，包括流式回复、工具过程和清晰的失败恢复。
- 支持可组合的 Skill、远程 MCP 和受约束的 JSON-Render。
- 后端开源，并能在边缘运行时部署。

本地模式是可选的部署或运行方式，不是主产品的默认形态。

## 产品原则

1. 官方 UI 是视觉和交互基线。新增能力应融入现有侧栏、消息和设置体系，不做无关重设计。
2. 云端账号和同步是默认路径。离线缓存、无账号模式和自托管本地模式可以保留，但不能反过来限制主产品。
3. 浏览器不持有或持久化 DeepSeek API Key。客户端通过自己的登录会话调用后端，由后端使用云端保存的 Key 请求 DeepSeek。
4. 模型输出、Skill 清单、MCP 返回值和 JSON-Render 文档都视为不可信输入。
5. 产生写入、删除、发布等外部副作用的工具操作需要权限检查；高风险操作需要在界面中确认。
6. 保持 MIT 许可证、上游版权和归属信息，不暗示与 DeepSeek 官方存在关联。
7. 可复用优先：遇到同类能力时，先评估 DeepSeek harness、官方 `chat-demo` 或成熟依赖中的现成实现；能安全复用就不要自行重造轮子。复用前仍需检查许可证、安全边界和与目标架构的适配性。

## 当前仓库

当前仓库已迁移为 pnpm workspace，Web 端已接入服务端代理：

- `apps/web` 是 React 18、TypeScript、Rspack、Zustand、`idb`、`fflate` 客户端。
- `apps/server` 是 TypeScript + Hono 服务端，包含 GitHub OAuth 会话、加密 Key 存储、聊天 / 附件 / 语音代理，以及 Node / Cloudflare Workers adapter。
- `packages/contracts` 保存前后端共享协议、上游 SSE 事件类型和运行时校验。
- `packages/json-render` 保存版本化 JSON UI schema、围栏提取和结构限制校验。
- Web 默认通过同源 `/api` 接口访问服务端，也可通过 `SDOM_API_BASE_URL` 指向独立后端，不再直接请求 DeepSeek API。
- DeepSeek API Key 只加密保存在服务端，浏览器不持久化明文。
- 会话文本已支持云端同步；IndexedDB 按账号使用 `chat-demo:<userId>` 作为离线缓存。
- 同步使用 IndexedDB outbox、会话 revision、删除墓碑和冲突副本，支持离线恢复。
- 思考、搜索、TTS 音色和位置设置已支持云端同步；主题、语言和侧栏状态保持设备本地。
- 附件元数据随会话同步，附件原件和对象存储尚未进入云端同步。
- 附件和 ASR multipart 以限长流转发，不在服务端整体缓冲。
- 聊天状态集中在 `apps/web/src/services/chat/store.ts`。
- 前端 API 和 SSE 传输位于 `apps/web/src/services/api/`。
- 主回答已支持受约束的 JSON-Render、服务端二次校验和 Markdown 回退；当前 action 仅限复制和发起 prompt。
- 主题 token 位于 `apps/web/src/app/theme.css`。
- 文案必须同时维护 `apps/web/src/i18n/zh.ts` 和 `apps/web/src/i18n/en.ts`。
- GitHub OAuth 登录、Key 设置以及聊天、附件、语音代理均已接入 Web 客户端。
- Worker adapter 使用免费 D1 保存账号、设置和分块会话快照；Node adapter 继续使用本地文件存储。
- 临时分享保存创建时的当前分支快照，token 公开只读，默认 3 天、可设置 1–30 天；不得暴露附件原件或 API Key。

## 目标架构

引入后端时迁移为 pnpm workspace：

```text
apps/
  web/                 React 聊天应用
  server/              账号、云同步、API 代理、MCP 网关
packages/
  contracts/           前后端共享协议与运行时校验
  skills/              Skill manifest 和运行时
  json-render/         JSON UI schema 与安全渲染器
docs/                  必要的设计与协议说明
```

后端默认使用 TypeScript + Hono，坚持 Web Fetch / Streams 边界，并通过 adapter 支持
Cloudflare Workers、Deno、Bun 或 Node 等运行环境。数据库和对象存储不要直接耦合到具体云厂商。

## 聊天与同步

- 云端账号数据是跨设备同步的主数据源，IndexedDB 用作快速读取和离线缓存。
- 默认同步会话、设置和必要的附件元数据；API Key 单独处理，不进入普通会话载荷。
- 离线时允许继续操作，恢复连接后同步未提交的修改，不能静默覆盖用户的新内容。
- 多设备冲突需要可恢复策略，至少保留较新的版本或冲突副本。
- 数据结构需要版本号，并为已有本地会话和历史 ZIP 提供迁移路径。
- 云端同步不能长期依赖完整会话快照；大历史应使用增量 mutation、分页或分块存储。
- 可选本地模式必须作为明确模式实现，不能改变云端默认路径的接口和数据模型。

## API Key 与 API 代理

- DeepSeek API Key 保存在服务端，并使用部署环境提供的密钥或加密存储进行保护。
- 浏览器只保存登录会话，不把 API Key 写入 `localStorage`、IndexedDB、URL、日志或前端错误对象。
- 首次录入或更换 Key 时可以安全提交给服务端，但提交后客户端不保留明文。
- 聊天、文件上传、语音和其他 DeepSeek 请求默认由后端代理。
- 后端流式转发 DeepSeek 的 SSE 响应，并支持取消、断线处理和使用宽松的超时。
- 大请求体和流式响应必须沿 Web Streams 边界转发，不能在边缘 handler 中用
  `formData()`、`arrayBuffer()` 或 `text()` 整体缓冲。
- 大文件、断点续传和对象留存通过可替换的对象存储 adapter 处理，不把具体云厂商写入业务层。
- 服务端日志不得记录 API Key、鉴权头和完整请求敏感内容。

## Skills 与 MCP

- Skill 使用带版本号的 manifest，至少包含 ID、说明、输入 schema、所需工具和权限声明。
- 首期 MCP 支持远程 Streamable HTTP；边缘环境不假设可以启动 `stdio` 子进程。
- MCP 凭据和连接默认由后端管理，浏览器只调用自己的后端会话。
- 工具调用保留权限检查，并对高风险副作用请求用户确认。
- 当前不设计配额、速率限制或审计系统；除非后续明确要求，不要提前加入这些机制。
- 超时不要设置得过于激进。长时间运行的 Skill 或 MCP 调用应使用宽松、可配置的超时，并允许用户取消。
- UI 展示准备、调用中、成功、失败和可重试状态，具体细节可以按需展开。

## JSON-Render

- 模型只输出带版本号的 JSON，不输出任意 HTML、JS、CSS 或可执行表达式。
- JSON 映射到静态注册的 React 组件白名单，不动态加载模型指定的代码。
- 服务端和客户端都校验 schema；无效、未知或不兼容的 UI 回退到 Markdown。
- Action 只能由用户手势触发，并遵守与普通工具调用相同的权限规则。
- 新组件需要支持官方主题、深浅色、移动端和基本键盘可访问性。
- 初版保持简单，优先支持 Markdown、Callout、Card、Table、Chart、Form、Code 等基础结构。

## UI 与编码约定

- 使用现有 `--dsw-*` / `--ds-*` 主题变量和 CSS Modules，不另建一套视觉系统。
- 所有用户可见文本进入中英文 i18n。
- 新功能检查桌面和移动端；流式任务必须可停止、可重试、可恢复。
- 保持 TypeScript strict，外部输入先按 `unknown` 校验。
- 使用 pnpm 和现有 Rspack 工具链，不进行无关的大版本升级。
- 不提交 `.env`、凭据、OAuth token 或 API Key。
- 重要的协议或数据结构变化需要简短记录，但不要为普通实现额外制造流程。

## 开发顺序

1. 服务端代理、GitHub OAuth、共享协议和 Web 接入已完成。
2. 云端会话同步、设置同步和离线缓存第一切片已完成，继续处理附件原件与对象存储。
3. 加入 Skill 与远程 MCP。
4. JSON-Render 基础切片已完成，继续补真实模型评测、移动端/键盘回归和受权限控制的高级 action。

## 验证

代码修改后至少运行：

```sh
pnpm type
pnpm lint
pnpm build
```

涉及界面时，再做桌面/移动端、中英文和深浅色的必要冒烟检查。

## AGENTS.md 维护

产品范围或技术方向变化时更新本文件。若任务与这些原则冲突，先指出冲突并确认，不要静默偏离。
