import { create } from 'zustand'

export type ToastKind = 'info' | 'error' | 'success'
export interface Toast {
  id: string
  kind: ToastKind
  title: string
  msg?: string
}

export interface ConfirmRequest {
  id: string
  title: string
  detail?: string
  danger?: boolean
  resolve: (ok: boolean) => void
}

interface UIState {
  sidebarVisible: boolean
  sidebarTab: 'explorer' | 'search' | 'git' | 'context'
  aiPanelVisible: boolean
  terminalVisible: boolean
  paletteOpen: boolean
  settingsOpen: boolean
  settingsTab: string
  diffModalPath: string | null
  toasts: Toast[]
  confirmReq: ConfirmRequest | null

  toggleSidebar: () => void
  toggleAIPanel: () => void
  toggleTerminal: () => void
  setSidebarTab: (t: UIState['sidebarTab']) => void
  setPaletteOpen: (v: boolean) => void
  setSettingsOpen: (v: boolean) => void
  setSettingsTab: (t: string) => void
  setDiffModalPath: (p: string | null) => void
  toast: (kind: ToastKind, title: string, msg?: string) => void
  dismissToast: (id: string) => void
  confirm: (title: string, opts?: { detail?: string; danger?: boolean }) => Promise<boolean>
  resolveConfirm: (id: string, ok: boolean) => void
}

export const useUI = create<UIState>((set, get) => ({
  sidebarVisible: true,
  sidebarTab: 'explorer',
  aiPanelVisible: true,
  terminalVisible: true,
  paletteOpen: false,
  settingsOpen: false,
  settingsTab: 'router',
  diffModalPath: null,
  toasts: [],
  confirmReq: null,

  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  toggleAIPanel: () => set((s) => ({ aiPanelVisible: !s.aiPanelVisible })),
  toggleTerminal: () => set((s) => ({ terminalVisible: !s.terminalVisible })),
  setSidebarTab: (t) => set({ sidebarTab: t }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setSettingsTab: (t) => set({ settingsTab: t }),
  setDiffModalPath: (p) => set({ diffModalPath: p }),

  toast: (kind, title, msg) => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { id, kind, title, msg }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 9000 : 4500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  confirm: (title, opts) =>
    new Promise<boolean>((resolve) => {
      set({
        confirmReq: {
          id: Math.random().toString(36).slice(2),
          title,
          detail: opts?.detail,
          danger: opts?.danger ?? false,
          resolve
        }
      })
    }),
  resolveConfirm: (_id, ok) => {
    const req = get().confirmReq
    req?.resolve(ok)
    set({ confirmReq: null })
  }
}))
