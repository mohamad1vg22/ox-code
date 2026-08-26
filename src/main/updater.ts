import { autoUpdater } from 'electron-updater'

type Send = (channel: string, payload: unknown) => void

export function initUpdater(send: Send): void {
  autoUpdater.autoDownload = false

  autoUpdater.on('update-available', (info) => send('update:event', { type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send('update:event', { type: 'none' }))
  autoUpdater.on('download-progress', (p) => send('update:event', { type: 'progress', pct: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send('update:event', { type: 'downloaded', version: info.version }))
  autoUpdater.on('error', (e) => send('update:event', { type: 'error', message: e.message }))

  // silent background check shortly after launch (packaged builds only)
  setTimeout(() => checkForUpdates(), 15000)
}

export function checkForUpdates(): void {
  if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_RENDERER_URL) return
  autoUpdater.checkForUpdates().catch(() => {})
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch(() => {})
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}
