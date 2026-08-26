import { spawn } from 'child_process'

export interface GitResult {
  ok: boolean
  output: string
}

export async function runGit(cwd: string, args: string[], timeoutMs = 30000): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output: (out + err).trim() })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, output: e.message })
    })
  })
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], 5000)
  return r.ok && r.output.includes('true')
}
