import { create } from 'zustand'
import type { FileNodeDTO } from '../types'

export interface OpenTab {
  path: string
  name: string
  language: string
  dirty: boolean
}

function detectLanguage(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'html',
    py: 'python', rs: 'rust', go: 'go', java: 'java', cs: 'csharp', rb: 'ruby',
    php: 'php', c: 'c', cpp: 'cpp', h: 'cpp', sql: 'sql', sh: 'shell',
    yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', vue: 'html', svelte: 'html'
  }
  return map[ext] ?? 'plaintext'
}

interface WorkspaceState {
  root: string | null
  rootName: string
  isGitRepo: boolean
  tree: FileNodeDTO[] | null
  expanded: Set<string>
  tabs: OpenTab[]
  activePath: string | null
  contents: Record<string, string> // open tab contents
  loadingTree: boolean

  openFolder: () => Promise<void>
  refreshTree: () => Promise<void>
  toggleExpand: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeTab: (path: string) => void
  setActive: (path: string) => void
  updateContent: (path: string, content: string) => void
  saveFile: (path?: string) => Promise<void>
  reloadFileFromDisk: (path: string) => Promise<void>
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  root: null,
  rootName: '',
  isGitRepo: false,
  tree: null,
  expanded: new Set(),
  tabs: [],
  activePath: null,
  contents: {},
  loadingTree: false,

  openFolder: async () => {
    const res = await window.oxcode.workspace.open()
    if (!res) return
    set({ root: res.root, rootName: res.root.split(/[\\/]/).filter(Boolean).pop() ?? '', isGitRepo: res.isGitRepo, tree: null })
    await get().refreshTree()
  },

  refreshTree: async () => {
    if (!get().root) return
    set({ loadingTree: true })
    try {
      const tree = await window.oxcode.files.tree()
      set({ tree: tree.children ?? [] })
    } finally {
      set({ loadingTree: false })
    }
  },

  toggleExpand: async (path) => {
    const expanded = new Set(get().expanded)
    if (expanded.has(path)) expanded.delete(path)
    else expanded.add(path)
    set({ expanded })
  },

  openFile: async (path) => {
    const tabs = get().tabs
    if (!tabs.find((t) => t.path === path)) {
      const name = path.split('/').pop() ?? path
      let content = ''
      try {
        const r = await window.oxcode.files.read(path)
        content = r.content
      } catch (e) {
        content = ''
      }
      set({
        tabs: [...tabs, { path, name, language: detectLanguage(name), dirty: false }],
        contents: { ...get().contents, [path]: content }
      })
    }
    set({ activePath: path })
  },

  closeTab: (path) => {
    const tabs = get().tabs.filter((t) => t.path !== path)
    const contents = { ...get().contents }
    delete contents[path]
    const activePath =
      get().activePath === path ? (tabs.length ? tabs[tabs.length - 1].path : null) : get().activePath
    set({ tabs, contents, activePath })
  },

  setActive: (path) => set({ activePath: path }),

  updateContent: (path, content) => {
    set({
      contents: { ...get().contents, [path]: content },
      tabs: get().tabs.map((t) => (t.path === path ? { ...t, dirty: true } : t))
    })
  },

  saveFile: async (path?) => {
    const target = path ?? get().activePath
    if (!target) return
    const content = get().contents[target]
    if (content === undefined) return
    await window.oxcode.files.write(target, content)
    set({ tabs: get().tabs.map((t) => (t.path === target ? { ...t, dirty: false } : t)) })
  },

  reloadFileFromDisk: async (path) => {
    try {
      const r = await window.oxcode.files.read(path)
      set({ contents: { ...get().contents, [path]: r.content } })
      set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, dirty: false } : t)) })
    } catch {
      /* deleted */
    }
  }
}))
