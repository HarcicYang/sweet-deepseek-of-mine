# Agent 部署手册

本文件用于让一个具备终端、Git 和浏览器操作能力的 Agent 部署
Sweet DeepSeek O' Mine。它是部署执行手册，不替代仓库根目录的 `AGENTS.md`。

## 目标

部署一个真实可用的实例，并完成端到端验收：

- 前端可以打开。
- `/api/health` 正常。
- GitHub OAuth 可以完成登录。
- 登录会话可以读取。
- 用户可以在网页中录入自己的 DeepSeek API Key。
- 设置、会话和 MCP 配置能够持久化。

不要只完成构建或只看到 health check 就宣布部署完成。

## 执行原则

1. 先阅读仓库根目录的 `AGENTS.md`、`docs/deployment.md`、
   `apps/server/wrangler.jsonc`、`.env.example` 和最新 migration。
2. 如果用户没有指定部署目标，优先推荐 Cloudflare Workers Free。用户没有稳定外网服务时，
   不要推荐 VPS、容器平台或其他需要额外付费的方案。
3. 不要输出、复制、提交或在日志中展示 `APP_MASTER_KEY`、GitHub Client Secret、
   DeepSeek API Key、OAuth token 或其他凭据。
4. 不要擅自创建付费资源、升级套餐、删除已有 Worker/D1 数据库、覆盖已有域名或执行破坏性操作。
5. 如果目标资源已经存在，先检查现状并询问用户要继续复用还是使用新名称。
6. 远程 migration、首次创建资源和修改 DNS 前，向用户说明影响并取得确认。
7. 部署相关的临时文件放在仓库外，并设置为 `0600`。不要提交真实部署配置。
8. 最终必须进行真实浏览器验收，不接受只用单元测试、构建成功或 health check 代替。

## 必须向用户确认的信息

在开始外部操作前，确认：

- 部署目标：Cloudflare Workers，还是 Node / ECS / PC。
- 最终访问域名。Cloudflare Workers 可以使用自定义域名或 `workers.dev`。
- 是否已经登录正确的 Cloudflare 账号；需要时运行 `pnpm exec wrangler whoami`。
- GitHub OAuth App 是否已经创建。若没有，引导用户创建，不要让用户把 Client Secret
  粘贴到聊天中。
- 是否允许使用默认 Worker 名和 D1 名称 `sweet-deepseek-o-mine`。

用户只需要决定部署和域名等外部选择。仓库结构、测试命令、migration 顺序和验收步骤不需要
用户逐项指导。

## 方案 A：Cloudflare Workers

这是默认推荐方案，使用 Workers Free、D1 Free 和静态资源，不引入 R2、Durable Objects、
Queues 或付费套餐。

### 1. 准备仓库和依赖

```sh
git clone https://github.com/HarcicYang/sweet-deepseek-of-mine.git
cd sweet-deepseek-of-mine
pnpm install --frozen-lockfile
```

确认 Node.js 满足 `>=22.12.0`，并检查 `pnpm --version`。

### 2. 确定公开地址和资源名称

编辑 `apps/server/wrangler.jsonc`：

- `name`：Worker 名称，默认 `sweet-deepseek-o-mine`。
- `APP_ORIGIN`：最终公开 origin，例如 `https://sdom.example.com`。
- `routes`：使用自定义域名时填写准确域名并保留 `custom_domain: true`。
- 如果使用 `workers.dev`，删除 `routes`。首次部署后把实际 `workers.dev` URL 写入
  `APP_ORIGIN`，然后再次部署。
- D1 的 `database_name` 和 `database_id` 必须对应真实数据库。

如果用户要使用自定义域名，先确认该域名已有可管理的 Cloudflare Zone。不要假设域名的 NS、
权限或证书已经正确配置。

### 3. 创建或复用 D1

优先复用属于目标 Worker 的现有 D1。没有时创建：

```sh
cd apps/server
pnpm exec wrangler d1 create sweet-deepseek-o-mine
```

将命令返回的真实 `database_id` 写入 `apps/server/wrangler.jsonc`：

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "sweet-deepseek-o-mine",
    "database_id": "<真实 database_id>",
    "migrations_dir": "migrations"
  }
]
```

不要修改已有生产数据库的 ID。若名称冲突，向用户确认新名称。

### 4. 构建和基础验证

在仓库根目录运行：

```sh
pnpm type
pnpm lint
pnpm test
pnpm build
```

然后在 `apps/server` 运行部署 dry-run：

```sh
pnpm exec wrangler deploy --dry-run
```

### 5. 创建 GitHub OAuth App

让用户亲自在 GitHub 创建 OAuth App，或由具备浏览器能力的 Agent 在用户确认后操作：

- Homepage URL：最终 `APP_ORIGIN`。
- Authorization callback URL：
  `${API_ORIGIN}/api/auth/github/callback`。
- 同源 Worker 部署时，`API_ORIGIN` 与 `APP_ORIGIN` 相同。
- 如果使用 `workers.dev`，回调 URL 必须使用首次部署后的真实地址。

用户应自行将 OAuth App 的 Client ID 和 Client Secret 填入 secrets 文件。不要让用户在聊天、
issue 或提交中粘贴 Client Secret。

### 6. 准备 secrets 文件

在仓库外创建仅当前用户可读的文件：

```sh
mkdir -p ~/.config/sweet-deepseek-o-mine
chmod 700 ~/.config/sweet-deepseek-o-mine
install -m 600 /dev/null ~/.config/sweet-deepseek-o-mine/production.env
```

文件需要包含：

```dotenv
APP_MASTER_KEY=<32-byte Base64 key>
GITHUB_CLIENT_ID=<GitHub OAuth Client ID>
GITHUB_CLIENT_SECRET=<GitHub OAuth Client Secret>
```

Agent 可以生成 `APP_MASTER_KEY` 并直接写入文件，但不得回显：

```sh
printf 'APP_MASTER_KEY=%s\n' "$(openssl rand -base64 32)" \
  > "$HOME/.config/sweet-deepseek-o-mine/production.env"
