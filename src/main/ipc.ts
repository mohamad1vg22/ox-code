import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as filesSvc from './services/files'
import * as gitSvc from './services/git'
import * as terminalSvc from './services/terminal'
import * as indexerSvc from './services/indexer'
import * as aiSvc from './services/ai'
import * as watcherSvc from './services/watcher'
import { analyzeProject, type AnalysisResult } from './services/analyzer'
import { startKeepAwake, stopKeepAwake, isKeepingAwake } from './services/power'
import { detectValidations, recentChanges, type ValidationStep } from './services/validator'
import * as mcpSvc from './services/mcp'
import { initUpdater, checkForUpdates, downloadUpdate, installUpdate } from './updater'
import { createHash } from 'crypto'

type GetWindow = () => BrowserWindow | null

const aiRequests = new Map<string, AbortController>()

function rulesFileFor(root: string): string {
  const hash = createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 16)
  return path.join(app.getPath('userData'), 'projects', hash, 'rules.md')
}

export function registerIpc(getWindow: GetWindow): void {
  const win = () => getWindow()

  // ---------- window ----------
  ipcMain.on('window:minimize', () => win()?.minimize())
  ipcMain.on('window:maximize', () => {
    const w = win()
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on('window:close', () => win()?.close())

  // ---------- workspace / files ----------
  async function openRoot(root: string): Promise<{ root: string; isGitRepo: boolean }> {
    filesSvc.setWorkspaceRoot(root)
    terminalSvc.createSession('default', root)
    void indexerSvc.buildIndex()
    watcherSvc.startWatching(root, (paths) => {
      win()?.webContents.send('workspace:changed', paths)
      win()?.webContents.send('index:invalidated', null)
    })
    return { root, isGitRepo: await gitSvc.isGitRepo(root) }
  }

  ipcMain.handle('workspace:open', async () => {
    const result = await dialog.showOpenDialog(win()!, {
      properties: ['openDirectory'],
      title: 'Open Project Folder'
    })
    if (result.canceled || !result.filePaths[0]) return null
    return openRoot(result.filePaths[0])
  })

  ipcMain.handle('workspace:openPath', async (_e, root: string) => {
    try {
      const st = await fs.promises.stat(root)
      if (!st.isDirectory()) return null
    } catch {
      return null
    }
    return openRoot(root)
  })

  ipcMain.handle('files:tree', (_e, dir?: string) => filesSvc.listTree(dir))
  ipcMain.handle('files:read', (_e, p: string) => filesSvc.readFile(p))
  ipcMain.handle('files:write', (_e, p: string, content: string) => {
    indexerSvc.updateFile(p).catch(() => {})
    return filesSvc.writeFile(p, content)
  })
  ipcMain.handle('files:create', async (_e, p: string, isDir: boolean, content = '') => {
    if (isDir) {
      await fs.promises.mkdir(path.join(filesSvc.getWorkspaceRoot()!, p), { recursive: true })
    } else {
      await filesSvc.writeFile(p, content)
      void indexerSvc.updateFile(p)
    }
    return true
  })
  ipcMain.handle('files:delete', async (_e, p: string) => {
    await filesSvc.deleteEntry(p)
    indexerSvc.removeFromIndex(p)
    return true
  })
  ipcMain.handle('files:rename', async (_e, from: string, to: string) => {
    await filesSvc.renameEntry(from, to)
    indexerSvc.removeFromIndex(from)
    return true
  })
  ipcMain.handle('files:exists', (_e, p: string) => filesSvc.entryExists(p))
  ipcMain.handle('search:code', (_e, q: string, opts?: { caseSensitive?: boolean; regex?: boolean }) =>
    filesSvc.searchCode(q, opts ?? {})
  )

  // ---------- git ----------
  ipcMain.handle('git:run', async (_e, args: string[]) => {
    const root = filesSvc.getWorkspaceRoot()
    if (!root) throw new Error('No workspace open')
    return gitSvc.runGit(root, args)
  })

  // ---------- terminal ----------
  ipcMain.handle('terminal:run', async (_e, command: string) => {
    const emitter = (channel: string, payload: unknown) => win()?.webContents.send(channel, payload)
    const session = terminalSvc.getSession('default')
    if (!session) return { ok: false, code: null }
    const cwdBefore = session.cwd
    const result = await terminalSvc.runCommand('default', command, emitter)
    return { ...result, cwd: session.cwd !== cwdBefore ? session.cwd : undefined }
  })

  // ---------- project intelligence ----------
  ipcMain.handle('index:rebuild', async () => indexerSvc.buildIndex())
  ipcMain.handle('index:symbols', (_e, query: string) => indexerSvc.searchSymbols(query))
  ipcMain.handle('index:projectInfo', () => indexerSvc.getProjectInfo())
  ipcMain.handle('analyze:project', async (): Promise<AnalysisResult> => analyzeProject())

  // ---------- AI ----------
  ipcMain.handle('ai:updateSettings', (_e, patch: Partial<aiSvc.AISettings>) => aiSvc.updateAISettings(patch))
  ipcMain.handle('ai:getSettings', () => aiSvc.getAISettings())
  ipcMain.handle('ai:listModels', () => aiSvc.listModels())
  ipcMain.handle('ai:modelStatus', async (_e, models: string[]) => aiSvc.checkModelQuotas(models ?? []))

  ipcMain.handle('ai:chat', async (_e, requestId: string, body: Record<string, unknown>) => {
    const abortRef: { current: AbortController | null } = { current: null }
    const controller = new AbortController()
    aiRequests.set(requestId, controller)
    abortRef.current = controller

    const send = (channel: string, payload: unknown) => win()?.webContents.send(channel, payload)
    let lastError: string | null = null

    await aiSvc.streamChat(
      body,
      abortRef,
      {
        onChunk: (text) => send('ai:chunk', { requestId, type: 'text', delta: text }),
        onToolCallDelta: (index, id, name, argsDelta) =>
          send('ai:chunk', { requestId, type: 'tool_call', index, id, name, delta: argsDelta }),
        onDone: (finishReason, usage) => {
          send('ai:done', { requestId, finishReason, usage })
          aiRequests.delete(requestId)
        },
        onError: (message) => {
          lastError = message
          send('ai:error', { requestId, message })
          aiRequests.delete(requestId)
        }
      }
    )
    return { ok: !lastError, error: lastError }
  })

  ipcMain.on('ai:abort', (_e, requestId: string) => {
    const c = aiRequests.get(requestId)
    if (c) {
      try { c.abort() } catch {}
      aiRequests.delete(requestId)
    }
  })

  // ---------- power / keep-awake ----------
  ipcMain.handle('power:start', () => {
    startKeepAwake()
    return isKeepingAwake()
  })
  ipcMain.handle('power:stop', () => {
    stopKeepAwake()
    return isKeepingAwake()
  })

  // ---------- validation / health ----------
  ipcMain.handle('validate:detect', () => detectValidations())
  ipcMain.handle(
    'validate:run',
    (_e, step: ValidationStep) => {
      const emitter = (channel: string, payload: unknown): void => win()?.webContents.send(channel, payload)
      // route through the visible default session so the user sees verification runs
      const root = filesSvc.getWorkspaceRoot()
      if (root) terminalSvc.createSession('default', root)
      return terminalSvc.runCommand('default', step.command, emitter).then((r) => ({
        ...step,
        ok: r.ok,
        output: r.output ?? '',
        durationMs: 0
      }))
    }
  )
  ipcMain.handle('recent:changes', () => recentChanges())

  // ---------- project memory / rules ----------
  ipcMain.handle('rules:load', async () => {
    const root = filesSvc.getWorkspaceRoot()
    if (!root) return null
    const file = rulesFileFor(root)
    try {
      return await fs.promises.readFile(file, 'utf-8')
    } catch {
      return ''
    }
  })
  ipcMain.handle('rules:save', async (_e, text: string) => {
    const root = filesSvc.getWorkspaceRoot()
    if (!root) return false
    const file = rulesFileFor(root)
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(file, text, 'utf-8')
    return true
  })

  // ---------- MCP (external tool servers) ----------
  ipcMain.handle('mcp:list', () => mcpSvc.listTools())
  ipcMain.handle('mcp:add', (_e, cfg: mcpSvc.McpServerConfig) => mcpSvc.addServer(cfg))
  ipcMain.handle('mcp:remove', (_e, name: string) => mcpSvc.removeServer(name))
  ipcMain.handle(
    'mcp:call',
    (_e, server: string, tool: string, args: Record<string, unknown>) => mcpSvc.callTool(server, tool, args)
  )

  // ---------- auto-update ----------
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.on('update:download', () => downloadUpdate())
  ipcMain.on('update:install', () => installUpdate())

  void initUpdater((channel, payload) => win()?.webContents.send(channel, payload))
}
