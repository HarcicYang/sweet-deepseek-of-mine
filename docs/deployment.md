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

推荐生产环境在 Node 服务前方使用反向代理，把前端静态资源和 `/api` 合并为同源部署。

```sh
pnpm dev:server
```

## Cloudflare Workers

Workers 配置位于 `apps/server/wrangler.jsonc`，使用免费 D1 保存账号、设置、分块会话快照和
分块临时分享快照。

1. 构建前端：`pnpm --filter @sweet-deepseek/web build`
2. 应用远程数据库 migration：

   ```sh
   cd apps/server
   pnpm worker:migrate:remote
   ```

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

Worker 默认同时提供 `apps/web/dist` 和 `/api`，这是最简单的单服务部署方式。前端也可以单独
部署；此时设置 `SDOM_API_BASE_URL`，并把前端 origin 加入 `APP_ALLOWED_ORIGINS`。

## 数据边界

- 账号、设置、会话元数据和会话快照位于后端存储。
- 附件元数据随会话同步，附件原件目前只保存在设备本地。
- API Key 只保存服务端加密密文，不进入浏览器持久化。
