import { useChat } from '../../store/chat'
import { useWorkspace } from '../../store/workspace'
import { Icon } from '../ui/Icon'

export function ContextPanel(): React.JSX.Element {
  const contextFiles = useChat((s) => s.contextFiles)
  const contextChars = useChat((s) => s.contextChars)
  const remove = useChat((s) => s.removeContextFile)
  const clear = useChat((s) => s.clearContext)
  const add = useChat((s) => s.addContextFile)
  const activePath = useWorkspace((s) => s.activePath)
  const tree = useWorkspace((s) => s.tree)

  const tokens = Math.ceil(contextChars / 4)

  return (
    <div>
      <div className="panel-header">
        <span>Context ({tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tok)</span>
        <button
          className="icon-btn"
          title="Clear context"
          onClick={() => clear()}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      {activePath && !contextFiles.includes(activePath) && (
        <div style={{ padding: '0 10px 8px' }}>
          <button className="btn small ghost" onClick={() => void add(activePath)}>
            <Icon name="plus" size={12} /> Add current file ({activePath})
          </button>
        </div>
      )}
      {contextFiles.map((f) => (
        <div key={f} className="ctx-chip">
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={11} style={{ color: 'var(--accent)' }} /> {f}
          </span>
          <button onClick={() => remove(f)} style={{ color: 'var(--faint)', display: 'inline-flex' }}><Icon name="x" size={11} /></button>
        </div>
      ))}
      {!contextFiles.length && (
        <div className="muted" style={{ padding: '4px 12px', lineHeight: 1.6 }}>
          No files pinned. The agent explores the project itself via its index and tools.
          Pin files here to always include them in the prompt.
          <br />
          <br />
          Right-click a file in the Explorer → “Add to AI Context”.
        </div>
      )}
    </div>
  )
}
