# Sweet DeepSeek O'Mine

English | [简体中文](README.zh-CN.md)

An independent community chat app based on DeepSeek's open-source `chat-demo` and the DeepSeek API. It is not an official DeepSeek product.

The repository now uses a pnpm workspace. The server includes GitHub OAuth, encrypted API key storage, and a streaming chat proxy. The web app temporarily keeps the existing browser-direct mode until those endpoints are integrated.

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

The web UI does not yet expose the GitHub login flow. See [authentication and API keys](docs/authentication.md) for the server endpoints and security model.

To build the static site:

```sh
pnpm build
```

The output is written to `apps/web/dist/`. Deploy it to a static web server or open `apps/web/dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

The current web client still stores its API key and settings in localStorage and conversations in IndexedDB. The server provides GitHub OAuth sessions and AES-256-GCM encrypted key storage, but the web client has not switched to the server proxy yet.

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

[apps/web/rspack.config.ts](apps/web/rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer })` to customize the API origin and development server proxy.

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
