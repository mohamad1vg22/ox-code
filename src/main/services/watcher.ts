import * as fs from 'fs'
import * as path from 'path'
import { getWorkspaceRoot } from './files'
import { updateFile, removeFromIndex } from './indexer'

let watcher: fs.FSWatcher | null = null
let notify: ((paths: string[]) => void) | null = null
let debounceTimer: NodeJS.Timeout | null = null
const pending = new Map<string, 'change' | 'unlink'>()

/**
 * Watches the workspace recursively (supported on Windows/macOS).
 * Emits debounced change batches and updates the symbol index incrementally.
 */
export function startWatching(root: string, cb: (paths: string[]) => void): void {
  stopWatching()
  notify = cb
  try {
    watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const rel = filename.split('\\').join('/')
      const top = rel.split('/')[0]
      if (
        top === 'node_modules' || top === '.git' || top === 'out' || top === 'dist' ||
        top === 'build' || top === '.next' || top === 'coverage' || top === '__pycache__'
      ) {
        return
      }
      pending.set(rel, fs.existsSync(path.join(root, filename)) ? 'change' : 'unlink')
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flush, 400)
    })
  } catch {
    /* recursive watch unsupported — degrade silently */
  }
}

function flush(): void {
  const root = getWorkspaceRoot()
  if (!root || !notify) return
  const changed: string[] = []
  for (const [rel, kind] of pending) {
    if (kind === 'change') void updateFile(rel).catch(() => {})
    else removeFromIndex(rel)
    changed.push(rel)
  }
  pending.clear()
  if (changed.length) notify(changed)
}

export function stopWatching(): void {
  watcher?.close()
  watcher = null
  if (debounceTimer) clearTimeout(debounceTimer)
  pending.clear()
}
