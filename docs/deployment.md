# 部署

前端和后端可以分开部署。前端默认请求同源 `/api`，也可以通过构建变量指向独立后端。

## 前端

同源部署不需要额外配置：

```sh
pnpm --filter @sweet-deepseek/web build
```

独立静态托管时设置后端公开地址：

```sh
SDOM_API_BASE_URL=https://api.example.com pnpm --filter @sweet-deepseek/web build
```

产物位于 `apps/web/dist/`，可以部署到任意静态托管服务。

## Node / ECS / PC

Node adapter 使用 `.data/` 下的文件存储，适合单实例自托管。复制 `.env.example` 为 `.env`，
至少配置 GitHub OAuth、`APP_MASTER_KEY` 和公开来源：

- `APP_ORIGIN`：用户访问的前端 origin，OAuth 成功后跳回这里。
- `API_ORIGIN`：后端公开 origin，用于生成 GitHub OAuth 回调地址。
- `APP_ALLOWED_ORIGINS`：允许调用 API 的其他前端 origin，英文逗号分隔。
- `COOKIE_SECURE`：HTTPS 部署必须为 `true`。
- `COOKIE_SAME_SITE`：同站使用 `lax`；独立站点的跨站前端使用 `none`，并必须启用 HTTPS。
- `MCP_ALLOW_PRIVATE_NETWORK`：默认 `false`；单用户本地部署需要访问局域网 MCP 时才设为 `true`。
- `MCP_OAUTH_DB_PATH`：Node 自托管时 OAuth 状态与 token 的加密存储文件路径。
- `SKILL_DB_PATH`：Node 自托管时账号级 Skill 的存储文件路径，默认 `.data/skills.json`。
- `MCP_OAUTH_CLIENTS`：可选 JSON 数组，用于给不支持动态客户端注册的 MCP 提供方配置部署级
  Client ID / Secret。普通用户无需接触该配置。
- `REQUEST_BODY_LIMIT_CHAT_BYTES`：聊天 JSON 请求上限，默认 20 MiB。
- `REQUEST_BODY_LIMIT_SYNC_BYTES`：单次会话同步 JSON 上限，默认 20 MiB。
- `REQUEST_BODY_LIMIT_SETTINGS_BYTES`：设置和同步删除请求上限，默认 256 KiB。
- `REQUEST_BODY_LIMIT_API_KEY_BYTES`：API Key 设置请求上限，默认 16 KiB。
- `REQUEST_BODY_LIMIT_SPEECH_BYTES`：TTS 请求上限，默认 1 MiB。

这些上限按实际读取字节执行，不依赖 `Content-Length`。Node 可通过 `.env` 调整，Worker 可通过
`wrangler.jsonc` 的 `vars` 调整。

推荐生产环境在 Node 服务前方使用反向代理，把前端静态资源和 `/api` 合并为同源部署。

```sh
pnpm dev:server
```

## Cloudflare Workers

Workers 配置位于 `apps/server/wrangler.jsonc`，使用免费 D1 保存账号、设置、分块会话快照、
分块临时分享快照、账号级 MCP 配置和账号级 Skill。

1. 构建前端：`pnpm --filter @sweet-deepseek/web build`
2. 应用远程数据库 migration：

   ```sh
   cd apps/server
   pnpm worker:migrate:remote
   ```

   该命令会应用 `0001`–`0007`：`0003` 创建账号级 MCP 服务表，`0004` 增加认证方式和
   加密 OAuth 状态/token 存储，`0005` 清除旧版本中用户级 OAuth Client 配置的残留，
   `0006` 创建账号级 Skill 表，`0007` 增加 Skill Bundle 文本资源并将旧单文件 Skill
   迁移为包含 `SKILL.md` 的单文件 Bundle。

3. 创建生产环境使用的 GitHub OAuth App：
   - 打开 GitHub 的 `Settings → Developer settings → OAuth Apps → New OAuth App`。
   - `Application name` 可以填写 `Sweet DeepSeek O'Mine`。
   - `Homepage URL` 填写用户访问的前端地址，默认部署为 `https://sdom.harcic.me`。
   - `Authorization callback URL` 填写 `https://sdom.harcic.me/api/auth/github/callback`。
   - 注册后复制 `Client ID`，再生成并立即保存 `Client secret`。GitHub 通常只显示一次 secret。

   如果使用其他域名，`Homepage URL` 对应 `APP_ORIGIN`；回调地址必须精确等于
   `API_ORIGIN` 加上 `/api/auth/github/callback`。不要复用本地开发 OAuth App 的
   `localhost` 回调地址。

4. 首次创建 Worker 时，把真实值写入仓库外、仅当前用户可读的 secrets 文件。例如：

   ```sh
   mkdir -p ~/.config/sweet-deepseek-o-mine
   chmod 700 ~/.config/sweet-deepseek-o-mine
   cp .dev.vars.example ~/.config/sweet-deepseek-o-mine/production.env
   chmod 600 ~/.config/sweet-deepseek-o-mine/production.env
   openssl rand -base64 32
   ```

   然后填写：

   ```dotenv
   APP_MASTER_KEY=<刚生成的 Base64 主密钥>
   GITHUB_CLIENT_ID=<OAuth App 的 Client ID>
   GITHUB_CLIENT_SECRET=<OAuth App 的 Client secret>
   ```

   不要把这三个值提交到 Git、粘贴到 issue、聊天记录或部署日志中。也不要把 secrets
   保存到不支持 Unix 权限的共享盘或外接盘；部分文件系统会把文件权限固定为 `0777`。

5. 部署：

   ```sh
   pnpm exec wrangler deploy \
     --secrets-file "$HOME/.config/sweet-deepseek-o-mine/production.env"
   ```

Worker 已存在后，单独更新某项 secret 可以使用 `wrangler secret put <NAME>`。

MCP OAuth 的 Client ID、Secret 和回调由部署统一管理。GitHub MCP 会自动复用上面的
GitHub 登录 OAuth App，因此不需要再创建一个 GitHub OAuth App。其他不支持动态客户端注册的
MCP 提供方可以通过可选的 `MCP_OAUTH_CLIENTS` secret 配置：

```json
[
  {
    "resource": "https://mcp.example.com",
    "clientId": "<provider client id>",
    "clientSecret": "<provider client secret>"
  }
]
```

通常无需设置 `redirectUrl`，服务会使用 `API_ORIGIN` 下的 `/api/mcp/oauth/callback`。这些值只属于
部署，不会返回浏览器，也不需要用户填写。

Worker 默认同时提供 `apps/web/dist` 和 `/api`，这是最简单的单服务部署方式。前端也可以单独
部署；此时设置 `SDOM_API_BASE_URL`，并把前端 origin 加入 `APP_ALLOWED_ORIGINS`。

## 数据边界

- 账号、设置、会话元数据和会话快照位于后端存储。
- MCP 服务地址按账号保存，请求头使用服务端主密钥加密；浏览器只读取请求头名称。
- MCP OAuth 的 client information、PKCE verifier、discovery state 和 token 同样由服务端加密保存。
- 附件元数据随会话同步，附件原件目前只保存在设备本地。
- API Key 只保存服务端加密密文，不进入浏览器持久化。
