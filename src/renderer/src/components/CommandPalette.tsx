import { useEffect, useMemo, useRef, useState } from 'react'
import type { AnalysisResultDTO } from '../types'
import { useUI } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { useSettings } from '../store/settings'
import { handleSendMessage, runPipeline, PIPELINES } from '../agent/runner'
import { simpleCompletion } from './Sidebar/GitPanel'
import { Icon } from './ui/Icon'

interface Command {
  id: string
  title: string
  category: string
  shortcut?: string
  run: () => void
}

export function CommandPalette(): React.JSX.Element | null {
  const open = useUI((s) => s.paletteOpen)
  const setOpen = useUI((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const commands = useMemo<Command[]>(() => buildCommands(), [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  const filtered = commands.filter(
    (c) => !query || `${c.category}: ${c.title}`.toLowerCase().includes(query.toLowerCase())
  )
  if (sel >= filtered.length) setSel(Math.max(0, filtered.length - 1))

  if (!open) return null

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette">
        <input
          ref={inputRef}
          value={query}
          placeholder="Type a command…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, filtered.length - 1))
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0))
            else if (e.key === 'Enter') {
              filtered[sel]?.run()
              setOpen(false)
            } else if (e.key === 'Escape') setOpen(false)
          }}
        />
        <div className="palette-list">
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`palette-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => {
                c.run()
                setOpen(false)
              }}
            >
              <span>{c.title}</span>
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="cat">{c.category}</span>
                {c.shortcut && <span className="kbd">{c.shortcut}</span>}
              </span>
            </div>
          ))}
          {!filtered.length && (
            <div className="palette-item" style={{ color: 'var(--faint)' }}>
              No matching commands — press Enter to ask AI: “{query}”
            </div>
          )}
        </div>
        {query && !filtered.some((c) => c.title.toLowerCase() === query.toLowerCase()) && (
          <div
            className="palette-item"
            style={{ borderTop: '1px solid var(--border-soft)', color: 'var(--violet)' }}
            onClick={() => {
              void handleSendMessage(query)
              setOpen(false)
            }}
          >
            <Icon name="sparkles" size={13} style={{ marginRight: 7, verticalAlign: '-3px' }} />
            Ask AI: “{query}”
          </div>
        )}
      </div>
    </div>
  )
}

function aiCommand(_title: string, prompt: string): Command['run'] {
  return () => void handleSendMessage(prompt)
}

function reviewFile(): void {
  const path = useWorkspace.getState().activePath
  if (!path) {
    useUI.getState().toast('error', 'No file open to review')
    return
  }
  void handleSendMessage(`Review the file "${path}" for bugs, security issues, performance problems and code quality. List issues by severity (CRITICAL/HIGH/MEDIUM/LOW) with line numbers.`)
}

async function explainProject(): Promise<void> {
  const info = await window.oxcode.index.projectInfo()
  await window.oxcode.index.rebuild()
  void handleSendMessage(
    `Explain this project: give a PROJECT OVERVIEW with framework, language, architecture, entry points, dependencies and potential issues.\n\nDetected index data: ${JSON.stringify(info)}`
  )
}

async function aiCommit(): Promise<void> {
  const msg = await simpleCompletion([
    { role: 'system', content: 'You write conventional commit messages. Reply ONE line only, format: type(scope): summary' },
    { role: 'user', content: 'Write a commit message summarizing the current git diff.' }
  ])
  useUI.getState().toast(msg ? 'success' : 'error', msg ? `Suggested: ${msg}` : 'AI unavailable')
}

async function analyzeArchitecture(): Promise<void> {
  const ui = useUI.getState()
  ui.toast('info', 'Analyzing dependency graph…')
  try {
    await window.oxcode.index.rebuild()
    const analysis: AnalysisResultDTO = await window.oxcode.analyze.project()
    const summary = {
      files: analysis.totalFiles,
      edges: analysis.totalEdges,
      circularDependencies: analysis.cycles.map((c: string[]) => c.join(' → ')),
      orphanFiles: analysis.orphans,
      mostImportedFiles: analysis.hubs
    }
    await handleSendMessage(
      `Act as an Architecture Agent. Here is the computed import graph analysis:\n${JSON.stringify(summary, null, 2)}\n\n` +
        `Diagnose architectural weaknesses, explain each circular dependency's risk, evaluate hub files, propose concrete improvements — then fix any issue you consider critical.`
    )
  } catch (e) {
    ui.toast('error', 'Analysis failed', (e as Error).message)
  }
}

