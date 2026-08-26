import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

export interface McpServerConfig {
  name: string
  command: string
  args?: string[]
}

export interface McpToolInfo {
  name: string
  description?: string
}

export interface McpServerStatus extends McpServerConfig {
  ok: boolean
  error?: string
  tools: McpToolInfo[]
}

interface Conn {
  proc: ChildProcessWithoutNullStreams
  tools: McpToolInfo[]
}

const conns = new Map<string, Promise<Conn>>()
let msgId = 0

function configFile(): string {
  return path.join(app.getPath('userData'), 'mcp-servers.json')
}

function readConfig(): McpServerConfig[] {
  try {
    const raw = JSON.parse(fs.readFileSync(configFile(), 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function writeConfig(cfgs: McpServerConfig[]): void {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true })
  fs.writeFileSync(configFile(), JSON.stringify(cfgs, null, 2), 'utf-8')
}

export function addServer(cfg: McpServerConfig): boolean {
  if (!cfg.name || !cfg.command) return false
  const cfgs = readConfig().filter((c) => c.name !== cfg.name)
  cfgs.push({ name: cfg.name, command: cfg.command, args: cfg.args ?? [] })
  writeConfig(cfgs)
  return true
}

export function removeServer(name: string): boolean {
  const cfgs = readConfig()
  const next = cfgs.filter((c) => c.name !== name)
  writeConfig(next)
  stopServer(name)
  return next.length !== cfgs.length
}

function stopServer(name: string): void {
  const conn = conns.get(name)
  conns.delete(name)
  if (conn) {
    void conn
      .then((c) => {
        try {
          c.proc.kill()
        } catch {
          /* already gone */
        }
      })
      .catch(() => {})
  }
}

/** Low-level JSON-RPC request over newline-delimited stdio. */
function rpc(
  proc: ChildProcessWithoutNullStreams,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 20000
): Promise<Record<string, unknown>> {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.stdout.off('data', onData)
      reject(new Error(`MCP request timed out: ${method}`))
    }, timeoutMs)

    let buf = ''
    function onData(chunk: Buffer): void {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        try {
          const msg = JSON.parse(line)
          if (msg.id === id) {
            clearTimeout(timer)
            proc.stdout.off('data', onData)
            if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)))
            else resolve(msg.result ?? {})
            return
          }
        } catch {
          /* non-JSON line — ignore */
        }
      }
    }
    proc.stdout.on('data', onData)
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}

async function notify(proc: ChildProcessWithoutNullStreams, method: string, params: Record<string, unknown> = {}): Promise<void> {
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n')
}

async function connect(cfg: McpServerConfig): Promise<Conn> {
  const proc = spawn(cfg.command, cfg.args ?? [], {
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  proc.stderr.on('data', () => {})

  await rpc(proc, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ox-code', version: app.getVersion() }
  })
  await notify(proc, 'notifications/initialized')

  const result = await rpc(proc, 'tools/list', {})
  const tools = Array.isArray(result['tools']) ? (result['tools'] as McpToolInfo[]) : []
  return { proc, tools }
}

function ensureConn(cfg: McpServerConfig): Promise<Conn> {
  let conn = conns.get(cfg.name)
  if (!conn) {
    conn = connect(cfg).catch((e) => {
      conns.delete(cfg.name)
      throw e
    })
    conns.set(cfg.name, conn)
  }
  return conn
}

export async function listTools(): Promise<McpServerStatus[]> {
  const out: McpServerStatus[] = []
  for (const cfg of readConfig()) {
    try {
      const conn = await ensureConn(cfg)
      out.push({ ...cfg, ok: true, tools: conn.tools })
    } catch (e) {
      out.push({ ...cfg, ok: false, error: (e as Error).message, tools: [] })
    }
  }
  return out
}

export async function callTool(server: string, tool: string, args: Record<string, unknown>): Promise<string> {
  const cfg = readConfig().find((c) => c.name === server)
  if (!cfg) return `Error: MCP server "${server}" is not configured.`
  try {
    const conn = await ensureConn(cfg)
    const result = await rpc(conn.proc, 'tools/call', { name: tool, arguments: args }, 120000)
    const content = result['content']
    if (Array.isArray(content)) {
      const text = content
        .map((c) => (typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
        .join('\n')
      const isError = Boolean(result['isError'])
      return (isError ? 'Error: ' : '') + text.slice(0, 30000)
    }
    return JSON.stringify(result, null, 2).slice(0, 30000)
  } catch (e) {
    // a crashed connection should be retried fresh next time
    stopServer(server)
    return `Error: MCP call failed — ${(e as Error).message}`
  }
}
