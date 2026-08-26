import { useEffect, useState } from 'react'
import { useChat } from '../store/chat'
import { useSettings } from '../store/settings'
import { useUI } from '../store/ui'
import { useWorkspace } from '../store/workspace'
import { EditorArea } from './Editor/EditorArea'
import { ContextPanel } from './Sidebar/ContextPanel'
import { HealthTab } from './AI/HealthTab'
import { Icon } from './ui/Icon'

type InspectorTab = 'project' | 'code' | 'context' | 'health'

export function InspectorPanel({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  const activePath = useWorkspace((s) => s.activePath)
  const root = useWorkspace((s) => s.root)
  const [tab, setTab] = useState<InspectorTab>(activePath ? 'code' : 'project')

  useEffect(() => {
    if (activePath) setTab('code')
  }, [activePath])

  if (!open) return null

  const select = (next: InspectorTab): void => setTab(next)

  return (
    <aside className="inspector-panel">
      <div className="inspector-head">
        <div>
          <span className="eyebrow">Inspector</span>
          <strong>{tab === 'project' ? 'Project pulse' : tab === 'code' ? 'Code view' : tab === 'context' ? 'AI context' : 'Project health'}</strong>
        </div>
        <button className="icon-btn" title="Hide inspector" onClick={onClose}><Icon name="chevron-right" size={14} /></button>
      </div>
      <div className="inspector-tabs">
        <InspectorButton active={tab === 'project'} icon="layers" label="Pulse" onClick={() => select('project')} />
        <InspectorButton active={tab === 'code'} icon="file-code" label="Code" onClick={() => select('code')} disabled={!activePath} />
        <InspectorButton active={tab === 'context'} icon="target" label="Context" onClick={() => select('context')} />
        <InspectorButton active={tab === 'health'} icon="activity" label="Health" onClick={() => select('health')} />
      </div>
      <div className={`inspector-content ${tab === 'code' ? 'inspector-code' : ''}`}>
        {tab === 'project' && <ProjectPulse root={root} />}
        {tab === 'code' && (activePath ? <EditorArea /> : <InspectorEmpty icon="file-code" title="No file selected" detail="Choose a file from the Files rail to inspect it here." />)}
        {tab === 'context' && <ContextPanel />}
        {tab === 'health' && <HealthTab />}
      </div>
    </aside>
  )
}

function InspectorButton({ active, icon, label, onClick, disabled }: { active: boolean; icon: string; label: string; onClick: () => void; disabled?: boolean }): React.JSX.Element {
  return <button className={`inspector-tab ${active ? 'active' : ''}`} title={label} disabled={disabled} onClick={onClick}><Icon name={icon} size={14} /></button>
}

function ProjectPulse({ root }: { root: string | null }): React.JSX.Element {
  const model = useSettings((s) => s.settings?.model ?? 'No model selected')
  const stats = useChat((s) => s.stats)
  const messages = useChat((s) => s.messages.length)
  const rootName = useWorkspace((s) => s.rootName)
  const branch = useBranch(root)

  if (!root) return <InspectorEmpty icon="folder-open" title="Your workspace is clear" detail="Open a project folder to see its structure, branch and AI context here." />

  return (
    <div className="pulse-view">
      <div className="pulse-project">
        <span className="pulse-mark">{rootName.slice(0, 1).toUpperCase() || 'O'}</span>
        <div><strong>{rootName}</strong><span>{branch || 'Local workspace'}</span></div>
      </div>
      <div className="pulse-list">
        <PulseRow icon="sparkles" label="Assistant" value={stats.status === 'idle' ? 'Ready' : stats.status} />
        <PulseRow icon="zap" label="Model" value={model.split('/').pop() ?? model} />
        <PulseRow icon="message-square" label="Messages" value={String(messages)} />
      </div>
      <div className="pulse-section">
        <span className="eyebrow">Workflow</span>
        <p>Build with the agent, keep the context focused, and review changes from the Health view.</p>
      </div>
      <button className="subtle-action" onClick={() => window.dispatchEvent(new CustomEvent('oxcode:workspace-view', { detail: 'files' }))}><Icon name="folder" size={13} /> Browse project files</button>
    </div>
  )
}

function PulseRow({ icon, label, value }: { icon: string; label: string; value: string }): React.JSX.Element {
  return <div className="pulse-row"><Icon name={icon} size={14} /><span>{label}</span><b title={value}>{value}</b></div>
}

function InspectorEmpty({ icon, title, detail }: { icon: string; title: string; detail: string }): React.JSX.Element {
  return <div className="inspector-empty"><span className="empty-icon"><Icon name={icon} size={18} /></span><strong>{title}</strong><p>{detail}</p></div>
}

function useBranch(root: string | null): string {
  const [branch, setBranch] = useState('')
  useEffect(() => {
    if (!root) {
      setBranch('')
      return
    }
    if (!window.oxcode) return
    void window.oxcode.git.run(['branch', '--show-current']).then((result) => setBranch(result.ok ? result.output.trim() : '')).catch(() => setBranch(''))
  }, [root])
  return branch
}
