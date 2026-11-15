# Sweet DeepSeek O'Mine

English | [简体中文](README.md)

An independent community chat tool (unofficial product) developed based on DeepSeek's official `chat-demo` and API. Built with a pnpm workspace architecture, it provides a complete chat experience with separated frontend and backend, as well as secure credential management.

## Core Features

- **Multi-Session Management**: Supports auto-generated titles, renaming, deletion, message branch switching, and regeneration.
- **Secure Proxy**: Authenticated via GitHub OAuth. DeepSeek API Keys are encrypted and stored on the server using AES-256-GCM, and all API requests are proxied by the same-origin backend, keeping them hidden from the browser.
- **Cloud Sync & Caching**: Sessions and settings support cloud synchronization, account-isolated IndexedDB caching, offline outbox, and conflict replica handling.
- **Multimodality & Rich Text**: Supports streaming responses, deep thinking, web search, link reading, and source citations; supports Markdown, syntax highlighting, KaTeX formulas, and Mermaid diagrams.
- **Generative UI**: Server-validated JSON-Render cards, carousels, tables, charts, and code blocks with Markdown fallback and safe copy/continue actions.
- **Multimedia Interaction**: Supports drag-and-drop attachment uploads, voice input, and text-to-speech reading.
- **Personalization**: Supports bilingual (English/Chinese), dark/light themes, mobile adaptation, and history import/export.

## Quick Start

This project requires **Node.js 22.12+** and **pnpm**.

### 1. Clone & Install

```sh
git clone [https://github.com/HarcicYang/sweet-deepseek-of-mine.git](https://github.com/HarcicYang/sweet-deepseek-of-mine.git)
cd sweet-deepseek-of-mine
pnpm install

```

### 2. Configure Environment Variables

1. Create an OAuth App in GitHub and set the callback URL to: `http://localhost:8090/api/auth/github/callback`.
2. Copy `.env.example` to `.env`, and fill in your `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.
3. Run the following command to generate a 32-byte master key and write it to `.env`:

```sh
openssl rand -base64 32

```

### 3. Run the Services

Execute the following commands in two separate terminals:

```sh
pnpm dev         # Start the frontend development server (http://localhost:8090)
pnpm dev:server  # Start the Hono backend service (http://localhost:8787)

```

> **Note**: The full application requires the Hono backend for same-origin `/api` forwarding and cannot run online chat with just a static `index.html`.
> For detailed deployment schemes, refer to [Authentication & API Key](https://www.google.com/search?q=docs/authentication.md) and [Deployment Guide](https://www.google.com/search?q=docs/deployment.md).

---

## Project Structure

```text
apps/
  web/              React chat client
  server/           TypeScript + Hono backend
packages/
  contracts/        Shared frontend/backend protocols and runtime validation
  json-render/      Versioned JSON UI schema and validation
docs/               Architecture and protocol documentation

```

## Development Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Start frontend development server |
| `pnpm dev:server` | Start Hono backend service |
| `pnpm build` | Build production artifacts (`apps/web/dist/`) |
| `pnpm type` | TypeScript type checking |
| `pnpm lint` | oxlint code linting |
| `pnpm test` | Run backend tests |
| `pnpm format` | oxfmt code formatting |

---

## Data & Privacy

* **API Key Protection**: API keys are encrypted and stored exclusively on the server using AES-256-GCM and are never saved locally in the browser.
* **Data Synchronization**: Session text, thinking processes, search results, and related settings are synchronized to the cloud and cached in `chat-demo:<userId>` IndexedDB.
* **Import & Export**: Supports importing and exporting history in ZIP format (exported content includes sessions and raw images, excluding API keys and sensitive credentials).

For more synchronization protocols and design details, please refer to the [Cloud Session Sync Guide](https://www.google.com/search?q=docs/sync.md).

---

## License

[MIT](https://www.google.com/search?q=LICENSE) © HarcicYang
