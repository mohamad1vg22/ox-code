import { useUI } from '../store/ui'

export function ConfirmDialog(): React.JSX.Element | null {
  const req = useUI((s) => s.confirmReq)
  const resolve = useUI((s) => s.resolveConfirm)
  if (!req) return null

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ width: 440 }}>
        <div className="modal-head">{req.title}</div>
        <div className="modal-body">
          {req.detail && (
            <pre
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 12,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                color: req.danger ? 'var(--red)' : 'var(--muted)',
                userSelect: 'text'
              }}
            >
              {req.detail}
            </pre>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn small ghost" onClick={() => resolve(req.id, false)}>
            Cancel
          </button>
          <button className={`btn small ${req.danger ? 'danger' : ''}`} onClick={() => resolve(req.id, true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toasts(): React.JSX.Element {
  const toasts = useUI((s) => s.toasts)
  const dismiss = useUI((s) => s.dismissToast)
  return (
    <div className="toast-zone">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          <div>
            <div className="t-title">{t.title}</div>
            {t.msg && <div className="t-msg">{t.msg}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
