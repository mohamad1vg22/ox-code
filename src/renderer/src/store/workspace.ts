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
  gitStatus: Record<string, string> // relPath -> status letter (M/A/D/R/?)
  loadingTree: boolean

  openFolder: () => Promise<void>
  openPath: (root: string) => Promise<boolean>
  applyOpen: (res: { root: string; isGitRepo: boolean }) => Promise<void>
  refreshTree: () => Promise<void>
  refreshGitStatus: () => Promise<void>
  toggleExpand: (path: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeTab: (path: string) => void
  setActive: (path: string) => void
  updateContent: (path: string, content: string) => void
  saveFile: (path?: string) => Promise<void>
  reloadFileFromDisk: (path: string) => Promise<void>
}

const LS_WS_KEY = 'oxcode.workspace.v1'

function savePersisted(s: Pick<WorkspaceState, 'root' | 'tabs' | 'activePath' | 'expanded'>): void {
  try {
    if (!s.root) return
    localStorage.setItem(
      LS_WS_KEY,
      JSON.stringify({ root: s.root, tabs: s.tabs.map((t) => t.path), activePath: s.activePath, expanded: [...s.expanded] })
    )
  } catch {
    /* quota / private mode */
  }
}

export function loadLastRoot(): string | null {
  try {
    return JSON.parse(localStorage.getItem(LS_WS_KEY) ?? 'null')?.root ?? null
  } catch {
    return null
  }
}

export async function restoreLastWorkspace(): Promise<void> {
  const root = loadLastRoot()
  if (!root) return
  const ws = useWorkspace.getState()
  const ok = await ws.openPath(root)
  if (!ok) {
    localStorage.removeItem(LS_WS_KEY)
    return
  }
  let saved: { tabs?: string[]; activePath?: string; expanded?: string[] } = {}
  try {
    saved = JSON.parse(localStorage.getItem(LS_WS_KEY) ?? '{}')
  } catch {
    return
  }
  for (const p of saved.expanded ?? []) ws.toggleExpand(p)
  for (const p of (saved.tabs ?? []).slice(0, 12)) await ws.openFile(p)
  if (saved.activePath) ws.setActive(saved.activePath)
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
  gitStatus: {},
  loadingTree: false,

  openFolder: async () => {
    const res = await window.oxcode.workspace.open()
    if (!res) return
    await get().applyOpen(res)
  },

  openPath: async (root) => {
    const res = await window.oxcode.workspace.openPath(root)
    if (!res) return false
    await useWorkspace.getState().applyOpen(res)
    return true
  },

  applyOpen: async (res) => {
    set({ root: res.root, rootName: res.root.split(/[\\/]/).filter(Boolean).pop() ?? '', isGitRepo: res.isGitRepo, tree: null })
    await get().refreshTree()
    void get().refreshGitStatus()
  },

  refreshTree: async () => {
    if (!get().root) return
    set({ loadingTree: true })
    try {
      const tree = (await window.oxcode.files.tree()) as { children?: FileNodeDTO[] } | null
      set({ tree: tree?.children ?? [] })
    } catch {
      set({ tree: [] })
    } finally {
      set({ loadingTree: false })
    }
  },

  refreshGitStatus: async () => {
    if (!get().root || !get().isGitRepo) return
    const r = await window.oxcode.git.run(['status', '--porcelain'])
    if (!r.ok) return
    const map: Record<string, string> = {}
    for (const line of r.output.split('\n')) {
      if (!line.trim()) continue
      const x = line[0]
      const y = line[1]
      const p = line.slice(3).split(' -> ').pop()!.trim()
      map[p.replace(/"/g, '')] = x !== ' ' && x !== '?' ? x : y === '?' ? '?' : y
    }
    set({ gitStatus: map })
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

// persist workspace layout (debounced)
let wsPersistTimer: ReturnType<typeof setTimeout> | null = null
useWorkspace.subscribe((s) => {
  if (!s.root) return
  if (wsPersistTimer) clearTimeout(wsPersistTimer)
  wsPersistTimer = setTimeout(
    () => savePersisted({ root: s.root!, tabs: s.tabs, activePath: s.activePath, expanded: s.expanded }),
    500
  )
})
