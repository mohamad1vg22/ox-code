import { useMemo } from 'react'
import { useChat } from '../store/chat'
import { useUI } from '../store/ui'
import { computeDiff, collapseContext } from '../lib/diff'
import { changeStats } from '../core/verify'
import { Icon } from './ui/Icon'

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

export function DiffViewer(): React.JSX.Element | null {
  const path = useUI((s) => s.diffModalPath)
  const setPath = useUI((s) => s.setDiffModalPath)
  const changes = useChat((s) => s.pendingChanges).filter((c) => !c.reverted)
  const reject = useChat((s) => s.rejectPendingChange)
  const accept = useChat((s) => s.acceptPendingChange)
  const idx = changes.findIndex((c) => c.path === path)
  const change = idx >= 0 ? changes[idx] : undefined

  const lines = useMemo(
    () => (change ? collapseContext(computeDiff(change.before ?? '', change.after)) : []),
    [change]
  )

  if (!path || !change) return null
  const addCount = lines.filter((l) => l.type === 'add').length
  const delCount = lines.filter((l) => l.type === 'del').length
  const stats = changeStats(change)

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPath(null)}>
      <div className="modal wide">
        <div className="modal-head">
          {changes.length > 1 && (
            <button className="icon-btn" title={`Previous file (${idx + 1}/${changes.length})`} disabled={idx <= 0} style={{ opacity: idx <= 0 ? 0.3 : 1 }} onClick={() => setPath(changes[idx - 1].path)}>
              <Icon name="chevron-left" size={13} />
            </button>
          )}
          <span className="mono">{change.path}</span>
          {changes.length > 1 && (
            <span className="faint" style={{ fontSize: 11 }}>{idx + 1}/{changes.length}</span>
          )}
          {changes.length > 1 && (
            <button className="icon-btn" title="Next file" disabled={idx >= changes.length - 1} style={{ opacity: idx >= changes.length - 1 ? 0.3 : 1 }} onClick={() => setPath(changes[idx + 1].path)}>
              <Icon name="chevron-right" size={13} />
            </button>
          )}
          <span className="diff-stats" style={{ marginLeft: 12 }}>
            <span className="add-n">+{addCount}</span> <span className="del-n">−{delCount}</span>
            {!!stats.functionsDelta && (
              <span style={{ color: 'var(--violet)' }}>
                {' '}· {Math.abs(stats.functionsDelta)} function{Math.abs(stats.functionsDelta) > 1 ? 's' : ''}{' '}
                {stats.functionsDelta > 0 ? 'created' : 'removed'}
              </span>
            )}
          </span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setPath(null)}>
            <Icon name="x" size={13} />
          </button>
        </div>
        {changes.length > 1 && (
          <div className="dv-tabs">
            {changes.map((c, i) => (
              <button key={c.id} className={`dv-tab ${i === idx ? 'on' : ''}`} onClick={() => setPath(c.path)} title={c.path}>
                <Icon name={c.before === null ? 'file-plus' : 'pencil'} size={11} />
                {baseName(c.path)}
              </button>
            ))}
          </div>
        )}
        <div className="modal-body">
          <div className="diff-view">
            {lines.map((l, i) => (
              <div key={i} className={`diff-line ${l.type}`}>
                <span className="ln">{l.oldNo ?? l.newNo ?? ''}</span>
                <span className="sign" style={{ width: 18, flexShrink: 0 }}>
                  {l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}
                </span>
                <span style={{ flex: 1 }}>{l.text}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button
            className="btn small danger"
            onClick={async () => {
              await reject(change.id)
              if (changes.length > 1) {
                const next = changes.find((c) => c.path !== change.path)
                setPath(next?.path ?? null)
              } else {
                setPath(null)
              }
            }}
          >
            <Icon name="x" size={12} /> Reject (revert file)
          </button>
          <button
            className="btn small success"
            onClick={() => {
              accept(change.id)
              if (changes.length > 1) {
                const next = changes.find((c) => c.path !== change.path)
                setPath(next?.path ?? null)
              } else {
                setPath(null)
              }
            }}
          >
            <Icon name="check" size={12} /> Accept
          </button>
        </div>
      </div>
    </div>
  )
}
