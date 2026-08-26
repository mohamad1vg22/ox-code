import { powerSaveBlocker } from 'electron'

let blockerId: number | null = null

/** Prevent system sleep while the AI agent is working. */
export function startKeepAwake(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) return
  blockerId = powerSaveBlocker.start('prevent-app-suspension')
}

export function stopKeepAwake(): void {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId)
  }
  blockerId = null
}

export function isKeepingAwake(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}