async function generatePRDescription(): Promise<void> {  const ui = useUI.getState()
  const diff = await window.oxcode.git.run(['diff', '--stat'])
  const log = await window.oxcode.git.run(['log', '--oneline', '-8'])
  const desc = await simpleCompletion([
    { role: 'system', content: 'Write concise PR descriptions in markdown: ## Summary (3-5 bullets), ## Changes, ## Testing. No preamble.' },
    { role: 'user', content: `Write a PR description.\n\nRecent commits:\n${log.output}\n\nDiff stat:\n${diff.output}` }
  ])
  if (!desc) {
    ui.toast('error', 'Could not reach the AI model')
    return
  }
  void navigator.clipboard.writeText(desc)
  ui.toast('success', 'PR description copied to clipboard', desc.slice(0, 120) + '…')
}

async function addMcpServer(): Promise<void> {
  const ui = useUI.getState()
  const name = prompt('MCP server name (e.g. "fetch", "sqlite"):')
  if (!name) return
  const command = prompt('Command to run (e.g. "npx"):')
  if (!command) return
  const argsRaw = prompt('Arguments (space-separated, e.g. "-y @modelcontextprotocol/server-fetch"):', '')
  const args = argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : []
  const ok = await window.oxcode.mcp.add({ name, command, args })
  if (ok) {
    ui.toast('success', `MCP server "${name}" added`, 'Tools are injected into the agent context on the next message.')
  } else {
    ui.toast('error', 'Could not save MCP server')
  }
}

async function removeMcpServer(): Promise<void> {
  const ui = useUI.getState()
  try {
    const servers = await window.oxcode.mcp.list()
    if (!servers.length) {
      ui.toast('info', 'No MCP servers configured')
      return
    }
    const name = prompt(`Which server to remove?\n\n${servers.map((s) => `- ${s.name}${s.ok ? '' : ' (unreachable)'}`).join('\n')}`)
    if (!name) return
    const ok = await window.oxcode.mcp.remove(name)
    ui.toast(ok ? 'success' : 'error', ok ? `Removed "${name}"` : 'Not found')
  } catch {
    ui.toast('error', 'Could not list MCP servers')
  }
}

