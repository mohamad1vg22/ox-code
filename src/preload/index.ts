import { contextBridge, ipcRenderer } from 'electron'

const api = {
  window: {
    minimize: (): void => void ipcRenderer.send('window:minimize'),
    maximize: (): void => ipcRenderer.send('window:maximize'),
    close: (): void => ipcRenderer.send('window:close'),
    onMaximized: (cb: (max: boolean) => void): (() => void) => {
      const handler = (_e: unknown, max: boolean): void => cb(max)
      ipcRenderer.on('window:maximized', handler)
      return () => ipcRenderer.removeListener('window:maximized', handler)
    }
  },

  workspace: {
    open: (): Promise<{ root: string; isGitRepo: boolean } | null> => ipcRenderer.invoke('workspace:open')
  },

  files: {
    tree: (dir?: string) => ipcRenderer.invoke('files:tree', dir),
    read: (path: string): Promise<{ content: string; truncated: boolean }> =>
      ipcRenderer.invoke('files:read', path),
    write: (path: string, content: string): Promise<void> => ipcRenderer.invoke('files:write', path, content),
    create: (path: string, isDir: boolean, content?: string): Promise<boolean> =>
      ipcRenderer.invoke('files:create', path, isDir, content),
    delete: (path: string): Promise<boolean> => ipcRenderer.invoke('files:delete', path),
    rename: (from: string, to: string): Promise<boolean> => ipcRenderer.invoke('files:rename', from, to),
    exists: (path: string): Promise<boolean> => ipcRenderer.invoke('files:exists', path)
  },

  search: {
    code: (query: string, opts?: { caseSensitive?: boolean; regex?: boolean }) =>
      ipcRenderer.invoke('search:code', query, opts)
  },

  git: {
    run: (args: string[]): Promise<{ ok: boolean; output: string }> => ipcRenderer.invoke('git:run', args)
  },

  terminal: {
    run: (command: string): Promise<{ ok: boolean; code: number | null }> =>
      ipcRenderer.invoke('terminal:run', command),
    onData: (cb: (payload: { id: string; data: string }) => void): (() => void) => {
      const handler = (_e: unknown, payload: { id: string; data: string }): void => cb(payload)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    }
  },

  index: {
    rebuild: (): Promise<number> => ipcRenderer.invoke('index:rebuild'),
    symbols: (query: string) => ipcRenderer.invoke('index:symbols', query),
    projectInfo: () => ipcRenderer.invoke('index:projectInfo')
  },

  analyze: {
    project: () => ipcRenderer.invoke('analyze:project'),
    onChanged: (cb: (paths: string[]) => void): (() => void) => {
      const handler = (_e: unknown, paths: string[]): void => cb(paths)
      ipcRenderer.on('workspace:changed', handler)
      return () => ipcRenderer.removeListener('workspace:changed', handler)
    }
  },

  ai: {
    updateSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('ai:updateSettings', patch),
    getSettings: () => ipcRenderer.invoke('ai:getSettings'),
    listModels: (): Promise<string[]> => ipcRenderer.invoke('ai:listModels'),
    modelStatus: (models: string[]): Promise<Array<{ id: string; status: string; quotaPct?: number; remaining?: string; resetInSec?: number; resetAt?: string; queueSec?: number; planRequired?: string }>> =>
      ipcRenderer.invoke('ai:modelStatus', models),
    chat: (requestId: string, body: Record<string, unknown>): Promise<{ ok: boolean; error: string | null }> =>
      ipcRenderer.invoke('ai:chat', requestId, body),
    abort: (requestId: string): void => ipcRenderer.send('ai:abort', requestId),
    onChunk: (cb: (p: unknown) => void): (() => void) => {
      const handler = (_e: unknown, p: unknown): void => cb(p)
      ipcRenderer.on('ai:chunk', handler)
      return () => ipcRenderer.removeListener('ai:chunk', handler)
    },
    onDone: (cb: (p: unknown) => void): (() => void) => {
      const handler = (_e: unknown, p: unknown): void => cb(p)
      ipcRenderer.on('ai:done', handler)
      return () => ipcRenderer.removeListener('ai:done', handler)
    },
    onError: (cb: (p: unknown) => void): (() => void) => {
      const handler = (_e: unknown, p: unknown): void => cb(p)
      ipcRenderer.on('ai:error', handler)
      return () => ipcRenderer.removeListener('ai:error', handler)
    }
  },

  power: {
    startKeepAwake: (): Promise<boolean> => ipcRenderer.invoke('power:start'),
    stopKeepAwake: (): Promise<boolean> => ipcRenderer.invoke('power:stop')
  },

  validate: {
    detect: () => ipcRenderer.invoke('validate:detect'),
    run: (step: { name: string; command: string; kind: string }) => ipcRenderer.invoke('validate:run', step)
  },

  recentChanges: (): Promise<Array<{ path: string; modifiedAgoMin: number }>> => ipcRenderer.invoke('recent:changes'),

  rules: {
    load: (): Promise<string | null> => ipcRenderer.invoke('rules:load'),
    save: (text: string): Promise<boolean> => ipcRenderer.invoke('rules:save', text)
  }
}

contextBridge.exposeInMainWorld('oxcode', api)

export type OXCodeAPI = typeof api
