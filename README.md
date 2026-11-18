## Sweet DeepSeek O' Mine

English | [简体中文](README.zh-CN.md)

An independent, community-built chat client built on DeepSeek's official `chat-demo` and API — an attempt to take the DeepSeek chat experience further.

**Not an official product.**

[Demo on Cloudflare Workers](https://sdom.harcic.me/)

## Features

- **Multiple conversations**: auto-generated titles, plus rename, delete, message branching and regeneration.
- **Secure proxy**: GitHub OAuth sign-in; API keys encrypted server-side with AES-256-GCM, all requests forwarded by a same-origin backend.
- **Multiple model providers**: use Pi's complete provider catalogs and protocol implementations, plus custom OpenAI/Anthropic/Responses-compatible endpoints. DeepSeek remains the default provider.
- **Cloud sync and caching**: conversations and settings sync to the cloud; per-account IndexedDB cache, offline outbox, conflict copies.
- **Installable PWA**: install to the home screen and start from a cached app shell; cached chats remain readable offline while network-only actions wait for a connection.
- **Multimodal and rich text**: streaming, deep thinking, web search, link reading and citations; full Markdown, syntax highlighting, KaTeX and Mermaid rendering; tables can be copied, downloaded or viewed fullscreen.
- **Generative UI**: server-validated JSON-Render structures (cards, carousels, stats, steps, charts, collapsible details, code blocks), falling back to Markdown.
- **Remote MCP tools**: add Streamable HTTP MCP servers per account with static headers or OAuth; shares the tool timeline with web search; non-read-only tools need confirmation.
- **Skills**: import and export Harness-compatible text bundles (`SKILL.md` plus relative-path resources); requests carry only name and description, with the body loaded on demand via `skill` and resources via `read_skill_resource`, or called directly with `/name`.
- **Temporary sharing**: read-only snapshot links valid for 1–30 days; visitors can't send messages or get original attachments.
- **Custom instructions**: account-level system prompt supplement, synced across devices.
- **Multimedia**: drag-and-drop attachments, voice input and read-aloud.
- **Personalization**: bilingual UI, light and dark themes, mobile layout, history import/export.

## Getting started

You'll need **Node.js 22.19+** and **pnpm**.

### 1. Clone and install

```sh
git clone https://github.com/HarcicYang/sweet-deepseek-of-mine.git
cd sweet-deepseek-of-mine
pnpm install
```

### 2. Configure environment variables

1. Create a GitHub OAuth App and set the callback URL to `http://localhost:8090/api/auth/github/callback`.
2. Copy `.env.example` to `.env` and fill in your `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
3. Generate a 32-byte master key and add it to `.env`:

```sh
openssl rand -base64 32
```

### 3. Run the services

Use two terminals:

```sh
pnpm dev         # frontend dev server (http://localhost:8090)
pnpm dev:server  # Hono backend (http://localhost:8787)
```

> **Note**: online chat needs the Hono server to proxy same-origin `/api` requests — opening the static `index.html` on its own won't work. For deployment details, see [Authentication and API keys](docs/authentication.md) and [Deployment](docs/deployment.md).

### 4. Agent-assisted deployment

> **Too lazy to follow the manual steps?**
>
> Send this to your coding agent:
>
> > Please deploy Sweet DeepSeek O' Mine according to https://github.com/HarcicYang/sweet-deepseek-of-mine/blob/main/docs/AGENT_INSTRUCTION.md and complete the real browser acceptance checks.

The agent should read [AGENT_INSTRUCTION.md](docs/AGENT_INSTRUCTION.md), choose Cloudflare Workers Free or a Node deployment with you, and never print or commit secrets.

---

## Project layout

```text
apps/
  web/               React chat client
  server/            TypeScript + Hono backend
packages/
  contracts/         Shared protocols and runtime validation
  json-render/       Versioned JSON UI schema and validation
  skills/            Harness-compatible skill parsing, catalog and loading format
docs/                Architecture and protocol notes
```

---

## Development commands

| Command           | What it does                            |
| ----------------- | --------------------------------------- |
| `pnpm dev`        | Start the frontend dev server           |
| `pnpm dev:server` | Start the Hono backend                  |
| `pnpm build`      | Build for production (`apps/web/dist/`) |
| `pnpm type`       | TypeScript type check                   |
| `pnpm lint`       | Lint with oxlint                        |
| `pnpm test`       | Run server tests                        |
| `pnpm format`     | Format with oxfmt                       |

---

## Data and privacy

- **API keys**: DeepSeek and additional provider keys are stored encrypted on the server (AES-256-GCM) and never written to browser storage.
- **MCP credentials**: MCP config is isolated per account. Request headers, OAuth client secrets and OAuth tokens are all encrypted and stored server-side; they're never sent back to the browser.
- **Skill data**: skill bundles and text resources are stored per account on the backend. Shared conversations strip skill content from tool results.
- **Data sync**: conversation text, reasoning, search content and related settings sync to the cloud and are cached in the `chat-demo:<userId>` IndexedDB database.
- **Import/export**: history can be imported and exported as ZIP. The archive contains conversations and original images; it does not contain API keys or other credentials.

For the sync protocol and design details, see [Cloud conversation sync](docs/sync.md).

---

## License

[MIT](LICENSE) © HarcicYang
