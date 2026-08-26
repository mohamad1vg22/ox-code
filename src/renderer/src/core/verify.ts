import type { PendingChange } from '../types'

export interface VerifyStepResult {
  name: string
  command: string
  ok: boolean
  output: string
}

export interface VerificationReport {
  available: boolean
  allOk: boolean
  steps: VerifyStepResult[]
}

/** Ask main which validation commands this project actually supports. */
export async function detectValidations(): Promise<Array<{ name: string; command: string; kind: string }>> {
  try {
    return (await window.oxcode.validate.detect()) as Array<{ name: string; command: string; kind: string }>
  } catch {
    return []
  }
}

/**
 * Runs the project's real validation pipeline (tests → typecheck → lint → build).
 * Returns an honest report; `available=false` means the project has nothing runnable.
 */
export async function runVerification(): Promise<VerificationReport> {
  const steps = await detectValidations()
  if (!steps.length) {
    return { available: false, allOk: false, steps: [] }
  }
  const results: VerifyStepResult[] = []
  // fail fast: stop at first failing step to save time
  for (const step of steps) {
    const r = (await window.oxcode.validate.run(step)) as { name: string; command: string; ok: boolean; output: string }
    results.push({ name: step.name, command: step.command, ok: r.ok, output: (r.output ?? '').slice(-4000) })
    if (!r.ok) break
  }
  return { available: true, allOk: results.every((r) => r.ok), steps: results }
}

function countFunctions(content: string): number {
  const matches = content.match(/(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\(|def\s+\w+|fn\s+\w+)/g)
  return matches?.length ?? 0
}

/** Diff statistics including function-level changes (real counts from content). */
export function changeStats(change: PendingChange): {
  added: number
  removed: number
  functionsDelta: number
} {
  const before = change.before ?? ''
  const after = change.after
  const added = after.split('\n').filter((l) => l.trim() && !before.includes(l)).length
  const removed = before.split('\n').filter((l) => l.trim() && !after.includes(l)).length
  return { added, removed, functionsDelta: countFunctions(after) - countFunctions(before) }
}
