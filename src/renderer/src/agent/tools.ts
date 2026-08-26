import type { FileNodeDTO, SearchHitDTO, SymbolDTO, ToolCall } from '../types'
import { useUI } from '../store/ui'
import { useSettings } from '../store/settings'

export interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export const TOOL_DEFS: ToolDef[] = [
  { name: 'read_file', description: 'Read the contents of a file in the project.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path of the file' } }, required: ['path'] } },
  { name: 'create_file', description: 'Create a new file with content (overwrites if exists). Prefer edit_file for modifying existing files.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Edit an existing file by replacing an exact unique substring. old_string must match exactly and be unique; include enough surrounding context to be unambiguous.', parameters: { type: 'object', properties: { path: { type: 'string' }, old_string: { type: 'string' }, new_string: { type: 'string' } }, required: ['path', 'old_string', 'new_string'] } },
  { name: 'delete_file', description: 'Delete a file or directory. Requires user approval.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'rename_file', description: 'Rename/move a file or directory.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
  { name: 'list_files', description: 'List files under a directory (recursive tree). Omit path to get the whole project tree.', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'search_code', description: 'Search file contents across the project with a text or regex query. Returns matching lines with paths and line numbers.', parameters: { type: 'object', properties: { query: { type: 'string' }, regex: { type: 'boolean' } }, required: ['query'] } },
  { name: 'find_symbol', description: 'Find functions/classes/types by name using the project symbol index.', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'project_info', description: 'Get project overview: languages, dependencies count, entry points, test dirs, indexed files.', parameters: { type: 'object', properties: {} } },
  { name: 'run_command', description: 'Run a shell command in the project root (persistent terminal). Use for installs, builds, running the app. Destructive commands require user approval.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'run_tests', description: 'Run the project test suite and capture output.', parameters: { type: 'object', properties: {} } },
  { name: 'git_status', description: 'Show git working tree status.', parameters: { type: 'object', properties: {} } },
  { name: 'git_diff', description: 'Show git diff (optionally for one path).', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  { name: 'git_log', description: 'Show recent commit history.', parameters: { type: 'object', properties: { count: { type: 'number' } } } },
  {
    name: 'mcp_tool',
    description: 'Call an external MCP tool. The available servers/tools are listed in the EXTERNAL TOOLS (MCP) context block.',
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'MCP server name' },
        tool: { type: 'string', description: 'Tool name on that server' },
        arguments: { type: 'object', description: 'Tool input arguments' }
      },
      required: ['server', 'tool']
    }
  }
]

export function openAIToolsFormat(): unknown[] {
  return TOOL_DEFS.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))
}

const DANGEROUS = /rm\s+-rf|del\s+\/[sq]|rmdir\s+\/s|format\s+[a-z]:|Remove-Item\s+.*-Recurse.*-Force|shutdown|mkfs|dd\s+if=|>\s*\/dev\/|git\s+push\s+.*--force|--hard/i

function summarize(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return String(args['path'] ?? '')
    case 'create_file': return String(args['path'] ?? '')
    case 'edit_file': return `${args['path'] ?? ''}`
    case 'delete_file': return String(args['path'] ?? '')
    case 'rename_file': return `${args['from']} → ${args['to']}`
    case 'list_files': return String(args['path'] ?? '.')
    case 'search_code': return `"${String(args['query'] ?? '').slice(0, 60)}"`
    case 'find_symbol': return String(args['query'] ?? '')
    case 'run_command': case 'run_tests': return String(args['command'] ?? '(test suite)')
    case 'mcp_tool': return `${args['server'] ?? ''}.${args['tool'] ?? ''}`
    default: return ''
  }
}

async function captureTerminalRun(command: string): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const chunks: string[] = []
    let finished = false
    const off = window.oxcode.terminal.onData((p) => chunks.push(p.data))
    setTimeout(async () => {
      const res = await window.oxcode.terminal.run(command)
      // allow trailing output events to flush
      setTimeout(() => {
        if (!finished) {
          finished = true
          off()
          resolve({ ok: res.ok, output: chunks.join('').replace(/\r\n/g, '\n').slice(-16000) })
        }
      }, 350)
    }, 30)
  })
}

export interface ToolContext {
  runId: string
  onSnapshot?: (path: string) => Promise<void>
  onChange?: (path: string, before: string | null, after: string) => void
}

