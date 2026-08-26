# OX Code

<div align="center">

**AI-powered coding IDE** — Electron + React + Monaco Editor

Connects to any OpenAI-compatible API router with full agent capabilities: file editing, terminal access, git integration and checkpoints.

</div>

---

## ✨ Features

### Core IDE
- 📁 **Workspace explorer** — open any local folder, tree view with context menu, **git status dots** (modified/added/deleted) per file
- ✏️ **Monaco editor** — VS Code's editor with tabs, syntax highlighting, auto-save detection
- 💻 **Real terminal** — persistent-cwd shell sessions with streamed output
- 🔍 **Code search** — project-wide text & regex search
- 💾 **Persistent workspace** — last opened folder, tabs and expanded folders are restored on launch
- ⚡ **Incremental indexing** — the symbol index updates per-file on save/change (no full re-index)

### AI Agent
- 🤖 **Agent loop with function calling** — 15 real tools: read/create/edit/delete/rename files, search, symbol lookup, run commands, run tests, git status/diff/log, **MCP tools**
- 📋 **Plan Mode** — analyze-first workflow with Approve / Cancel before execution
- ⏮️ **Checkpoints** — every file mutation is snapshotted → one-click Rollback
- 🔀 **Pending changes** — multi-file diff viewer with per-file Accept / Reject and next/prev navigation
- 💬 **Streaming chat** — markdown rendering, code copy, apply-to-editor, per-tool execution timeline, message queue
- 🧩 **Multi-agent pipelines** — Build Feature (Architect→Coder→Tester→Reviewer), Fix & Verify, Quality Pass

### Intelligence
- 🧠 **Project indexer** — symbol index + language/dependency/entry-point analysis
- 📌 **Context manager** — pin files, token estimation, smart context building, **`@`-mentions** (`@file.ts` in chat attaches the file)
- 🩺 **Health tab** — auto-detected validation commands (tests / typecheck / lint / build)
- 📜 **Project rules** — per-project memory stored locally (`rules.md`)
- 📝 **Session instructions** — per-chat directives (e.g. "always answer in Persian") with highest priority
- ⚡ **Inline completions** — Copilot-style ghost text, toggleable in Settings

### Extensibility & Updates
- 🔌 **MCP support** — connect external tool servers (Model Context Protocol, stdio transport); agent tools are injected into the model context automatically
- 🔄 **Auto-update** — checks GitHub Releases in the background, download & install from the Command Palette
- 📦 **Installer + portable** — NSIS setup and portable `.exe` via electron-builder

### Settings
- Base URL, API Key, model picker (fetched from `/v1/models` of your router)
- Temperature, max tokens, timeout, streaming, retries + connection test
- Model quota/status monitoring

## 🔌 MCP servers

Connect any [Model Context Protocol](https://modelcontextprotocol.io) server (stdio transport):

1. `Ctrl+Shift+P` → **MCP: Add Tool Server…**
2. Give it a name, a command (e.g. `npx`) and args (e.g. `-y @modelcontextprotocol/server-fetch`)
3. The server's tools are listed in the agent context — the model can call them with the `mcp_tool` tool

Servers are stored in `mcp-servers.json` inside the app's user-data directory.

## ⌨️ Shortcuts

| Keys | Action |
|---|---|
| `Ctrl+Shift+P` | Command Palette |
| `Ctrl+S` | Save file |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+J` | Toggle AI panel |
| `` Ctrl+` `` | Toggle terminal |
| `Ctrl+,` | Settings |

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org) 18+
- npm 9+

### Development

```bash
git clone https://github.com/<your-username>/ox-code.git
cd ox-code
npm install
npm run dev
```

### Production build

```bash
npm run build    # compile main / preload / renderer
npm run dist     # Windows installer (NSIS) + portable .exe (electron-builder)
```

Releases published to GitHub Releases enable the built-in **auto-updater**.

### Connecting an AI provider

OX Code works with **any OpenAI-compatible endpoint**:

1. Launch the app and press `Ctrl+,` to open **Settings**
2. Set your **Base URL** (e.g. `https://opencode.ai/zen/v1`, or a local router like `http://localhost:1234/v1`)
3. Paste your **API Key**
4. Pick a model from the list fetched from your provider's `/v1/models`

> 🔒 Your key is stored only in the app's local settings — it is never hardcoded in the source or sent anywhere except your chosen provider.

## 🏗️ Architecture

```
src/
├── main/                  # Electron main process
│   ├── index.ts           # window / app lifecycle
│   ├── ipc.ts             # IPC registry
│   └── services/
│       ├── files.ts       # workspace-safe file ops + code search
│       ├── git.ts         # git command runner
│       ├── terminal.ts    # persistent-cwd shell sessions
│       ├── indexer.ts     # symbol index + project intelligence
│       ├── watcher.ts     # workspace change watcher
│       ├── analyzer.ts    # architecture analysis
│       ├── validator.ts   # validation-step detection
│       ├── mcp.ts         # MCP stdio client (external tool servers)
│       └── ai.ts          # OpenAI-compatible client (SSE streaming, retries)
├── updater.ts             # electron-updater (GitHub Releases)
├── preload/index.ts       # contextBridge API (window.oxcode)
└── renderer/src/
    ├── ai/prompts.ts      # system prompts (provider-agnostic)
    ├── agent/
    │   ├── tools.ts       # 14 real agent tools
    │   ├── runner.ts      # tool-calling agent loop + plan mode
    │   └── checkpoints.ts # snapshot / rollback
    ├── core/              # context engine, intent detection, risk, verify
    ├── store/             # zustand stores (workspace, chat, ui, settings…)
    └── components/        # TitleBar, Sidebar, Editor, AI panel, Terminal…
```

**AI request flow:**

```
UI → Agent → window.oxcode.ai.chat → main/services/ai.ts → your provider → selected model
```

The model is never hardcoded — it is chosen in Settings from your provider's `/v1/models`.

## 🛡️ Security notes

- Renderer runs with `contextIsolation: true` and `nodeIntegration: false`; all privileged operations go through a typed `contextBridge` API.
- Destructive agent operations (`delete_file`, dangerous shell commands) require explicit approval dialogs.
- All file operations are sandboxed to the opened workspace root.

## 🗺️ Roadmap

- [x] Incremental indexing
- [x] Multi-agent pipeline (Architect / Coder / Tester / Reviewer)
- [x] Architecture analysis (import graph, circular deps)
- [x] PR description generation
- [x] MCP support
- [ ] Cloud sync for settings & sessions
- [ ] Extension API

## 📄 License

MIT
