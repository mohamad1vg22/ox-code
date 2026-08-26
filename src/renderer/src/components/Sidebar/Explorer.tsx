import { useCallback, useState } from 'react'
import type { FileNodeDTO } from '../../types'
import { useWorkspace } from '../../store/workspace'
import { useChat } from '../../store/chat'
import { useUI } from '../../store/ui'
import { Icon, fileTypeIcon } from '../ui/Icon'

function TreeRow({ node, depth, filter }: { node: FileNodeDTO; depth: number; filter: string }): React.JSX.Element | null {
  const expanded = useWorkspace((s) => s.expanded.has(node.path))
  const activePath = useWorkspace((s) => s.activePath)
  const toggleExpand = useWorkspace((s) => s.toggleExpand)
  const openFile = useWorkspace((s) => s.openFile)

  // when filtering, show matching files and dirs containing matches
  const matchesFilter = (n: FileNodeDTO): boolean => {
    if (!filter) return true
    const lower = n.path.toLowerCase()
    if (lower.includes(filter)) return true
    return (n.children ?? []).some((c) => (c.type === 'file' && c.path.toLowerCase().includes(filter)) || matchesFilter(c))
  }
  if (filter && !matchesFilter(node)) return null

  const onClick = (): void => {
    if (node.type === 'dir') void toggleExpand(node.path)
    else void openFile(node.path)
  }
  const autoExpand = Boolean(filter) && node.type === 'dir'

  return (
    <>
      <div
        className={`tree-row ${node.type} ${activePath === node.path ? 'active' : ''}`}
        style={{ paddingLeft: 10 + depth * 13 }}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault()
          showNodeMenu(e, node)
        }}
      >
        <span className={`chev ${expanded || autoExpand ? 'open' : ''}`}>
          {node.type === 'dir' ? <Icon name="chevron-right" size={10} /> : ''}
        </span>
        <span className="icon" style={{ display: 'inline-flex' }}>
          {node.type === 'dir' ? (
            <Icon name={expanded || autoExpand ? 'folder-open' : 'folder'} size={13} />
          ) : (
            <Icon name={fileTypeIcon(node.name)} size={13} />
          )}
        </span>
        <span className="name">{node.name}</span>
      </div>
      {node.type === 'dir' && (expanded || autoExpand) && (
        <div className="tree-children">
          {node.children?.map((c) => (
            <TreeRow key={c.path} node={c} depth={depth + 1} filter={filter} />
          ))}
        </div>
      )}
    </>
  )
}

function showNodeMenu(e: React.MouseEvent, node: FileNodeDTO): void {
  const menu = document.createElement('div')
  menu.style.cssText =
    'position:fixed;z-index:999;background:#1c2230;border:1px solid #232b3a;border-radius:8px;padding:4px;box-shadow:0 10px 30px rgba(0,0,0,.5);min-width:180px'
  const items: Array<[string, () => void]> = [
    ['Add to AI Context', () => void useChat.getState().addContextFile(node.path)],
    [
      'New File',
      async () => {
        const name = prompt('New file path:')
        if (!name) return
        await window.oxcode.files.create(name, false, '')
        await useWorkspace.getState().refreshTree()
        void useWorkspace.getState().openFile(name)
      }
    ],
    [
      'New Folder',
      async () => {
        const name = prompt('New folder path:')
        if (!name) return
        await window.oxcode.files.create(name, true)
        await useWorkspace.getState().refreshTree()
      }
    ],
    [
      'Rename',
      async () => {
        const to = prompt('Rename to:', node.path)
        if (!to || to === node.path) return
        await window.oxcode.files.rename(node.path, to)
        await useWorkspace.getState().refreshTree()
      }
    ],
    [
      'Delete',
      async () => {
        const ok = await useUI.getState().confirm(`Delete "${node.name}"?`, { danger: true })
        if (!ok) return
        await window.oxcode.files.delete(node.path)
        await useWorkspace.getState().refreshTree()
      }
    ]
  ]
  for (const [label, fn] of items) {
    const item = document.createElement('div')
    item.textContent = label
    item.style.cssText = 'padding:6px 12px;font-size:12.5px;cursor:pointer;border-radius:5px;color:#dbe2ee'
    item.onmouseenter = () => (item.style.background = '#232b3a')
    item.onmouseleave = () => (item.style.background = 'transparent')
    item.onclick = () => {
      document.body.removeChild(menu)
      void fn()
    }
    menu.appendChild(item)
  }
  document.body.appendChild(menu)
  setTimeout(() => {
    const closer = (): void => {
      if (document.body.contains(menu)) document.body.removeChild(menu)
      document.removeEventListener('click', closer)
    }
    document.addEventListener('click', closer)
  })
  const rect = menu.getBoundingClientRect()
  menu.style.left = Math.min(e.clientX, window.innerWidth - rect.width - 8) + 'px'
  menu.style.top = Math.min(e.clientY, window.innerHeight - rect.height - 8) + 'px'
}

export function Explorer(): React.JSX.Element {
  const tree = useWorkspace((s) => s.tree)
  const root = useWorkspace((s) => s.root)
  const openFolder = useWorkspace((s) => s.openFolder)
  const refreshTree = useWorkspace((s) => s.refreshTree)
  const [filter, setFilter] = useState('')

  if (!root) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--faint)', lineHeight: 1.8 }}>
        <p>No project open.</p>
        <br />
        <button className="btn small" onClick={() => void openFolder()}>
          Open Folder
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="panel-header">
        <span>Explorer</span>
        <span style={{ display: 'flex', gap: 2 }}>
          <button className="icon-btn" title="New file" onClick={async () => {
            const name = prompt('New file path:')
            if (!name) return
            await window.oxcode.files.create(name, false, '')
            await refreshTree()
            void useWorkspace.getState().openFile(name)
          }}><Icon name="file-plus" size={14} /></button>
          <button className="icon-btn" title="Refresh" onClick={() => void refreshTree()}>
            <Icon name="refresh" size={13} />
          </button>
        </span>
      </div>
      <div className="explorer-filter">
        <input placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value.toLowerCase())} />
      </div>
      {tree?.map((n) => (
        <TreeRow key={n.path} node={n} depth={0} filter={filter} />
      ))}
    </div>
  )
}
