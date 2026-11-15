# Sweet DeepSeek O'Mine

English | [简体中文](README.zh-CN.md)

An independent community chat app based on DeepSeek's open-source `chat-demo` and the DeepSeek API. It is not an official DeepSeek product.

The repository uses a pnpm workspace. The web app signs in through GitHub and sends chat, attachment, and speech requests through the same-origin server proxy. DeepSeek API keys never enter browser storage.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/HarcicYang/sweet-deepseek-of-mine.git
cd sweet-deepseek-of-mine
pnpm install
pnpm dev
```

Open http://localhost:8090.

### Local server

The server listens on `http://localhost:8787`; the web development server proxies `/api` to it.

1. Create a GitHub OAuth App with the callback URL `http://localhost:8090/api/auth/github/callback`.
2. Copy `.env.example` to `.env` and fill in `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
3. Generate a 32-byte `APP_MASTER_KEY` with `openssl rand -base64 32`.
4. Run the web app and server in separate terminals:

```sh
pnpm dev
pnpm dev:server
```

See [authentication and API keys](docs/authentication.md) for the login flow, endpoints, and security model.

To build the static site:

```sh
pnpm build
```

The output is written to `apps/web/dist/`. The complete app also requires the Hono server and a same-origin `/api` route; opening the static `index.html` alone is not enough for the online chat flow.

The frontend can also be hosted independently by building with `SDOM_API_BASE_URL`. Backend, Node/ECS, and Cloudflare Workers deployment options are documented in [deployment](docs/deployment.md).

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- GitHub sign-in, server sessions, encrypted API key storage, and the same-origin API proxy.
- Cloud session and common preference sync, account-isolated IndexedDB caches, offline outboxes, and conflict copies.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

The web client caches synced conversations and the thinking, search, text-to-speech voice, and location preferences in an account-scoped `chat-demo:<userId>` IndexedDB database. Theme, language, and sidebar state remain device-local. Attachment originals are not yet cloud-synced. DeepSeek API keys are encrypted and stored on the server, and uploaded attachments are proxied by the server.

See [cloud session sync](docs/sync.md) for revisions, deletion tombstones, offline outboxes, and conflict handling.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](apps/web/src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command           | Description                  |
| ----------------- | ---------------------------- |
| `pnpm dev`        | Start the development server |
| `pnpm dev:server` | Start the Hono server        |
| `pnpm build`      | Build into `apps/web/dist/`  |
| `pnpm type`       | Run TypeScript type checks   |
| `pnpm lint`       | Lint with oxlint             |
| `pnpm test`       | Run server tests             |
| `pnpm format`     | Format with oxfmt            |

[apps/web/rspack.config.ts](apps/web/rspack.config.ts) proxies `/api` to the local Hono server. Set `API_PROXY_TARGET` to override the development proxy target.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
apps/
  web/                 React chat client
  server/              TypeScript + Hono server
packages/
  contracts/           Shared protocols and runtime validation
docs/                  Architecture and protocol notes
```

## License

[MIT](LICENSE). The build copies the license to `apps/web/dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
