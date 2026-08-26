import { useEffect, useState } from 'react'
import { useUI } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { useChat } from '../store/chat'
import { Explorer } from './Sidebar/Explorer'
import { GitPanel } from './Sidebar/GitPanel'
import { TerminalPanel } from './Terminal/TerminalPanel'
import { Icon } from './ui/Icon'

type SideView = 'project' | 'files' | 'git' | 'terminal' | 'settings'

const SIDE_ACTIONS: Array<{ id: Exclude<SideView, 'project' | 'settings'>; icon: string; label: string }> = [
  { id: 'files', icon: 'folder', label: 'Files' },
  { id: 'git', icon: 'git-branch', label: 'Source control' },
  { id: 'terminal', icon: 'terminal', label: 'Terminal' }
]

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'OX'
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export function WorkspaceSidebar(): React.JSX.Element | null {
  const visible = useUI((s) => s.sidebarVisible)
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState<SideView>('project')
  const root = useWorkspace((s) => s.root)
  const rootName = useWorkspace((s) => s.rootName)
  const contextCount = useChat((s) => s.contextFiles.length)

  useEffect(() => {
    const onView = (event: Event): void => {
      const next = (event as CustomEvent<SideView>).detail
      if (next) {
        setView(next)
        setExpanded(true)
      }
    }
    window.addEventListener('oxcode:workspace-view', onView)
    return () => window.removeEventListener('oxcode:workspace-view', onView)
  }, [])

  if (!visible) return null

  const selectView = (next: SideView): void => {
    setView(next)
    if (next === 'terminal' && !useUI.getState().terminalVisible) useUI.getState().toggleTerminal()
    if (next === 'settings') {
      useUI.getState().setSettingsTab('router')
      useUI.getState().setSettingsOpen(true)
    }
  }

  return (
    <aside className={`workspace-sidebar ${expanded ? 'expanded' : 'collapsed'}`}>
      <div className="workspace-rail">
        <button className="workspace-avatar" title={root ? `Workspace: ${rootName}` : 'OX Code workspace'} onClick={() => selectView('project')}>
          {initials(rootName)}
        </button>
        <div className="rail-divider" />
        <button className={`workspace-project ${view === 'project' ? 'active' : ''}`} title={root ? rootName : 'Open a project'} onClick={() => selectView('project')}>
          <span className="project-monogram">{root ? initials(rootName).slice(0, 1) : <Icon name="plus" size={13} />}</span>
          {root && <span className="project-count">{contextCount || ''}</span>}
        </button>
        <button className="rail-add" title="Open project folder" onClick={() => void useWorkspace.getState().openFolder()}>
          <Icon name="plus" size={15} />
        </button>
        <div className="rail-spacer" />
        {SIDE_ACTIONS.map((action) => (
          <button key={action.id} className={`rail-action ${view === action.id ? 'active' : ''}`} title={action.label} onClick={() => selectView(action.id)}>
            <Icon name={action.icon} size={17} />
            {action.id === 'files' && contextCount > 0 && <span className="rail-badge">{contextCount}</span>}
          </button>
        ))}
        <div className="rail-divider" />
        <button className="rail-action" title="Settings" onClick={() => selectView('settings')}>
          <Icon name="settings" size={16} />
        </button>
        <button className="rail-action rail-collapse" title={expanded ? 'Collapse sidebar' : 'Expand sidebar'} onClick={() => setExpanded((value) => !value)}>
          <Icon name={expanded ? 'chevron-left' : 'chevron-right'} size={15} />
        </button>
      </div>

      {expanded && (
        <div className="workspace-panel">
          <div className="workspace-panel-head">
            <div>
              <span className="eyebrow">Workspace</span>
              <strong>{view === 'project' ? rootName || 'Local workspace' : view === 'files' ? 'Files' : view === 'git' ? 'Source control' : view === 'terminal' ? 'Terminal' : 'Settings'}</strong>
            </div>
            <button className="icon-btn" title="Collapse sidebar" onClick={() => setExpanded(false)}>
              <Icon name="chevron-left" size={14} />
            </button>
          </div>

          {view === 'project' && <ProjectOverview root={root} rootName={rootName} onOpen={() => void useWorkspace.getState().openFolder()} />}
          {view === 'files' && <Explorer />}
          {view === 'git' && <GitPanel />}
          {view === 'terminal' && <TerminalPanel embedded />}
          {view === 'settings' && <SettingsHint />}
        </div>
      )}
    </aside>
  )
}

function ProjectOverview({ root, rootName, onOpen }: { root: string | null; rootName: string; onOpen: () => void }): React.JSX.Element {
  const tree = useWorkspace((s) => s.tree)
  const isGitRepo = useWorkspace((s) => s.isGitRepo)

  return (
    <div className="project-overview">
      <div className="project-identity">
        <span className="project-avatar">{root ? initials(rootName).slice(0, 1) : <Icon name="folder-open" size={17} />}</span>
        <div>
          <strong>{rootName || 'No project open'}</strong>
          <span>{root ? (isGitRepo ? 'Git workspace' : 'Local folder') : 'Start with a folder'}</span>
        </div>
      </div>
      {root ? (
        <>
          <div className="workspace-stat-row">
            <span><b>{tree?.length ?? '—'}</b> top-level items</span>
            <span className={isGitRepo ? 'status-good' : ''}>{isGitRepo ? 'Git ready' : 'No Git'}</span>
          </div>
          <p className="project-note">Open a file from the Files view, or ask the agent to explore the whole project.</p>
          <button className="text-action" onClick={() => window.dispatchEvent(new CustomEvent('oxcode:workspace-view', { detail: 'files' }))}>
            <Icon name="folder" size={13} /> Browse files
          </button>
        </>
      ) : (
        <>
          <p className="project-note">Open a local folder to let OX Code understand, edit and verify your code.</p>
          <button className="primary-action" onClick={onOpen}>
            <Icon name="folder-open" size={14} /> Open project folder
          </button>
        </>
      )}
    </div>
  )
}

function SettingsHint(): React.JSX.Element {
  return (
    <div className="project-overview">
      <span className="overview-icon"><Icon name="sliders" size={17} /></span>
      <strong>Workspace settings</strong>
      <p className="project-note">Provider, model, editor and agent preferences live in one quiet panel.</p>
      <button className="primary-action" onClick={() => useUI.getState().setSettingsOpen(true)}>
        <Icon name="settings" size={14} /> Open settings
      </button>
    </div>
  )
}
