import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { getWorkspaceRoot } from './files'

export interface TerminalRunResult {
  ok: boolean
  code: number | null
  output?: string
}

interface Session {
  cwd: string
  busy: boolean
}

const sessions = new Map<string, Session>()

export function createSession(id: string, cwd: string): void {
  if (!sessions.has(id)) sessions.set(id, { cwd, busy: false })
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id)
}

function shellCommand(command: string): { file: string; args: string[] } {
  return process.platform === 'win32'
    ? { file: 'cmd.exe', args: ['/d', '/s', '/c', command] }
    : { file: process.env['SHELL'] || 'bash', args: ['-c', command] }
}

/**
 * Runs a command in a session with persistent cwd.
 * Streams output chunks to the provided emitter as {id, data} and
 * always accumulates + returns the full output (used by verification engine).
 */
export function runCommand(
  id: string,
  command: string,
  emit: (channel: string, payload: unknown) => void,
  timeoutMs = 10 * 60 * 1000
): Promise<TerminalRunResult> {
  let session = sessions.get(id)
  if (!session) {
    const root = getWorkspaceRoot()
    if (!root) return Promise.resolve({ ok: false, code: null })
    session = { cwd: root, busy: false }
    sessions.set(id, session)
  }
  const sess = session

  const captured: string[] = []
  const push = (chunk: string): void => {
    captured.push(chunk)
    emit('terminal:data', { id, data: chunk })
  }

  if (sess.busy) {
    return Promise.resolve({ ok: false, code: null, output: '[terminal busy]' })
  }
  sess.busy = true

  const trimmed = command.trim()
  const cdMatch = trimmed.match(/^cd\s+(.+)$/i)
  const isWindows = process.platform === 'win32'

  return new Promise((resolve) => {
    if (cdMatch && !trimmed.includes('&&')) {
      const target = cdMatch[1].replace(/^["']|["']$/g, '')
      try {
        const abs = path.resolve(sess.cwd, target)
        fs.accessSync(abs)
        sess.cwd = abs
        resolve({ ok: true, code: 0, output: '' })
      } catch {
        push('The system cannot find the path specified.\r\n')
        resolve({ ok: false, code: 1 })
      }
      sess.busy = false
      return
    }

    const { file, args } = shellCommand(trimmed)
    const child = spawn(file, args, {
      cwd: sess.cwd,
      env: process.env,
      windowsHide: true
    })

    const onData = (chunk: Buffer): void => push(chunk.toString())
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    const timer = setTimeout(() => child.kill(), timeoutMs)

    child.on('error', (e) => {
      clearTimeout(timer)
      push(`${e.message}\r\n`)
      sess.busy = false
      resolve({ ok: false, code: null, output: captured.join('') })
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      const finish = (): void => {
        sess.busy = false
        resolve({ ok: code === 0, code, output: captured.join('').slice(-32000) })
      }
      if (/^cd\s+/i.test(trimmed)) {
        try {
          const proc = spawn(isWindows ? 'cmd.exe' : 'pwd', isWindows ? ['/d', '/s', '/c', 'cd'] : [], {
            cwd: sess.cwd,
            windowsHide: true,
            shell: false
          })
          let out = ''
          proc.stdout.on('data', (d: Buffer) => (out += d.toString()))
          proc.on('close', () => {
            const dir = out.trim().split(/\r?\n/).pop()
            if (dir) sess.cwd = dir
            finish()
          })
          proc.on('error', () => finish())
        } catch {
          finish()
        }
      } else {
        finish()
      }
    })
  })
}
