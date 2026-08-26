import { useMemo } from 'react'
import { useChat } from '../store/chat'
import { useUI } from '../store/ui'
import { computeDiff, collapseContext } from '../lib/diff'
import { changeStats } from '../core/verify'
import { Icon } from './ui/Icon'

export function DiffViewer(): React.JSX.Element | null {
  const path = useUI((s) => s.diffModalPath)
  const setPath = useUI((s) => s.setDiffModalPath)
  const changes = useChat((s) => s.pendingChanges)
  const reject = useChat((s) => s.rejectPendingChange)
  const accept = useChat((s) => s.acceptPendingChange)
  const change = changes.find((c) => c.path === path && !c.reverted)

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
          <span className="mono">{change.path}</span>
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
              setPath(null)
            }}
          >
            <Icon name="x" size={12} /> Reject (revert file)
          </button>
          <button
            className="btn small success"
            onClick={() => {
              accept(change.id)
              setPath(null)
            }}
          >
            <Icon name="check" size={12} /> Accept
          </button>
        </div>
      </div>
    </div>
  )
}
