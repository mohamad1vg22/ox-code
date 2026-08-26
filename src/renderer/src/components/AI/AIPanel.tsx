import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage, PendingChange, ToolExecution } from '../../types'
import { useChat } from '../../store/chat'
import { useSettings } from '../../store/settings'
import { useUI } from '../../store/ui'
import { Markdown } from './Markdown'
import { HealthTab } from './HealthTab'
import { RulesTab } from './RulesTab'
import { ContextPanel } from '../Sidebar/ContextPanel'
import { Icon, fileTypeIcon } from '../ui/Icon'
import { approvePlan, cancelPlan, handleSendMessage } from '../../agent/runner'
import { analyzeChangeRisk } from '../../core/risk'
import { computeDiff, collapseContext } from '../../lib/diff'
import { useSessions } from '../../store/sessions'
import { useWorkspace } from '../../store/workspace'
import { QuickActionGrid } from '../Welcome/WelcomeCenter'
import { useModelStatus } from '../../store/modelStatus'

type DockTab = 'chat' | 'context' | 'health' | 'rules'

const RTL_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/
const isRTL = (text: string): boolean => RTL_RE.test(text)

const TOOL_ICONS: Record<string, string> = {
  read_file: 'file-text',
  create_file: 'file-plus',
  edit_file: 'pencil',
  delete_file: 'trash',
  rename_file: 'arrow-up',
  list_files: 'folder-open',
  search_code: 'search',
  find_symbol: 'target',
  project_info: 'info',
  run_command: 'square-terminal',
  run_tests: 'flask',
  git_status: 'git-branch',
  git_diff: 'git-branch',
  git_log: 'git-branch'
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

/* ============ Tool / command execution log ============ */

function compactLabel(exec: ToolExecution): { verb: string; file: string } {
  const raw = exec.argsSummary || exec.name
  const map: Record<string, string> = { read_file: 'read', create_file: 'write', edit_file: 'edit', delete_file: 'delete', rename_file: 'rename', list_files: 'list', search_code: 'search', find_symbol: 'symbol', project_info: 'info', run_command: 'run', run_tests: 'test', git_status: 'git', git_diff: 'git', git_log: 'git' }
  const verb = map[exec.name] ?? exec.name.replace('_', ' ')
  // extract file basename if present
  const file = raw.includes('/') || raw.includes('\\') ? baseName(raw.split('→')[0].trim()) : raw.slice(0, 48)
  return { verb, file: file || verb }
}

function ToolBlock({ exec }: { exec: ToolExecution }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const failed = exec.status === 'error'
  const running = exec.status === 'running'
  const firstLine = (exec.result ?? '').split('\n').find((l) => l.trim()) ?? ''
  const { verb, file } = compactLabel(exec)
  // parse +add/-del from result for edit/write (result may contain Edited...; stats are shown in diff-block already, but here show badge)
  const addMatch = exec.result?.match(/\+(\d+)/)
  const delMatch = exec.result?.match(/-(\d+)/)

  return (
    <div className={`tool-block ${exec.status} compact`}>
      <div className="tb-row compact-row" onClick={() => exec.result && setOpen(!open)}>
        <span className="tb-icon">
          {running ? <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} /> : failed ? <Icon name="x" size={12} /> : <Icon name="check" size={12} />}
        </span>
        <span className="tb-verb">{verb}</span>
        <span className="tb-file" title={`${exec.name} — ${exec.argsSummary}`}>{file}</span>
        <span className={`tb-status ${failed ? 'fail' : running ? 'running' : 'ok'}`}>{running ? 'running' : failed ? 'failed' : 'read'}</span>
        {exec.result && <span className="tb-badge">{open ? 'hide' : 'view'}</span>}
      </div>
      {failed && !open && exec.result && <div className="tb-summary">{firstLine.slice(0, 140)}</div>}
      {open && exec.result && <div className="tb-output">{exec.result.slice(0, 4000)}</div>}
    </div>
  )
}

function ToolLog({ execs }: { execs: ToolExecution[] }): React.JSX.Element | null {
  if (!execs.length) return null
  return (
    <div className="tool-log">
      {execs.map((e) => (
        <ToolBlock key={e.callId} exec={e} />
      ))}
    </div>
  )
}

/* ============ Compact activity line (collapsed by default) ============ */

