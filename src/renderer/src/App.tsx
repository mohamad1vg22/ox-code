import { useEffect, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { WorkspaceSidebar } from './components/WorkspaceSidebar'
import { InspectorPanel } from './components/InspectorPanel'
import { AIPanel } from './components/AI/AIPanel'
import { CommandPalette } from './components/CommandPalette'
import { SettingsModal } from './components/SettingsModal'
import { DiffViewer } from './components/DiffViewer'
import { ConfirmDialog, Toasts } from './components/Dialogs'
import { useUI } from './store/ui'
import { useSettings } from './store/settings'
import { useWorkspace, restoreLastWorkspace } from './store/workspace'

export default function App(): React.JSX.Element {
  const [inspectorOpen, setInspectorOpen] = useState(true)

  useEffect(() => {
    if (!window.oxcode) return

    void useSettings.getState().load()
    void import('./store/sessions').then((m) => m.initSessionSync())
    void restoreLastWorkspace()

    const offChanged = window.oxcode.analyze.onChanged((paths) => {
      void useWorkspace.getState().refreshTree()
      void useWorkspace.getState().refreshGitStatus()
      const changed = new Set(paths)
      const workspace = useWorkspace.getState()
      for (const tab of workspace.tabs) {
        if (changed.has(tab.path)) void workspace.reloadFileFromDisk(tab.path)
      }
    })

    const offUpdate = window.oxcode.update.onEvent((p) => {
      if (p.type === 'available') {
        useUI.getState().toast('info', `Update ${p.version} available`, 'Download it from the Command Palette ("Check for Updates").')
      } else if (p.type === 'progress') {
        useUI.getState().toast('info', 'Downloading update…', `${p.pct}%`)
      } else if (p.type === 'downloaded') {
        useUI.getState().toast('success', `Update ${p.version} ready`, 'Restart to install — "Check for Updates" in the palette.')
      }
    })

    // bridge main-process index invalidation into the renderer cache engine
    const offInvalidated = window.oxcode.index.onInvalidated(() =>
      window.dispatchEvent(new Event('oxcode:index-invalidated'))
    )

    const onKey = (event: KeyboardEvent): void => {
      const ui = useUI.getState()
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        ui.setPaletteOpen(!ui.paletteOpen)
      } else if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        ui.toggleSidebar()
      } else if (event.ctrlKey && event.key === '`') {
        event.preventDefault()
        ui.toggleTerminal()
      } else if (event.ctrlKey && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        ui.toggleAIPanel()
      } else if (event.ctrlKey && event.key === ',') {
        event.preventDefault()
        ui.setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      offChanged()
      offUpdate()
      offInvalidated()
    }
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <WorkspaceSidebar />
        <main className="workspace-main">
          <section className="chat-stage">
            <AIPanel />
          </section>
          <InspectorPanel open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
        </main>
        {!inspectorOpen && (
          <button className="inspector-reopen" title="Show inspector" onClick={() => setInspectorOpen(true)}>›</button>
        )}
      </div>
      <CommandPalette />
      <SettingsModal />
      <DiffViewer />
      <ConfirmDialog />
      <Toasts />
    </div>
  )
}
