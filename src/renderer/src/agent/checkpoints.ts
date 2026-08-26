interface Snapshot {
  path: string
  content: string | null // null = file did not exist before (created by agent)
}

const checkpoints = new Map<string, Snapshot[]>()
const order: string[] = []

export async function snapshot(runId: string, path: string): Promise<void> {
  let list = checkpoints.get(runId)
  if (!list) {
    list = []
    checkpoints.set(runId, list)
    order.push(runId)
    if (order.length > 20) {
      const oldest = order.shift()
      if (oldest) checkpoints.delete(oldest)
    }
  }
  const exists = await window.oxcode.files.exists(path)
  let content: string | null = null
  if (exists) {
    try {
      content = (await window.oxcode.files.read(path)).content
    } catch {
      content = ''
    }
  }
  list.push({ path, content })
}

export async function rollback(runId: string): Promise<number> {
  const list = checkpoints.get(runId)
  if (!list) return 0
  for (const snap of [...list].reverse()) {
    if (snap.content === null) {
      await window.oxcode.files.delete(snap.path).catch(() => {})
    } else {
      await window.oxcode.files.write(snap.path, snap.content).catch(() => {})
    }
  }
  checkpoints.delete(runId)
  return list.length
}
