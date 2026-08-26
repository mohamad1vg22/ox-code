import { useWorkspace } from '../../store/workspace'
import { useUI } from '../../store/ui'
import { Icon } from '../ui/Icon'
import { handleSendMessage } from '../../agent/runner'

export interface QuickAction {
  icon: string
  label: string
  desc: string
  prompt: string
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    icon: 'search',
    label: 'Explore project',
    desc: 'Understand the structure, architecture and entry points.',
    prompt: 'Explain this project: structure, architecture and main entry points.'
  },
  {
    icon: 'bug',
    label: 'Fix a bug',
    desc: 'Find and fix the most important bug in this project.',
    prompt: 'Find and fix the most important bug in this project.'
  },
  {
    icon: 'sparkles',
    label: 'Add a feature',
    desc: 'Suggest and implement one high-value feature.',
    prompt: 'Suggest one high-value feature for this project and implement it.'
  },
  {
    icon: 'wrench',
    label: 'Refactor code',
    desc: 'Clean up the messiest file without changing behavior.',
    prompt: 'Refactor the messiest file in this project without changing behavior.'
  }
]

export function QuickActionGrid({
  actions,
  onEdit
}: {
  actions?: QuickAction[]
  onEdit?: (action: QuickAction) => void
}): React.JSX.Element {
  const list = actions ?? QUICK_ACTIONS
  return (
    <div className="qa-grid">
      {list.map((a) => (
        <button
          key={a.label}
          className="qa-card"
          onClick={() => (onEdit ? onEdit(a) : void handleSendMessage(a.prompt))}
        >
          <span className="qa-icon">
            <Icon name={a.icon} size={15} />
          </span>
          <span className="qa-body">
            <span className="qa-label">
              {a.label}
              <span
                className="qa-edit"
                title="Edit this prompt before sending"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit?.(a)
                }}
              >
                <Icon name="pencil" size={11} />
              </span>
            </span>
            <span className="qa-desc">{a.desc}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

export function WelcomeCenter(): React.JSX.Element {
  const rootName = useWorkspace((s) => s.rootName)
  const root = useWorkspace((s) => s.root)

  const editPrompt = (a: QuickAction): void => {
    // put the prompt into the AI input for editing before sending
    window.dispatchEvent(new CustomEvent('oxcode:fill-input', { detail: a.prompt }))
    if (!useUI.getState().aiPanelVisible) useUI.getState().toggleAIPanel()
  }

  return (
    <div className="welcome-center">
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
        <div className="wc-title">
          <span>OX</span> Code{rootName ? ` — ${rootName}` : ''}
        </div>
        <div className="wc-sub">
          {root
            ? 'An AI coding environment where the agent reads your project, writes code, runs commands and verifies its own work.'
            : 'Open a project folder to start — the agent can explore, edit and verify code across your whole workspace.'}
        </div>
      </div>

      <QuickActionGrid onEdit={editPrompt} />

      {!root && (
        <button className="btn medium" onClick={() => void useWorkspace.getState().openFolder()}>
          <Icon name="folder" size={13} /> Open Project Folder
        </button>
      )}

      <button
        className="palette-hint"
        onClick={() => useUI.getState().setPaletteOpen(true)}
        title="Open the command palette"
      >
        <span className="kbd">Ctrl</span>
        <span className="kbd">Shift</span>
        <span className="kbd">P</span>
        <span>Command Palette</span>
      </button>
    </div>
  )
}
