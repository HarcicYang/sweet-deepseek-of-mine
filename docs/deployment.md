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

Workers 配置位于 `apps/server/wrangler.jsonc`，使用免费 D1 保存账号、设置和分块会话快照。

1. 构建前端：`pnpm --filter @sweet-deepseek/web build`
2. 应用远程数据库 migration：

   ```sh
   cd apps/server
   pnpm worker:migrate:remote
   ```

3. 首次创建 Worker 时，把 secrets 写入 `.dev.vars.production`：

   ```sh
   APP_MASTER_KEY=...
   GITHUB_CLIENT_ID=...
   GITHUB_CLIENT_SECRET=...
   ```

4. 部署：

   ```sh
   pnpm exec wrangler deploy --secrets-file .dev.vars.production
   ```

Worker 已存在后，单独更新某项 secret 可以使用 `wrangler secret put <NAME>`。

GitHub OAuth App 的回调地址必须指向后端公开域名的
`/api/auth/github/callback`。当前配置的自定义域名是 `https://sdom.harcic.me`。

Worker 默认同时提供 `apps/web/dist` 和 `/api`，这是最简单的单服务部署方式。前端也可以单独
部署；此时设置 `SDOM_API_BASE_URL`，并把前端 origin 加入 `APP_ALLOWED_ORIGINS`。

## 数据边界

- 账号、设置、会话元数据和会话快照位于后端存储。
- 附件元数据随会话同步，附件原件目前只保存在设备本地。
- API Key 只保存服务端加密密文，不进入浏览器持久化。
