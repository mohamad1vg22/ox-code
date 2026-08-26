import { useEffect, useState } from 'react'
import { useWorkspace } from '../../store/workspace'
import { useUI } from '../../store/ui'
import { Icon } from '../ui/Icon'

interface GitFile {
  status: string
  path: string
}

function parseStatus(output: string): { branch: string; files: GitFile[] } {
  const lines = output.split('\n').filter(Boolean)
  let branch = ''
  const files: GitFile[] = []
  for (const l of lines) {
    if (l.startsWith('##')) branch = l.replace('##', '').trim()
    else {
      const status = l.slice(0, 2).trim()
      const path = l.slice(3).trim().split(' -> ').pop() ?? ''
      files.push({ status, path })
    }
  }
  return { branch, files }
}

const STATUS_CLASS: Record<string, string> = {
  M: 'badge-mod',
  A: 'badge-add',
  '?': 'badge-untrk',
  D: 'badge-del'
}

export function GitPanel(): React.JSX.Element {
  const root = useWorkspace((s) => s.root)
  const isGitRepo = useWorkspace((s) => s.isGitRepo)
  const [statusOut, setStatusOut] = useState('')
  const ui = useUI()

  const refresh = async (): Promise<void> => {
    if (!root || !isGitRepo) return
    const r = await window.oxcode.git.run(['status', '--short', '--branch'])
    setStatusOut(r.output)
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [root, isGitRepo])

  if (!root) return <div style={{ padding: 20 }} className="muted">No project open.</div>
  if (!isGitRepo) return <div style={{ padding: 20 }} className="muted">This folder is not a git repository.</div>

  const { branch, files } = parseStatus(statusOut)

  const commitWithAI = async (): Promise<void> => {
    const diff = await window.oxcode.git.run(['diff', 'HEAD'])
    const stat = await window.oxcode.git.run(['diff', '--stat', 'HEAD'])
    ui.toast('info', 'Generating commit message…')
    // lightweight direct request through the agent's chat pipeline
    const msgs = [
      {
        role: 'system',
        content: 'You write conventional-commit messages. Reply with ONE line only: type(scope): summary. No code fences.'
      },
      {
        role: 'user',
        content: `Write a commit message for these changes:\n\n${stat.output}\n\n${diff.output.slice(0, 12000)}`
      }
    ]
    const result = await simpleCompletion(msgs)
    if (!result) {
      ui.toast('error', 'Could not reach the AI model. Check 9router settings.')
      return
    }
    const ok = await ui.confirm(`Commit staged+unstaged changes?`, { detail: `Message: ${result}` })
    if (!ok) return
    await window.oxcode.git.run(['add', '-A'])
    const c = await window.oxcode.git.run(['commit', '-m', result])
    ui.toast(c.ok ? 'success' : 'error', c.ok ? 'Committed' : 'Commit failed', c.output.slice(0, 300))
    void refresh()
  }

  return (
    <div>
      <div className="panel-header">
        <span>Source Control</span>
        <button className="icon-btn" onClick={() => void commitWithAI()} title="AI Commit">
          <Icon name="sparkles" size={13} />
        </button>
      </div>
      <div style={{ padding: '2px 12px 8px' }} className="mono faint">
        {branch}
      </div>
      {files.map((f, i) => (
        <div key={i} className="git-line" onClick={() => void useWorkspace.getState().openFile(f.path)}>
          <span>{f.path.split('/').pop()}</span>
          <span className={STATUS_CLASS[f.status[0]] ?? ''}>{f.status}</span>
        </div>
      ))}
      {!files.length && <div style={{ padding: '4px 12px' }} className="faint">Working tree clean</div>}
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', flexWrap: 'wrap' }}>
        <button className="btn small ghost" onClick={async () => ui.toast('info', (await window.oxcode.git.run(['pull'])).output.slice(0, 200))}>
          Pull
        </button>
        <button
          className="btn small ghost"
          onClick={async () => {
            const r = await window.oxcode.git.run(['push'])
            ui.toast(r.ok ? 'success' : 'error', r.ok ? 'Pushed' : 'Push failed', r.output.slice(0, 250))
          }}
        >
          Push
        </button>
        <button
          className="btn small ghost"
          onClick={async () => {
            const name = prompt('New branch name:')
            if (!name) return
            const r = await window.oxcode.git.run(['checkout', '-b', name])
            ui.toast(r.ok ? 'success' : 'error', r.ok ? `Created ${name}` : 'Failed', r.output.slice(0, 200))
            void refresh()
          }}
        >
          Branch
        </button>
        <button className="btn small ghost" onClick={() => void prDescription(ui)}>
          <Icon name="sparkles" size={12} /> PR
        </button>
      </div>
    </div>
  )
}

/** Minimal one-shot completion used by small AI helpers (no tools). */
export async function simpleCompletion(messages: Array<{ role: string; content: string }>): Promise<string | null> {
  return new Promise((resolve) => {
    const requestId = Math.random().toString(36).slice(2)
    let out = ''
    let done = false
    const offC = window.oxcode.ai.onChunk((p: any) => {
      if (p.requestId !== requestId || p.type !== 'text') return
      out += p.delta
    })
    const offD = window.oxcode.ai.onDone((p: any) => {
      if (p.requestId !== requestId) return
      finish()
    })
    const offE = window.oxcode.ai.onError((p: any) => {
      if (p.requestId !== requestId) return
      finish(p.message)
    })
    function finish(err?: string): void {
      if (done) return
      done = true
      offC()
      offD()
      offE()
      resolve(err ? null : out.trim())
    }
    void window.oxcode.ai.chat(requestId, { messages }).then((r) => {
      if (r && !r.ok && r.error) finish(r.error)
      else setTimeout(() => finish(), 4000)
    })
  })
}

async function prDescription(ui: ReturnType<typeof useUI.getState>): Promise<void> {
  const diff = await window.oxcode.git.run(['diff', '--stat'])
  const log = await window.oxcode.git.run(['log', '--oneline', '-8'])
  ui.toast('info', 'Generating PR description…')
  const desc = await simpleCompletion([
    { role: 'system', content: 'Write concise PR descriptions in markdown: ## Summary, ## Changes, ## Testing. No preamble.' },
    { role: 'user', content: `Write a PR description.\n\nRecent commits:\n${log.output}\n\nDiff stat:\n${diff.output}` }
  ])
  if (!desc) {
    ui.toast('error', 'Could not reach the AI model')
    return
  }
  void navigator.clipboard.writeText(desc)
  ui.toast('success', 'PR description copied to clipboard', desc.slice(0, 120))
}