function buildCommands(): Command[] {
  const ui = () => useUI.getState()
  const ws = () => useWorkspace.getState()
  return [
    { id: 'open-folder', title: 'Open Project Folder…', category: 'Project', run: () => void ws().openFolder() },
    { id: 'explain-project', title: 'Explain Project', category: 'AI', run: () => void explainProject() },
    { id: 'review-file', title: 'Review Current File', category: 'AI', run: reviewFile },
    { id: 'review-project', title: 'Review Whole Project', category: 'AI', run: () => void handleSendMessage('Perform a full AI code review of the project: find bugs, security issues, performance problems, duplicated code and bad patterns. Report findings grouped by severity.') },
    { id: 'ai-fix', title: 'Fix Problems in Current File', category: 'AI', run: () => { const p = ws().activePath; void handleSendMessage(p ? `Analyze and fix any bugs or problems in "${p}".` : 'No file open.') } },
    { id: 'ai-refactor', title: 'Refactor Current File', category: 'AI', run: () => { const p = ws().activePath; void handleSendMessage(p ? `Refactor "${p}": reduce duplication and complexity, improve naming and structure without changing behavior.` : 'No file open.') } },
    { id: 'ai-tests', title: 'Generate Tests for Current File', category: 'AI', run: () => { const p = ws().activePath; void handleSendMessage(p ? `Generate comprehensive unit tests for "${p}" following the project's test conventions, create the test file and run the tests.` : 'No file open.') } },
    { id: 'ai-debug', title: 'Debug Last Terminal Error (analyze → fix → re-run)', category: 'AI', run: () => void handleSendMessage('Analyze the last terminal output for errors. Read the stack trace files, fix the root cause and re-run the failing command to verify.') },
    { id: 'ai-testfix', title: 'Run Tests & Fix All Failures', category: 'AI', run: () => void handleSendMessage('Run the project test suite. For every failure: analyze it, fix the code, and run again until all tests pass or you determine a failure is out of scope.') },
    { id: 'ai-security', title: 'Security Review of Project', category: 'AI', run: () => void handleSendMessage('Act as a Security Agent: audit this project for injection risks, hardcoded secrets, unsafe deserialization, missing auth checks and dangerous dependencies. Report findings by severity with file paths, then fix critical ones.') },
    { id: 'ai-performance', title: 'Performance Review of Project', category: 'AI', run: () => void handleSendMessage('Act as a Performance Agent: find N+1 queries, work inside loops, unbounded memory growth, blocking I/O on hot paths and unnecessary recomputation. Report with paths and apply safe optimizations.') },
    { id: 'ai-arch', title: 'Analyze Architecture (graph + circular deps)', category: 'AI', run: () => void analyzeArchitecture() },
    { id: 'pipeline-feature', title: 'Multi-Agent Pipeline: Build Feature…', category: 'Agents', run: () => { const t = prompt('Describe the feature to build:'); if (t) void runPipeline(PIPELINES['Build Feature'].map((s) => ({ ...s, instruction: `${s.instruction}\n\nFeature request: ${t}` }))) } },
    { id: 'pipeline-fix', title: 'Multi-Agent Pipeline: Fix & Verify', category: 'Agents', run: () => void runPipeline(PIPELINES['Fix & Verify']) },
    { id: 'pipeline-quality', title: 'Multi-Agent Pipeline: Quality Pass', category: 'Agents', run: () => void runPipeline(PIPELINES['Quality Pass']) },
    { id: 'ai-docs', title: 'Generate Documentation', category: 'AI', run: aiCommand('docs', 'Write documentation (README section or docstrings) for the core modules of this project.') },
    { id: 'ai-find-bug', title: 'Find Bugs in Project', category: 'AI', run: aiCommand('bug', 'Search the project for potential runtime errors, unhandled edge cases and bugs. Report the most important ones with file paths and fixes.') },
    { id: 'git-commit', title: 'Git: Generate Commit Message & Commit', category: 'Git', run: () => void aiCommit() },
    { id: 'git-pr', title: 'Git: Generate PR Description (clipboard)', category: 'Git', run: () => void generatePRDescription() },
    { id: 'git-stash', title: 'Git: Stash Changes', category: 'Git', run: async () => { const r = await window.oxcode.git.run(['stash']); useUI.getState().toast(r.ok ? 'success' : 'error', r.ok ? 'Stashed' : 'Nothing to stash') } },
    { id: 'git-log', title: 'Git: Show Log', category: 'Git', run: async () => { const r = await window.oxcode.git.run(['log', '--oneline', '-15']); useUI.getState().toast('info', 'Recent commits', r.output.slice(0, 400)) } },
    { id: 'git-status', title: 'Git: Status', category: 'Git', run: async () => { const r = await window.oxcode.git.run(['status']); ui().toast('info', 'Git status', r.output.slice(0, 400)) } },
    { id: 'toggle-sidebar', title: 'Toggle Sidebar', category: 'View', shortcut: 'Ctrl+B', run: () => ui().toggleSidebar() },
    { id: 'toggle-terminal', title: 'Toggle Terminal', category: 'View', shortcut: 'Ctrl+`', run: () => ui().toggleTerminal() },
    { id: 'toggle-ai', title: 'Toggle AI Panel', category: 'View', shortcut: 'Ctrl+J', run: () => ui().toggleAIPanel() },
    { id: 'new-terminal-cmd', title: 'Terminal: Run npm run dev', category: 'Terminal', run: () => void window.oxcode.terminal.run('npm run dev') },
    { id: 'reindex', title: 'Rebuild Project Index', category: 'Project', run: async () => { const n = await window.oxcode.index.rebuild(); ui().toast('success', `Indexed ${n} files`) } },
    { id: 'mcp-add', title: 'MCP: Add Tool Server…', category: 'MCP', run: () => void addMcpServer() },
    { id: 'mcp-remove', title: 'MCP: Remove Tool Server…', category: 'MCP', run: () => void removeMcpServer() },
    { id: 'update-check', title: 'App: Check for Updates', category: 'App', run: async () => {
      useUI.getState().toast('info', 'Checking for updates…')
      window.oxcode.update.check()
    } },
    { id: 'settings', title: 'Open Settings', category: 'App', shortcut: 'Ctrl+,', run: () => { ui().setSettingsTab('router'); ui().setSettingsOpen(true) } }
  ]
}