function ActivityLine({ execs }: { execs: ToolExecution[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  if (!execs.length) return null
  const running = execs.filter((e) => e.status === 'running')
  const current = running[running.length - 1] ?? execs[execs.length - 1]
  const failed = execs.some((e) => e.status === 'error')
  const { verb, file } = compactLabel(current)
  const active = running.length > 0

  return (
    <div className="activity-line">
      <button className="al-main" onClick={() => setOpen(!open)}>
        {active ? (
          <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
        ) : failed ? (
          <Icon name="x" size={12} />
        ) : (
          <Icon name="check" size={12} />
        )}
        <span className={`al-text ${failed && !active ? 'fail' : ''}`}>
          {active
            ? `${verb} ${file}${running.length > 1 ? ` (+${running.length - 1})` : ''}`
            : `${execs.length} step${execs.length > 1 ? 's' : ''}`}
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
      </button>
      {open && <ToolLog execs={execs} />}
    </div>
  )
}

/* ============ Messages ============ */

function MessageView({ m }: { m: ChatMessage }): React.JSX.Element {
  const dir = isRTL(m.content) ? 'rtl' : 'ltr'
  if (m.role === 'tool') return <></>
  return (
    <div className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
      {m.role === 'assistant' && !!m.toolExecutions?.length && <ActivityLine execs={m.toolExecutions} />}
      {(m.role === 'user' || m.content || !m.isStreaming || !m.toolExecutions?.length) && (
        <div className="bubble" dir={dir}>
          {!!m.attachments?.length && (
            <div className="msg-attachments">
              {m.attachments.map((a) => (
                <span key={a.id} className="msg-attach">
                  {a.mime.startsWith('image/') ? <img src={a.dataUrl} alt={a.name} style={{ maxWidth: 220, maxHeight: 160, borderRadius: 8, border: '1px solid var(--border)' }} /> : <span className="attach-file"><Icon name="file" size={12} /> {a.name}</span>}
                </span>
              ))}
            </div>
          )}
          {m.role === 'user' ? <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span> : <Markdown content={m.content} />}
          {m.isStreaming && !m.content && (
            <span className="thinking-shimmer">
              <span className="thinking-dots"><i /><i /><i /></span>
              <span className="thinking-text">Thinking</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

/* ============ Plan / Task tracker ============ */

function PlanTracker(): React.JSX.Element | null {
  const plan = useChat((s) => s.plan)
  const streaming = useChat((s) => s.streaming)
  const updatePlanSteps = useChat((s) => s.updatePlanSteps)
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>([])
  const [expanded, setExpanded] = useState<number | null>(null)

  if (!plan || plan.status === 'cancelled') return null
  if (plan.status === 'proposed' && streaming) return null

  const proposed = plan.status === 'proposed'
  const pct = plan.steps.length ? Math.round((plan.doneSteps / plan.steps.length) * 100) : 0

  const startEdit = (): void => {
    setDraft([...plan.steps])
    setEditing(true)
  }

  const filesForStep = (i: number): PendingChange[] => {
    // approximate mapping: distribute pending changes across phases
    const changes = useChat.getState().pendingChanges
    if (!changes.length || !plan.steps.length) return []
    const per = Math.ceil(changes.length / plan.steps.length)
    return changes.slice(i * per, (i + 1) * per)
  }

  return (
    <div className="plan-tracker">
      <div className="pt-head" onClick={() => setOpen(!open)}>
        <Icon name="list-todo" size={13} />
        <span className="pt-title">{proposed ? 'Plan' : 'Worked'}</span>
        <span className="pt-count">
          {plan.doneSteps} / {plan.steps.length} phases
        </span>
        <span className="pt-chevron">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={13} />
        </span>
      </div>
      {open && (
        <>
          <div className="pt-progress">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="pt-steps">
            {plan.steps.map((step, i) => {
              const done = !proposed && i < plan.doneSteps
              const current = !proposed && i === plan.currentStep
              const cls = `plan-phase ${done ? 'done' : ''} ${current ? 'current' : ''}`
              const files = filesForStep(i)
              return (
                <div key={i}>
                  <div className={cls}>
                    <span className="ph-status">
                      {done ? (
                        <Icon name="check" size={12} />
                      ) : current ? (
                        <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
                      ) : (
                        <Icon name="circle" size={11} />
                      )}
                    </span>
                    {editing ? (
                      <input
                        className="phase-edit"
                        value={draft[i] ?? ''}
                        onChange={(e) => {
                          const d = [...draft]
                          d[i] = e.target.value
                          setDraft(d)
                        }}
                      />
                    ) : (
                      <span className="ph-title" title={step}>
                        {step}
                      </span>
                    )}
                    {editing ? (
                      <button className="ph-remove" title="Remove phase" onClick={() => {
                        const d = [...draft]
                        d.splice(i, 1)
                        setDraft(d)
                      }}>
                        <Icon name="trash" size={12} />
                      </button>
                    ) : (
                      <button
                        className="ph-expand"
                        title="Phase details"
                        onClick={() => setExpanded(expanded === i ? null : i)}
                      >
                        <Icon name={expanded === i ? 'chevron-down' : 'chevron-right'} size={12} />
                      </button>
                    )}
                  </div>
                  {expanded === i && !!files.length && (
                    <div className="ph-detail">
                      {files.map((f) => (
                        <span key={f.id} className={`fd-file ${f.before === null ? 'add' : 'mod'}`}>
                          <Icon name={f.before === null ? 'file-plus' : 'pencil'} size={11} />
                          {baseName(f.path)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {proposed && (
            <div className="plan-actions">
              {editing ? (
                <>
                  <button
                    className="btn small success"
                    onClick={() => {
                      updatePlanSteps(draft.filter((d) => d.trim()))
                      setEditing(false)
                    }}
                  >
                    <Icon name="check" size={12} /> Save
                  </button>
                  <button className="btn small ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="btn small success" onClick={() => void approvePlan()}>
                    <Icon name="check" size={12} /> Approve
                  </button>
                  <button className="btn small ghost" onClick={startEdit}>
                    <Icon name="pencil" size={12} /> Edit Plan
                  </button>
                  <button className="btn small ghost" onClick={() => cancelPlan()}>
                    <Icon name="x" size={12} /> Cancel
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ============ Checkpoint timeline ============ */

function CheckpointTimeline(): React.JSX.Element | null {
  const checkpoints = useChat((s) => s.checkpoints)
  const [confirming, setConfirming] = useState<string | null>(null)
  if (checkpoints.length < 2) return null

  const fmt = (ts: number): string =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <div className="cp-bar">
      <div className="cp-line">
        {checkpoints.map((c) => (
          <button
            key={c.runId}
            className="cp-dot"
            title={`${fmt(c.ts)} — ${c.label}`}
            onClick={() => setConfirming(c.runId)}
          >
            <span className="cp-tip">
              {fmt(c.ts)} · {c.label}
            </span>
          </button>
        ))}
      </div>
      {confirming && (
        <div className="modal-backdrop" style={{ zIndex: 300 }} onClick={() => setConfirming(null)}>
          <div className="modal" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">Rollback to this point?</div>
            <div className="modal-body" style={{ fontSize: 12.3, color: 'var(--muted)', lineHeight: 1.6 }}>
              All changes made after this checkpoint will be permanently reverted.
            </div>
            <div className="modal-foot">
              <button className="btn small ghost" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                className="btn small danger"
                onClick={() => {
                  void useChat.getState().rollbackCheckpoint(confirming)
                  setConfirming(null)
                }}
              >
                Confirm Rollback
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ============ Inline diff blocks ============ */

function DiffBlock({ change }: { change: PendingChange }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const reject = useChat((s) => s.rejectPendingChange)
  const accept = useChat((s) => s.acceptPendingChange)
  const setDiffModalPath = useUI((s) => s.setDiffModalPath)
  const { stats, lines } = useMemo(() => {
    const all = computeDiff(change.before ?? '', change.after)
    return {
      stats: {
        add: all.filter((l) => l.type === 'add').length,
        del: all.filter((l) => l.type === 'del').length
      },
      lines: open ? collapseContext(all) : []
    }
  }, [open, change.before, change.after])

  return (
    <div className="diff-block">
      <div className="db-head" onClick={() => setOpen(!open)}>
        <span className="db-icon">
          <Icon name={change.before === null ? 'file-plus' : 'pencil'} size={13} />
        </span>
        <span className="db-name">{baseName(change.path)}</span>
        <span className="db-path">{change.path}</span>
        <span className="db-stats">
          <span className="add">+{stats.add}</span> <span className="del">-{stats.del}</span>
        </span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      </div>
      {open && (
        <div className="db-body">
          <div className="diff-view" style={{ maxHeight: 260, border: 'none', borderRadius: 0 }}>
            {lines.map((l, i) => (
              <div key={i} className={`diff-line ${l.type}`}>
                <span className="ln">{l.newNo ?? l.oldNo ?? ''}</span>
                <span className="sign">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
                <span style={{ flex: 1 }}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="db-foot">
        <button className="mini-btn accept" onClick={() => accept(change.id)}>
          <Icon name="check" size={11} /> Accept
        </button>
        <button className="mini-btn reject" onClick={() => void reject(change.id)}>
          <Icon name="x" size={11} /> Reject
        </button>
        <span style={{ flex: 1 }} />
        <button className="mini-btn" onClick={() => setDiffModalPath(change.path)} title="Open full diff">
          Full diff
        </button>
      </div>
    </div>
  )
}

function PendingChanges(): React.JSX.Element | null {
  const changes = useChat((s) => s.pendingChanges)
  const reject = useChat((s) => s.rejectPendingChange)
  const accept = useChat((s) => s.acceptPendingChange)
  const rollback = useChat((s) => s.rollbackCheckpoint)

  const risk = useMemo(
    () => analyzeChangeRisk(changes.filter((c) => !c.reverted).map((c) => c.path), null),
    [changes]
  )

  const rejectAll = async (): Promise<void> => {
    for (const c of [...changes]) await reject(c.id)
  }

  if (!changes.length) return null
  return (
    <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-soft)', background: 'var(--bg1)' }}>
      <div className="accept-all-bar">
        <span>
          Changes ({changes.length})
          <span className={`risk-badge risk-${risk.level.toLowerCase()}`} style={{ marginLeft: 8 }} title="Change risk analysis">
            <Icon name="alert-triangle" size={10} /> {risk.level}
          </span>
        </span>
        <span className="spacer" />
        <button className="mini-btn accept" onClick={() => changes.forEach((c) => accept(c.id))}>
          <Icon name="check" size={11} /> Accept All
        </button>
        <button className="mini-btn reject danger" onClick={() => void rejectAll()}>
          <Icon name="x" size={11} /> Reject All
        </button>
        <button className="mini-btn" style={{ color: 'var(--yellow)' }} onClick={() => void rollback()} title="Rollback everything since checkpoint">
          <Icon name="corner-up-left" size={12} />
        </button>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {changes.slice(0, 8).map((c) => (
          <DiffBlock key={c.id} change={c} />
        ))}
        {changes.length > 8 && (
          <div className="faint" style={{ fontSize: 10.5, padding: '2px 4px' }}>+{changes.length - 8} more…</div>
        )}
      </div>
    </div>
  )
}

/* ============ Token meter ============ */

function TokenMeter(): React.JSX.Element {
  const stats = useChat((s) => s.stats)
  const contextLength = useSettings((s) => s.settings?.contextLength ?? 128000)
  const [seconds, setSeconds] = useState(0)
  const streaming = useChat((s) => s.streaming)

  useEffect(() => {
    if (!streaming) {
      setSeconds(0)
      return
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [streaming])

  const used = stats.inputTokens + stats.outputTokens
  const pct = Math.min(100, Math.round((used / contextLength) * 100))
  const color = pct > 85 ? 'var(--red)' : pct > 60 ? 'var(--yellow)' : 'var(--accent)'
  const r = 8
  const c = 2 * Math.PI * r
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const cost = ((stats.inputTokens + stats.outputTokens) / 1_000_000 * 3).toFixed(2)

  return (
    <div className="token-meter" title="Context usage">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <circle className="tm-track" cx="11" cy="11" r={r} fill="none" strokeWidth="2.5" />
        <circle
          className="tm-fill"
          cx="11" cy="11" r={r} fill="none" strokeWidth="2.5"
          stroke={color}
          strokeDasharray={c}
          strokeDashoffset={c - (c * pct) / 100}
          strokeLinecap="round"
          transform="rotate(-90 11 11)"
        />
        <text className="tm-label" x="11" y="14" textAnchor="middle">
          {pct}
        </text>
      </svg>
      <span className="quota-text">
        <b>{(used / 1000).toFixed(1)}k</b> · {mm}:{ss}
      </span>
      <div className="token-tip">
        <div>
          Input: <b>{stats.inputTokens.toLocaleString()}</b> tokens
        </div>
        <div>
          Output: <b>{stats.outputTokens.toLocaleString()}</b> tokens
        </div>
        <div>
          Context window: <b>{(contextLength / 1000).toFixed(0)}k</b> ({pct}% used)
        </div>
        <div>
          Est. cost: <b>~${cost}</b>
        </div>
      </div>
    </div>
  )
}

/* ============ Context chips ============ */

function ContextChips(): React.JSX.Element | null {
  const files = useChat((s) => s.contextFiles)
  const remove = useChat((s) => s.removeContextFile)
  if (!files.length) return null
  return (
    <div className="ctx-chips-row">
      {files.map((f) => (
        <span key={f} className="ctx-chip2" title={f}>
          <Icon name={fileTypeIcon(baseName(f))} size={11} />
          <span className="cc-name">{baseName(f)}</span>
          <button className="cc-x" title="Remove from context" onClick={() => remove(f)}>
            <Icon name="x" size={9} />
          </button>
        </span>
      ))}
    </div>
  )
}

/* ============ Model selector with quota dots ============ */

function StatusDot({ status }: { status: string }): React.JSX.Element {
  const colors: Record<string, string> = {
    available: '#22c55e',
    low: '#f59e0b',
    exhausted: '#ef4444',
    locked: '#a78bfa',
    unknown: '#71717a'
  }
  const isLocked = status === 'locked'
  if (isLocked) return <span style={{ width: 8, height: 8, display: 'inline-grid', placeItems: 'center', color: colors.locked }}><Icon name="lock" size={8} /></span>
  const bg = colors[status] ?? colors.unknown
  const hollow = status === 'unknown'
  return <span style={{ width: 7, height: 7, borderRadius: 8, background: hollow ? 'transparent' : bg, border: hollow ? `1.5px solid ${bg}` : 'none', display: 'inline-block', flexShrink: 0 }} />
}

function ModelSelector(): React.JSX.Element {
  const model = useSettings((s) => s.settings?.model ?? '')
  const models = useSettings((s) => s.models)
  const statuses = useModelStatus((s) => s.map)
  const fetchStatus = useModelStatus((s) => s.fetch)
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const provider = model.split('/')[0] || 'default'
  const curStatus = statuses[model]?.status ?? 'unknown'

  useEffect(() => {
    if (open) {
      const list = models.length ? models : [model].filter(Boolean) as string[]
      void fetchStatus(list)
    }
  }, [open, models, model])

  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [open])

  const items = (models.length ? models : [model]).filter(Boolean) as string[]
  // group: available first, unknown middle, low, exhausted, locked last
  const rank: Record<string, number> = { available: 0, unknown: 1, low: 2, exhausted: 3, locked: 4 }
  const sorted = [...items].sort((a, b) => (rank[statuses[a]?.status ?? 'unknown'] ?? 1) - (rank[statuses[b]?.status ?? 'unknown'] ?? 1))

  const fmtReset = (q: { resetInSec?: number; resetAt?: string }): string => {
    if (q.resetInSec !== undefined) {
      const sec = Math.max(0, q.resetInSec - Math.floor((now - (useModelStatus.getState().lastFetch || now)) / 1000))
      const m = Math.floor(sec / 60); const s = sec % 60
      return `Resets in ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }
    if (q.resetAt) {
      const diff = Math.max(0, Math.floor((new Date(q.resetAt).getTime() - now) / 1000))
      const m = Math.floor(diff / 60); const s = diff % 60
      return `Resets in ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    }
    return 'Resets soon'
  }

  return (
    <div className="model-select">
      <button className="ms-btn" title="Select model" onClick={() => setOpen(!open)}>
        <StatusDot status={curStatus} />
        <span className="ms-provider">{provider}</span>
        <span className="ms-model">{model.split('/').slice(1).join('/') || model || 'no model'}</span>
        {statuses[model]?.remaining && <span className="ms-quota">{statuses[model].remaining}</span>}
        <Icon name="chevron-down" size={11} />
      </button>
      {open && (
        <div className="ms-menu" style={{ minWidth: 320 }}>
          <div className="ms-head">
            <span>Models</span>
            {statuses[model]?.quotaPct !== undefined && (
              <span className="ms-free-left" title="Remaining free-tier usage on the selected model">
                {statuses[model].quotaPct}% free left
              </span>
            )}
          </div>
          {sorted.map((m) => {
            const q = statuses[m]
            const st = q?.status ?? 'unknown'
            const isExhausted = st === 'exhausted'
            const isLow = st === 'low'
            const isLocked = st === 'locked'
            const isFree = !isLocked
            return (
              <button
                key={m}
                className={`ms-item ${m === model ? 'on' : ''} ${isExhausted ? 'exhausted' : ''} ${isLocked ? 'locked' : ''}`}
                onClick={() => {
                  void useSettings.getState().update({ model: m })
                  setOpen(false)
                }}
                onMouseEnter={() => setHover(m)}
                onMouseLeave={() => setHover(null)}
                style={{ display: 'flex', alignItems: 'center', gap: 7, position: 'relative' }}
              >
                <StatusDot status={st} />
                <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m}</span>
                <span className={`ms-tier ${isFree ? 'free' : 'paid'}`}>{isFree ? 'Free' : q?.planRequired ?? 'Premium'}</span>
                {isLow && <span className="ms-badge low">{q?.remaining ?? '~15% left'}</span>}
                {isExhausted && <span className="ms-badge exhausted">{fmtReset(q ?? {})}</span>}
                {st === 'unknown' && <span className="ms-badge unknown">?</span>}
                {st === 'available' && q?.quotaPct !== undefined && <span className="ms-badge available">{q.quotaPct}%</span>}
                {hover === m && (
                  <span className="ms-pop" style={{ position: 'absolute', right: 0, top: '100%', zIndex: 50, width: 260, padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 10, lineHeight: 1.6, textAlign: 'left', whiteSpace: 'normal' }}>
                    <div><b>{m}</b> — {isFree ? 'Free tier' : `Requires ${q?.planRequired ?? 'paid plan'}`}</div>
                    {q?.quotaPct !== undefined && <div>Used: {100 - (q.quotaPct ?? 0)}% · Remaining: {q.quotaPct}%</div>}
                    {(q?.resetAt || q?.resetInSec !== undefined) && <div>{fmtReset(q)}</div>}
                    {q?.queueSec !== undefined && <div>Queue: ~{q.queueSec}s</div>}
                    {st === 'unknown' && <div>Could not fetch quota — model still selectable</div>}
                  </span>
                )}
              </button>
            )
          })}
          {!items.length && <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--faint)' }}>No models loaded</div>}
        </div>
      )}
    </div>
  )
}

function QuotaWarning(): React.JSX.Element | null {
  const model = useSettings((s) => s.settings?.model ?? '')
  const models = useSettings((s) => s.models)
  const map = useModelStatus((s) => s.map)
  const q = map[model]
  const isExhausted = q?.status === 'exhausted'
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!isExhausted) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [isExhausted])

  if (!q) return null
  if (q.status !== 'exhausted' && q.status !== 'low') return null
  void tick
  const fmt = (): string => {
    const base = useModelStatus.getState().lastFetch
    const elapsed = base ? Date.now() - base : 0
    const sec = q.resetInSec !== undefined ? Math.max(0, q.resetInSec - Math.floor(elapsed / 1000)) : 0
    const m = Math.floor(sec / 60); const s = sec % 60
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }
  const nextAvailable = models.find((m) => (map[m]?.status === 'available')) || models.find((m) => map[m]?.status !== 'exhausted')
  return (
    <div className={`quota-warn ${isExhausted ? 'exhausted' : 'low'}`}>
      <Icon name="alert-triangle" size={12} />
      <span>{isExhausted ? `This model is out of quota. Resets in ${fmt()} — switch model?` : `Low quota (${q.remaining ?? 'low'}) — consider switching`}</span>
      {nextAvailable && nextAvailable !== model && (
        <button className="mini-btn" style={{ marginLeft: 8 }} onClick={() => void useSettings.getState().update({ model: nextAvailable })}>Switch to {nextAvailable.split('/').pop()}</button>
      )}
    </div>
  )
}

/* ============ Project language donut ============ */

const LANG_COLORS: Record<string, string> = {
  HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c', TypeScript: '#3178c6',
  JavaScript: '#f1e05a', Python: '#3572a5', Go: '#00add8', Rust: '#dea584',
  Java: '#b07219', Kotlin: '#a97bff', 'C#': '#178600', C: '#555555', 'C++': '#f34b7d',
  PHP: '#4f5d95', Ruby: '#701516', Swift: '#f05138', Dart: '#00b4ab', Vue: '#41b883',
  Svelte: '#ff3e00', SQL: '#e38c00', Shell: '#89e051', YAML: '#cb171e'
}
const FALLBACK_COLORS = ['#82aaff', '#55d6a1', '#e8c56a', '#ef7c86', '#b9a5ff', '#6ecddf']

function ProjectDonut(): React.JSX.Element | null {
  const root = useWorkspace((s) => s.root)
  const [info, setInfo] = useState<import('../../types').ProjectInfoDTO | null>(null)
  const [hover, setHover] = useState<string | null>(null)

  useEffect(() => {
    if (!root) {
      setInfo(null)
      return
    }
    let alive = true
    const load = (): void => {
      void window.oxcode.index.projectInfo().then((i) => {
        if (alive) setInfo(i)
      }).catch(() => {})
    }
    load()
    const t = setInterval(load, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [root])

  if (!root || !info || !info.files) return null
  const entries = Object.entries(info.languages).sort((a, b) => b[1] - a[1]).slice(0, 6)
  if (!entries.length) return null
  const total = entries.reduce((a, [, n]) => a + n, 0)

  const r = 9
  const c = 2 * Math.PI * r
  let offset = 0
  const segments = entries.map(([lang, count], i) => {
    const frac = count / total
    const seg = { lang, count, pct: Math.round(frac * 100), len: frac * c, dash: c - frac * c, off: offset, color: LANG_COLORS[lang] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }
    offset += seg.len
    return seg
  })
  const hovered = segments.find((s) => s.lang === hover)

  return (
    <div className="token-meter" title="Project composition by language">
      <svg width="24" height="24" viewBox="0 0 24 24">
        <circle className="tm-track" cx="12" cy="12" r={r} fill="none" strokeWidth="3" />
        {segments.map((s) => (
          <circle
            key={s.lang}
            cx="12" cy="12" r={r} fill="none"
            stroke={s.color}
            strokeWidth={hover === s.lang ? 4 : 3}
            strokeDasharray={`${Math.max(0.5, s.len)} ${s.dash}`}
            strokeDashoffset={-s.off}
            transform="rotate(-90 12 12)"
            onMouseEnter={() => setHover(s.lang)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'default', transition: 'stroke-width 120ms ease' }}
          >
            <title>{`${s.lang} — ${s.pct}% (${s.count} files)`}</title>
          </circle>
        ))}
        <text className="tm-label" x="12" y="15" textAnchor="middle">
          {hovered ? `${hovered.pct}%` : info.files > 999 ? `${Math.round(info.files / 100) / 10}k` : info.files}
        </text>
      </svg>
      <span className="quota-text">
        {hovered ? <><b style={{ color: hovered.color }}>{hovered.lang}</b> {hovered.pct}%</> : <b>project</b>}
      </span>
      <div className="token-tip">
        <div style={{ marginBottom: 4 }}><b>Project composition</b> ({info.files} files)</div>
        {segments.map((s) => (
          <div key={s.lang}>
            <span style={{ color: s.color }}>●</span> {s.lang}: <b>{s.pct}%</b> ({s.count})
          </div>
        ))}
      </div>
    </div>
  )
}

/* ============ Working pill ============ */

function WorkingPill(): React.JSX.Element | null {
  const streaming = useChat((s) => s.streaming)
  const phase = useChat((s) => s.phase)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!streaming) {
      setSeconds(0)
      return
    }
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [streaming])

  if (!streaming) return null
  const mm = Math.floor(seconds / 60)
  const ss = String(seconds % 60).padStart(2, '0')
  return (
    <div className="working-pill">
      <span className="wp-dot" />
      <span className="thinking-shimmer" style={{ fontSize: 10 }}>{phase || 'Thinking'} </span>
      <span className="wp-time">· {mm}:{ss}</span>
    </div>
  )
}

/* ============ Empty state ============ */

function ChatEmpty(): React.JSX.Element {
  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const active = sessions.find((s) => s.id === activeId)
  const root = useWorkspace((s) => s.root)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="chat-empty" style={{ flex: 1 }}>
      <div className="chat-welcome-mark">OX</div>
      <div className="ce-hint primary">
        {greeting}. How can I help you today?
      </div>
      <div className="ce-hint">
        {root ? 'Ask anything about this project.' : 'Open a project folder to give the agent real context.'}
        <br />
        <span className="faint">Explore, build, fix and verify from one focused workspace.</span>
        {active && active.title !== 'New session' && <><br /><span className="faint session-note">Session: {active.title}</span></>}
      </div>
      <QuickActionGrid onEdit={(action) => window.dispatchEvent(new CustomEvent('oxcode:fill-input', { detail: action.prompt }))} />
      {!root && <button className="primary-action" onClick={() => void useWorkspace.getState().openFolder()}><Icon name="folder-open" size={14} /> Open project folder</button>}
      <button className="feedback-link" title="Send feedback" onClick={() => useUI.getState().toast('info', 'Thanks!', 'Feedback helps improve OX Code.')}>
        <Icon name="chat" size={12} /> Give feedback
      </button>
    </div>
  )
}

/* ============ Chat History Drawer ============ */
function ChatHistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const sessions = useSessions((s) => s.sessions)
  const activeId = useSessions((s) => s.activeId)
  const switchSession = useSessions((s) => s.switchSession)
  const closeSession = useSessions((s) => s.closeSession)
  const newSession = useSessions((s) => s.newSession)
  const [q, setQ] = useState('')
  if (!open) return null
  const filtered = sessions.filter((s) => {
    if (!q.trim()) return true
    const needle = q.toLowerCase()
    return s.title.toLowerCase().includes(needle) || s.messages.some((m) => m.content.toLowerCase().includes(needle))
  }).slice().sort((a, b) => b.createdAt - a.createdAt)
  return (
    <div className="modal-backdrop" style={{ zIndex: 150 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 560, maxHeight: '78vh' }}>
        <div className="modal-head">
          <Icon name="history" size={14} /> Chat History
          <span className="faint" style={{ marginLeft: 8, fontSize: 11, fontWeight: 400 }}>{sessions.length} sessions</span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}><Icon name="x" size={13} /></button>
        </div>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-soft)', display: 'flex', gap: 8 }}>
          <input style={{ flex: 1 }} placeholder="Search history…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn small ghost" onClick={() => { newSession(); onClose() }}><Icon name="plus" size={12} /> New</button>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: '52vh' }}>
          {!filtered.length ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--faint)', fontSize: 12 }}>No sessions found</div> : filtered.map((s) => (
            <div key={s.id} className={`history-row ${s.id === activeId ? 'active' : ''}`}>
              <button className="history-main" onClick={() => { switchSession(s.id); onClose() }}>
                <span className={`history-dot ${s.status}`} />
                <span className="history-title">{s.title}</span>
                <span className="history-meta">{new Date(s.createdAt).toLocaleString()} · {s.messages.length} msgs</span>
                <span className="history-preview">{s.messages.find((m) => m.role === 'user')?.content.slice(0, 90) ?? '—'}</span>
              </button>
              <button className="icon-btn" title="Close session" onClick={() => closeSession(s.id)}><Icon name="x" size={11} /></button>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn small ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

/* ============ Minimal welcome composer (clean start, like a blank AI chat) ============ */

const DEPTH_LABELS: Record<string, string> = { eco: 'Low', balanced: 'Medium', deep: 'High', max: 'Max' }

function WelcomeComposer(): React.JSX.Element {
  const [input, setInput] = useState('')
  const streaming = useChat((s) => s.streaming)
  const thinkingLevel = useSettings((s) => s.thinkingLevel)
  const apiKey = useSettings((s) => s.settings?.apiKey ?? '')
  const lastError = useChat((s) => s.stats.error)
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const send = (): void => {
    const value = input.trim()
    if (!value || streaming) return
    setInput('')
    void handleSendMessage(value)
  }

  return (
    <div className="welcome-stage">
      <div className="welcome-center">
        <div className="chat-welcome-mark">OX</div>
        <div className="wc-greeting">{greeting}. What should we build?</div>
        {!apiKey && (
          <button className="wc-apiwarn" onClick={() => { useUI.getState().setSettingsTab('router'); useUI.getState().setSettingsOpen(true) }}>
            <Icon name="alert-triangle" size={12} /> No API key configured — click here to set it in Settings
          </button>
        )}
        {!!apiKey && lastError && (
          <div className="wc-apiwarn static">
            <Icon name="alert-triangle" size={12} /> {lastError.slice(0, 160)}
          </div>
        )}
        <div className="wc-input">
          <textarea
            autoFocus
            placeholder="Ask anything — @ for files…"
            value={input}
            dir={isRTL(input) ? 'rtl' : 'ltr'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="wc-toolbar">
            <ModelSelector />
            <select
              className="depth-select"
              title="Thinking level"
              value={thinkingLevel}
              onChange={(e) => useSettings.getState().setLocal({ thinkingLevel: e.target.value as never })}
            >
              <option value="eco">{DEPTH_LABELS['eco']}</option>
              <option value="balanced">{DEPTH_LABELS['balanced']}</option>
              <option value="deep">{DEPTH_LABELS['deep']}</option>
              <option value="max">{DEPTH_LABELS['max']}</option>
            </select>
            <span style={{ flex: 1 }} />
            {streaming ? (
              <button
                className="send-btn stop"
                onClick={() => import('../../agent/runner').then((r) => r.abortActiveRun())}
                title="Stop"
              >
                <Icon name="stop" size={13} />
              </button>
            ) : (
              <button className="send-btn" onClick={send} disabled={!input.trim()} title="Send (Enter)">
                <Icon name="arrow-up" size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="wc-footer">
          <button onClick={() => void useWorkspace.getState().openFolder()}>Open project</button>
          <span>·</span>
          <button onClick={() => { useUI.getState().setSettingsTab('router'); useUI.getState().setSettingsOpen(true) }}>Settings</button>
        </div>
      </div>
    </div>
  )
}

/* ============ Main panel ============ */

const DOCK_TABS: Array<{ id: DockTab; icon: string; label: string }> = [
  { id: 'chat', icon: 'chat', label: 'AI Chat' },
  { id: 'context', icon: 'layers', label: 'Context' },
  { id: 'health', icon: 'activity', label: 'Project Health' },
  { id: 'rules', icon: 'book-open', label: 'Project Rules' }
]

export function AIPanel(): React.JSX.Element {
  const visible = useUI((s) => s.aiPanelVisible)
  const messages = useChat((s) => s.messages)
  const streaming = useChat((s) => s.streaming)
  const queue = useChat((s) => s.queue)
  const mode = useChat((s) => s.mode)
  const tree = useWorkspace((s) => s.tree)
  const activePath = useWorkspace((s) => s.activePath)
  const [tab, setTab] = useState<DockTab>('chat')
  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [pendingAtts, setPendingAtts] = useState<import('../../types').Attachment[]>([])
  const [showInstructions, setShowInstructions] = useState(false)
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null)
  const [mentionSel, setMentionSel] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const ctxFiles = useChat((s) => s.contextFiles)
  const customInstruction = useChat((s) => s.customInstruction)
  const thinkingLevel = useSettings((s) => s.thinkingLevel)
  const scrollRef = useRef<HTMLDivElement>(null)

  // flatten project tree for @-mention resolution
  const allFiles = useMemo(() => {
    const out: string[] = []
    const walk = (nodes: import('../../types').FileNodeDTO[]): void => {
      for (const n of nodes) {
        if (n.type === 'file') out.push(n.path)
        if (n.children && out.length < 4000) walk(n.children)
      }
    }
    if (tree) walk(tree)
    return out
  }, [tree])

  const mentionMatches = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return allFiles.filter((p) => p.toLowerCase().includes(q)).slice(0, 8)
  }, [mention, allFiles])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    const fill = (e: Event): void => {
      const text = (e as CustomEvent).detail as string
      if (text) setInput(text)
    }
    window.addEventListener('oxcode:fill-input', fill)
    return () => window.removeEventListener('oxcode:fill-input', fill)
  }, [])

  const processFiles = async (files: FileList | File[]): Promise<void> => {
    const out: import('../../types').Attachment[] = []
    for (const f of Array.from(files)) {
      if (f.size > 8 * 1024 * 1024) { useUI.getState().toast('error', 'File too large', `${f.name} exceeds 8MB`); continue }
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(r.result as string)
        r.onerror = () => rej(new Error('read failed'))
        r.readAsDataURL(f)
      })
      out.push({ id: Math.random().toString(36).slice(2)+Date.now().toString(36), name: f.name, mime: f.type || 'application/octet-stream', dataUrl, size: f.size })
    }
    if (out.length) setPendingAtts((p) => [...p, ...out].slice(0, 6))
  }

  const send = (text?: string): void => {
    const raw = text ?? input
    let value = raw.trim()
    if (!value && !pendingAtts.length) return
    const atts = pendingAtts.length ? [...pendingAtts] : undefined
    // always clear
    setInput('')
    setPendingAtts([])
    setMention(null)

    // resolve @mentions into inline file context
    const mentions = [...value.matchAll(/@([^\s@,;)}\]]+)/g)]
    if (mentions.length) {
      const blocks: string[] = []
      for (const m of mentions) {
        const q = m[1].toLowerCase()
        const resolved = allFiles.find((p) => p.toLowerCase() === q) ?? allFiles.find((p) => p.toLowerCase().endsWith(q)) ??
          allFiles.find((p) => p.split('/').pop()?.toLowerCase() === q.split('/').pop())
        if (resolved) {
          blocks.push(resolved)
        }
      }
      if (blocks.length) {
        void (async () => {
          const ctxBlocks: string[] = []
          for (const p of blocks.slice(0, 5)) {
            try {
              const r = await window.oxcode.files.read(p)
              ctxBlocks.push(`[Referenced file: ${p}]\n\`\`\`\n${r.content.length > 8000 ? r.content.slice(0, 8000) + '\n[...truncated]' : r.content}\n\`\`\``)
            } catch { /* unreadable */ }
          }
          if (ctxBlocks.length) {
            value += '\n\n' + ctxBlocks.join('\n\n')
            void useChat.getState().addContextFile(blocks[0]).catch(() => {})
          }
          dispatchSend(value, atts)
        })()
        return
      }
    }

    dispatchSend(value, atts)
  }

  const dispatchSend = (value: string, atts?: import('../../types').Attachment[]): void => {
    if (streaming) {
      useChat.getState().enqueue(value)
      useUI.getState().toast('info', 'Added to the queue', 'It will run after the current response finishes.')
      return
    }
    setTab('chat')
    void handleSendMessage(value, atts)
  }

  const applyMention = (path: string): void => {
    if (!mention) return
    const before = input.slice(0, mention.start)
    const after = input.slice(mention.start + mention.query.length + 1)
    setInput(`${before}@${path}${after}`)
    setMention(null)
  }

  // clean start: no conversation yet and nothing open → minimal composer only
  if (messages.length === 0 && !activePath) {
    return (
      <div className={`aipanel welcome ${visible ? '' : 'hidden'}`}>
        <WelcomeComposer />
      </div>
    )
  }

  return (
    <div className={`aipanel ${visible ? '' : 'hidden'}`} style={{ flexDirection: 'row' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div className="ai-head">
          <button className="tb-btn" title="Chat history" onClick={() => setHistoryOpen(true)}><Icon name="history" size={14} /></button>
          <span className="title">{tab === 'chat' ? 'AI Assistant' : DOCK_TABS.find((t) => t.id === tab)?.label}</span>
          {streaming && <span className="ai-head-live"><span className="wp-dot" /> working…</span>}
          <button className="tb-btn" style={{ marginLeft: 'auto' }} title="New chat" onClick={() => useSessions.getState().newSession()}><Icon name="plus" size={13} /></button>
        </div>
        <ChatHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} />

        {tab === 'chat' && (
          <>
            <CheckpointTimeline />
            <div className="ai-msgs" ref={scrollRef} style={messages.length ? undefined : { display: 'flex', flexDirection: 'column' }}>
              {!messages.length ? (
                <ChatEmpty />
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageView key={m.id} m={m} />
                  ))}
                  <PlanTracker />
                </>
              )}
            </div>
            <PendingChanges />
            <div className="ai-input-zone">
              <QuotaWarning />
              <WorkingPill />
              {showInstructions && (
                <div className="instructions-bar">
                  <Icon name="pencil" size={11} />
                  <input
                    autoFocus
                    placeholder="Session instructions (e.g. 'Always answer in Persian', 'Prefer functional style')…"
                    value={customInstruction}
                    onChange={(e) => useChat.getState().setCustomInstruction(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && setShowInstructions(false)}
                  />
                  <button className="cc-x" title="Clear instructions" onClick={() => { useChat.getState().setCustomInstruction(''); setShowInstructions(false) }}>
                    <Icon name="x" size={9} />
                  </button>
                </div>
              )}
              <div className="input-shell" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void processFiles(e.dataTransfer.files) }}>
                <ContextChips />
                {!!pendingAtts.length && (
                  <div className="pending-atts">
                    {pendingAtts.map((a) => (
                      <span key={a.id} className="pending-att">
                        {a.mime.startsWith('image/') ? <img src={a.dataUrl} alt={a.name} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} /> : <Icon name="file" size={14} />}
                        <span className="pa-name">{a.name}</span>
                        <button className="cc-x" onClick={() => setPendingAtts((p) => p.filter((x) => x.id !== a.id))}><Icon name="x" size={9} /></button>
                      </span>
                    ))}
                  </div>
                )}
                <textarea
                  className="chat-textarea"
                  dir={isRTL(input) ? 'rtl' : 'ltr'}
                  placeholder={
                    queue.length
                      ? `Type a message — ${queue.length} added to the queue`
                      : 'Type a message — / for skills, @ for files • drop images here'
                  }
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    const el = e.target
                    const before = el.value.slice(0, el.selectionStart ?? 0)
                    const m = before.match(/(?:^|\s)@([\w./\\-]*)$/)
                    if (m) {
                      setMention({ start: (el.selectionStart ?? 0) - m[1].length - 1, query: m[1] })
                      setMentionSel(0)
                    } else {
                      setMention(null)
                    }
                  }}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files)
                    if (files.length) { e.preventDefault(); void processFiles(files as unknown as FileList) }
                  }}
                  onKeyDown={(e) => {
                    if (mention && mentionMatches.length && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key)) {
                      e.preventDefault()
                      if (e.key === 'ArrowDown') setMentionSel((s) => Math.min(s + 1, mentionMatches.length - 1))
                      else if (e.key === 'ArrowUp') setMentionSel((s) => Math.max(s - 1, 0))
                      else applyMention(mentionMatches[mentionSel])
                      return
                    }
                    if (e.key === 'Enter') {
                      if (mention && mentionMatches.length && !e.shiftKey) {
                        e.preventDefault()
                        applyMention(mentionMatches[mentionSel])
                        return
                      }
                      if (!e.shiftKey) {
                        e.preventDefault()
                        send()
                      }
                    } else if (e.key === 'Escape' && mention) {
                      setMention(null)
                    }
                  }}
                />
                {mention && !!mentionMatches.length && (
                  <div className="mention-menu">
                    {mentionMatches.map((p, i) => (
                      <button key={p} className={`mention-item ${i === mentionSel ? 'on' : ''}`} onMouseEnter={() => setMentionSel(i)} onClick={() => applyMention(p)}>
                        <Icon name={fileTypeIcon(baseName(p))} size={11} />
                        <span className="mn-name">{baseName(p)}</span>
                        <span className="mn-path">{p}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="input-toolbar">
                  <div className="mode-toggle">
                    {(['agent', 'plan', 'ask'] as const).map((m) => (
                      <button
                        key={m}
                        className={mode === m ? 'on' : ''}
                        onClick={() => useChat.getState().setMode(m)}
                        title={m === 'agent' ? 'Agent edits files & runs tools' : m === 'plan' ? 'Plan first, execute after approval' : 'Answer only, no changes'}
                      >
                        {m === 'agent' ? 'Build' : m === 'plan' ? 'Plan' : 'Ask'}
                      </button>
                    ))}
                  </div>
                  <select className="depth-select" title="Thinking depth" value={thinkingLevel} onChange={(e) => useSettings.getState().setLocal({ thinkingLevel: e.target.value as never })}>
                    <option value="eco">{DEPTH_LABELS['eco']}</option>
                    <option value="balanced">{DEPTH_LABELS['balanced']}</option>
                    <option value="deep">{DEPTH_LABELS['deep']}</option>
                    <option value="max">{DEPTH_LABELS['max']}</option>
                  </select>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.json,.csv" style={{ display: 'none' }} onChange={(e) => { if (e.target.files) void processFiles(e.target.files); e.target.value='' }} />
                  <button className="tb-btn" title="Upload image/file" onClick={() => fileInputRef.current?.click()}>
                    <Icon name="image" size={13} />
                  </button>
                  <button
                    className={`tb-btn ${showInstructions || useChat.getState().customInstruction ? 'active' : ''}`}
                    title="Session instructions"
                    onClick={() => setShowInstructions((v) => !v)}
                  >
                    <Icon name="pencil" size={13} />
                  </button>
                  {streaming ? (
                    <button className="send-btn stop" onClick={() => import('../../agent/runner').then((r) => r.abortActiveRun())} title="Stop">
                      <Icon name="stop" size={13} />
                    </button>
                  ) : (
                    <button className="send-btn" onClick={() => send()} disabled={!input.trim() && !pendingAtts.length} title="Send (Enter)">
                      <Icon name="arrow-up" size={14} />
                    </button>
                  )}
                </div>
              </div>
              <div className="ai-bottom-bar">
                <ModelSelector />
                <TokenMeter />
                <ProjectDonut />
                <span style={{ flex: 1 }} />
                <button
                  className="tb-btn"
                  title="Input settings"
                  onClick={() => {
                    useUI.getState().setSettingsTab('router')
                    useUI.getState().setSettingsOpen(true)
                  }}
                >
                  <Icon name="sliders" size={13} />
                </button>
              </div>
            </div>
          </>
        )}

        {tab === 'context' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ContextPanel />
          </div>
        )}
        {tab === 'health' && <HealthTab />}
        {tab === 'rules' && <RulesTab />}
      </div>

      <div className="dock-rail">
        {DOCK_TABS.map((t) => (
          <button
            key={t.id}
            className={`dock-btn ${tab === t.id ? 'on' : ''}`}
            title={t.label}
            onClick={() => setTab(tab === t.id ? 'chat' : t.id)}
          >
            <Icon name={t.icon} size={16} />
            {t.id === 'context' && ctxFiles.length > 0 && (
              <span className="dock-badge" style={{ background: 'var(--text)', color: 'var(--bg0)' }}>
                {ctxFiles.length}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="dock-btn"
          title="Settings"
          onClick={() => {
            useUI.getState().setSettingsTab('router')
            useUI.getState().setSettingsOpen(true)
          }}
        >
          <Icon name="settings" size={16} />
        </button>
      </div>
    </div>
  )
}