export async function executeTool(
  call: ToolCall,
  ctx: ToolContext
): Promise<{ result: string; mutated: boolean }> {
  let args: Record<string, unknown> = {}
  try {
    args = call.args ? JSON.parse(call.args) : {}
  } catch {
    return { result: `Error: invalid JSON arguments: ${call.args.slice(0, 200)}`, mutated: false }
  }

  const confirm = useUI.getState().confirm

  switch (call.name) {
    case 'read_file': {
      const p = String(args['path'] ?? '')
      const r = await window.oxcode.files.read(p)
      return { result: r.truncated ? r.content + '\n[truncated]' : r.content, mutated: false }
    }
    case 'create_file': {
      const p = String(args['path'] ?? '')
      const content = String(args['content'] ?? '')
      await ctx.onSnapshot?.(p)
      const existed = await window.oxcode.files.exists(p)
      let before: string | null = null
      if (existed) {
        try { before = (await window.oxcode.files.read(p)).content } catch { before = '' }
      }
      await window.oxcode.files.create(p, false, content)
      ctx.onChange?.(p, before, content)
      return { result: `File written: ${p}`, mutated: true }
    }
    case 'edit_file': {
      const p = String(args['path'] ?? '')
      const oldStr = String(args['old_string'] ?? '')
      const newStr = String(args['new_string'] ?? '')
      if (!oldStr) {
        return { result: 'Error: old_string is required. Use create_file only for brand-new files.', mutated: false }
      }
      const r = await window.oxcode.files.read(p)
      if (!r.content.includes(oldStr)) {
        // fuzzy hint: find closest line
        return { result: `Error: old_string not found in ${p}. Re-read the file with read_file and retry with exact current content (whitespace matters).`, mutated: false }
      }
      const occurrences = r.content.split(oldStr).length - 1
      if (occurrences > 1) {
        return { result: `Error: old_string matches ${occurrences} times in ${p}. Include more surrounding context to make it unique.`, mutated: false }
      }

      // Patch validation: bracket balance must stay consistent
      const balanceOf = (s: string): number => {
        let b = 0
        for (const ch of s) {
          if ('{(['.includes(ch)) b++
          else if ('})]'.includes(ch)) b--
        }
        return b
      }
      const updated = r.content.replace(oldStr, newStr)
      const beforeBal = balanceOf(r.content)
      const afterBal = balanceOf(updated)
      if (Math.abs(afterBal - beforeBal) > 0 && /code|script/i.test(p)) {
        return { result: `Error: patch rejected — bracket balance would change (${beforeBal} → ${afterBal}). The old_string/new_string pair likely cuts across block boundaries. Retry with complete blocks.`, mutated: false }
      }
      // Minimal-change guard: reject edits that delete more than half of a large file
      const removedLines = oldStr.split('\n').length
      const totalLines = r.content.split('\n').length
      if (totalLines > 60 && removedLines > totalLines * 0.6) {
        return { result: `Error: patch rejected — it would replace ${removedLines}/${totalLines} lines. Follow the minimal change principle: make smaller targeted edits, or explain why a full rewrite is needed.`, mutated: false }
      }

      await ctx.onSnapshot?.(p)
      await window.oxcode.files.write(p, updated)
      ctx.onChange?.(p, r.content, updated)
      return { result: `Edited ${p}`, mutated: true }
    }
    case 'delete_file': {
      const p = String(args['path'] ?? '')
      const fullAccess = useSettings.getState().fullAccess
      if (!fullAccess) {
        const ok = await confirm(`Delete "${p}"?`, { detail: 'The AI agent wants to delete this path. This can be rolled back via checkpoint.', danger: true })
        if (!ok) return { result: 'User rejected the deletion.', mutated: false }
      }
      await ctx.onSnapshot?.(p)
      await window.oxcode.files.delete(p)
      ctx.onChange?.(p, '', '') // recorded as change; revert handled by checkpoint
      return { result: `Deleted: ${p}`, mutated: true }
    }
    case 'rename_file': {
      const from = String(args['from'] ?? '')
      const to = String(args['to'] ?? '')
      await ctx.onSnapshot?.(from)
      await ctx.onSnapshot?.(to)
      await window.oxcode.files.rename(from, to)
      return { result: `Renamed ${from} → ${to}`, mutated: true }
    }
    case 'list_files': {
      const node = await window.oxcode.files.tree(String(args['path'] ?? ''))
      const lines: string[] = []
      const walk = (n: import('../types').FileNodeDTO[], depth: number): void => {
        if (lines.length > 800) return
        for (const c of n) {
          lines.push(`${'  '.repeat(depth)}${c.type === 'dir' ? c.name + '/' : c.name}`)
          if (c.children && depth < 6) walk(c.children, depth + 1)
        }
      }
      walk(node.children ?? [], 0)
      return { result: lines.join('\n'), mutated: false }
    }
    case 'search_code': {
      const hits: SearchHitDTO[] = await window.oxcode.search.code(String(args['query'] ?? ''), { regex: Boolean(args['regex']) })
      if (!hits.length) return { result: 'No matches found.', mutated: false }
      return {
        result: hits.map((h: SearchHitDTO) => `${h.path}:${h.line}: ${h.text.trim()}`).join('\n'),
        mutated: false
      }
    }
    case 'find_symbol': {
      const syms: SymbolDTO[] = await window.oxcode.index.symbols(String(args['query'] ?? ''))
      if (!syms.length) return { result: 'No symbols found.', mutated: false }
      return { result: syms.map((s: SymbolDTO) => `${s.kind} ${s.name} — ${s.path}:${s.line}`).join('\n'), mutated: false }
    }
    case 'project_info': {
      const info = await window.oxcode.index.projectInfo()
      return { result: JSON.stringify(info, null, 2), mutated: false }
    }
    case 'run_command': {
      const cmd = String(args['command'] ?? '')
      if (DANGEROUS.test(cmd) && !useSettings.getState().fullAccess) {
        const ok = await confirm(`AI wants to run a potentially destructive command`, { detail: cmd, danger: true })
        if (!ok) return { result: 'User rejected this command.', mutated: false }
      }
      const r = await captureTerminalRun(cmd)
      return { result: `exit code: ${r.ok ? 0 : 1}\n${r.output}`, mutated: false }
    }
    case 'run_tests': {
      const info = await window.oxcode.index.projectInfo()
      const deps: string[] = info.dependencies.map((d: string) => d.toLowerCase())
      let cmd = 'npm test -- --run'
      if (deps.includes('pytest') || info.languages['Python']) cmd = 'pytest'
      else if (deps.includes('vitest')) cmd = 'npx vitest run'
      else if (deps.includes('jest')) cmd = 'npx jest'
      else if (deps.includes('mocha')) cmd = 'npx mocha'
      else if (info.languages['Go']) cmd = 'go test ./...'
      else if (info.languages['Rust']) cmd = 'cargo test'
      const r = await captureTerminalRun(cmd)
      return { result: `$ ${cmd}\nexit code: ${r.ok ? 0 : 1}\n${r.output}`, mutated: false }
    }
    case 'git_status': {
      const r = await window.oxcode.git.run(['status', '--short', '--branch'])
      return { result: r.output, mutated: false }
    }
    case 'git_diff': {
      const p = args['path'] ? [String(args['path'])] : []
      const r = await window.oxcode.git.run(['diff', '--stat', ...p])
      const full = await window.oxcode.git.run(['diff', ...p, '--'])
      return { result: (r.output + '\n\n' + full.output).slice(0, 12000), mutated: false }
    }
    case 'git_log': {
      const n = Number(args['count'] ?? 10)
      const r = await window.oxcode.git.run(['log', '--oneline', '-n', String(Math.min(n, 50))])
      return { result: r.output, mutated: false }
    }
    case 'mcp_tool': {
      const server = String(args['server'] ?? '')
      const tool = String(args['tool'] ?? '')
      const toolArgs = (args['arguments'] as Record<string, unknown> | undefined) ?? {}
      try {
        const result = await window.oxcode.mcp.call(server, tool, toolArgs)
        return { result, mutated: false }
      } catch (e) {
        return { result: `Error: MCP call failed — ${(e as Error).message}`, mutated: false }
      }
    }
    default:
      return { result: `Unknown tool: ${call.name}`, mutated: false }
  }
}

export function toolSummary(call: ToolCall): string {
  try {
    const args = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {}
    return summarize(call.name, args)
  } catch {
    return ''
  }
}
