# OX Code

<div align="center">

**AI-powered coding IDE** — Electron + React + Monaco Editor

Connects to any OpenAI-compatible API router with full agent capabilities: file editing, terminal access, git integration and checkpoints.

</div>

---

## ✨ Features

### Core IDE
- 📁 **Workspace explorer** — open any local folder, tree view with context menu
- ✏️ **Monaco editor** — VS Code's editor with tabs, syntax highlighting, auto-save detection
- 💻 **Real terminal** — persistent-cwd shell sessions with streamed output
- 🔍 **Code search** — project-wide text & regex search

### AI Agent
- 🤖 **Agent loop with function calling** — 14 real tools: read/create/edit/delete/rename files, search, symbol lookup, run commands, run tests, git status/diff/log
- 📋 **Plan Mode** — analyze-first workflow with Approve / Cancel before execution
- ⏮️ **Checkpoints** — every file mutation is snapshotted → one-click Rollback
- 🔀 **Pending changes** — diff viewer with Accept / Reject per file
- 💬 **Streaming chat** — markdown rendering, code copy, apply-to-editor, per-tool execution timeline

### Intelligence
- 🧠 **Project indexer** — symbol index + language/dependency/entry-point analysis
- 📌 **Context manager** — pin files, token estimation, smart context building
- 🩺 **Health tab** — auto-detected validation commands (tests / typecheck / lint / build)
- 📜 **Project rules** — per-project memory stored locally (`rules.md`)
- ⚡ **Inline completions** — Copilot-style ghost text, toggleable in Settings

### Settings
- Base URL, API Key, model picker (fetched from `/v1/models` of your router)
- Temperature, max tokens, timeout, streaming, retries + connection test
- Model quota/status monitoring

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
npm run dist     # Windows portable .exe (electron-builder)
```

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
│       └── ai.ts          # OpenAI-compatible client (SSE streaming, retries)
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

- [ ] Incremental indexing
- [ ] Multi-agent pipeline (Architect / Coder / Tester / Reviewer)
- [ ] Architecture analysis reports
- [ ] PR description generation

## 📄 License

MIT