chmod 600 "$HOME/.config/sweet-deepseek-o-mine/production.env"
```

随后让用户自行追加两个 GitHub 值。部署前只检查三个 key 是否存在且非空，不输出 value。

如果使用不支持 Unix 权限的文件系统，不要把真实 secrets 放到共享盘或外接盘。

### 7. 应用远程 migration

```sh
cd apps/server
pnpm worker:migrate:remote
```

这是数据库结构变更。Agent 必须先告知用户，再执行确认。更新已有部署时，这是应用新版本前的
必要步骤。

### 8. 部署

```sh
pnpm exec wrangler deploy \
  --secrets-file "$HOME/.config/sweet-deepseek-o-mine/production.env"
```

记录：

- Worker 版本 ID。
- 最终公开 URL。
- migration 是否全部成功。

如果必须修改 `APP_ORIGIN`、域名或 OAuth callback，修正后再次部署。

### 9. 必须在浏览器中验收

使用真实浏览器完成：

1. 打开最终 URL，页面不是空白或错误页。
2. 点击“使用 GitHub 登录”，完成 GitHub OAuth 并回到应用。
3. 确认页面显示已登录用户。
4. 打开设置，确认页面正常。
5. 让用户在页面中自行输入 DeepSeek API Key。Agent 不得接收或记录该 Key。
6. 新建一个会话并发送不会产生高风险的简单问题，确认流式请求正常。
7. 刷新页面，确认登录、会话和设置仍然存在。
8. 检查浏览器控制台没有阻断功能的错误。

能够自动执行时，另外检查：

```sh
curl -fsS https://<最终域名>/api/health
curl -fsS https://<最终域名>/api/auth/session
```

第二条未登录时返回 `401` 属于预期；完成浏览器登录后应返回当前用户。

## 方案 B：Node / ECS / PC

适合单实例自托管。Node adapter 使用文件存储，不适合多个实例无共享存储地横向扩容。

### 1. 安装和配置

```sh
pnpm install --frozen-lockfile
cp .env.example .env
chmod 600 .env
```

至少设置：

- `APP_ORIGIN`
- `API_ORIGIN`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_CALLBACK_URL`
- `APP_MASTER_KEY`
- `COOKIE_SECURE=true`（生产 HTTPS）
- `COOKIE_SAME_SITE=lax`（同站前后端）
- 持久化数据目录对应的 `*_DB_PATH`

GitHub callback 必须精确等于 `GITHUB_CALLBACK_URL`。

### 2. 构建和验证

```sh
pnpm type
pnpm lint
pnpm test
pnpm build
```

### 3. 启动

```sh
pnpm --filter @sweet-deepseek/server start
```

生产环境应使用用户已有的进程管理器，例如 systemd，并配置自动重启和持久化目录。不要在没有
询问的情况下安装新的系统级服务或修改用户现有反向代理。

### 4. 前端和反向代理

`apps/web/dist/` 需要通过静态服务器提供。推荐把前端和 `/api` 放在同一个
`APP_ORIGIN` 下：

- `/` 返回前端静态资源，未知路径回退到 `index.html`。
- `/api/*` 代理到 Node 服务的 `PORT`，默认 `8787`。
- 使用 HTTPS。

如果前后端必须跨站部署，设置 `APP_ALLOWED_ORIGINS`、`COOKIE_SAME_SITE=none` 和
`COOKIE_SECURE=true`，并明确告知用户跨站 Cookie 带来的浏览器兼容风险。

### 5. 验收

完成与 Workers 相同的真实浏览器验收，并额外确认：

- 服务重启后登录会话、设置、会话和 Skill 数据仍然存在。
- 文件存储目录权限正确，只允许运行服务的用户读取。
- 反向代理没有缓冲 SSE 流。

## 失败处理

- OAuth 回到 `?auth=error`：先核对 Homepage URL、callback URL、`APP_ORIGIN`、
  `API_ORIGIN` 和环境变量是否完全一致。
- 修改域名后登录循环：检查浏览器中旧域名 Cookie，并确认 GitHub OAuth App 已更新回调。
- D1 binding 错误：检查 Worker 的 `database_id` 是否真实存在且属于当前账号。
- migration 未应用：不要在缺表状态下继续部署，先运行远程 migration。
- 页面 200 但 API 失败：检查 Worker 是否处理 `/api/*`，Node 部署检查反向代理。
- 部署后行为异常：保留错误、Worker 版本 ID 和 migration 状态，不要删除数据。

## 最终报告

向用户报告：

- 最终 URL。
- 部署目标：Workers 或 Node。
- 使用的 commit SHA。
- Worker 版本 ID，或 Node 服务状态。
- 已应用的 migration。
- 已完成的真实浏览器验收。
- 尚未完成的检查、已知风险或需要用户手动处理的事项。

不要在最终报告中包含任何 secret。
