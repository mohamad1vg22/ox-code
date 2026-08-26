import { useEffect, useState } from 'react'
import { useSettings } from '../store/settings'
import { useChat } from '../store/chat'
import { useUI } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { useSessions } from '../store/sessions'
import { Icon } from './ui/Icon'

function SessionStatusIcon({ status }: { status: string }): React.JSX.Element {
  if (status === 'working') return <span className="session-live-dot" />
  if (status === 'done') return <Icon name="check" size={11} />
  if (status === 'error') return <Icon name="x" size={11} />
  return <span className="session-idle-dot" />
}

function SessionTabs(): React.JSX.Element {
  const sessions = useSessions((state) => state.sessions)
  const activeId = useSessions((state) => state.activeId)
  return (
    <div className="session-tabs">
      {sessions.map((session) => (
        <button key={session.id} className={`session-tab ${session.id === activeId ? 'active' : ''}`} title={session.title} onClick={() => useSessions.getState().switchSession(session.id)}>
          <span className={`session-status ${session.status}`}><SessionStatusIcon status={session.status} /></span>
          <span className="session-title">{session.title}</span>
          <span className="session-close" title="Close session" onClick={(event) => { event.stopPropagation(); useSessions.getState().closeSession(session.id) }}><Icon name="x" size={10} /></span>
        </button>
      ))}
      <button className="session-new" title="New session" onClick={() => useSessions.getState().newSession()}><Icon name="plus" size={14} /></button>
    </div>
  )
}

export function TitleBar(): React.JSX.Element {
  const rootName = useWorkspace((state) => state.rootName)
  const root = useWorkspace((state) => state.root)
  const streaming = useChat((state) => state.streaming)
  const error = useChat((state) => state.stats.error)
  const model = useSettings((state) => state.settings?.model ?? 'No model')
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void import('../store/sessions').then((module) => module.initSessionSync())
    if (!window.oxcode) return
    return window.oxcode.window.onMaximized(setMaximized)
  }, [])

  return (
    <header className="titlebar">
      <div className="brand-lockup">
        <span className="brand-mark">OX</span>
        <span className="brand-name">OX Code</span>
        <span className="brand-slash">/</span>
        <span className="brand-project" title={root ?? 'No project open'}>{rootName || 'Local workspace'}</span>
      </div>
      <SessionTabs />
      <div className="titlebar-actions">
        <span className={`top-status ${error ? 'error' : streaming ? 'working' : ''}`} title={error ?? `Using ${model}`}>
          <span className="top-status-dot" />
          {streaming ? 'Working' : error ? 'Needs attention' : 'Ready'}
        </span>
        <button className="title-icon" title="Open project folder" onClick={() => void useWorkspace.getState().openFolder()}><Icon name="folder-open" size={15} /></button>
        <button className="title-icon" title="Command palette" onClick={() => useUI.getState().setPaletteOpen(true)}><Icon name="search" size={15} /></button>
        <button className="title-icon" title="Settings" onClick={() => { useUI.getState().setSettingsTab('router'); useUI.getState().setSettingsOpen(true) }}><Icon name="settings" size={15} /></button>
        <span className="window-divider" />
        <button className="window-control" title="Minimize" onClick={() => window.oxcode.window.minimize()}><Icon name="minimize" size={13} /></button>
        <button className="window-control" title={maximized ? 'Restore' : 'Maximize'} onClick={() => window.oxcode.window.maximize()}><Icon name={maximized ? 'restore' : 'maximize'} size={12} /></button>
        <button className="window-control close" title="Close" onClick={() => window.oxcode.window.close()}><Icon name="x" size={14} /></button>
      </div>
    </header>
  )
}
