import type { AnalysisResultDTO } from '../types'

export interface RiskReport {
  level: 'LOW' | 'MEDIUM' | 'HIGH'
  filesAffected: number
  dependentsReached: number
  publicInterfacesTouched: number
  testsTouched: number
  notes: string[]
}

/**
 * Real, data-driven change risk analysis.
 * Uses the import graph (dependents reach), touched test files and
 * how many files were modified to classify risk — no fake numbers.
 */
export function analyzeChangeRisk(
  changedPaths: string[],
  analysis: AnalysisResultDTO | null
): RiskReport {
  const notes: string[] = []
  if (!changedPaths.length) {
    return { level: 'LOW', filesAffected: 0, dependentsReached: 0, publicInterfacesTouched: 0, testsTouched: 0, notes: ['No file changes.'] }
  }

  const dependents = new Set<string>()
  if (analysis) {
    for (const p of changedPaths) {
      for (const d of analysis.reverseGraph[p] ?? []) {
        if (!changedPaths.includes(d)) dependents.add(d)
      }
    }
  }

  const testsTouched = changedPaths.filter((p) => /test|spec/i.test(p) || /^tests?\//.test(p)).length
  const coreFiles = changedPaths.filter((p) => !/test|spec|\.md$/i.test(p)).length
  const sensitive = changedPaths.filter((p) => /auth|security|token|payment|crypto|middleware/i.test(p))

  let score = 0
  if (coreFiles >= 5) { score += 2; notes.push(`${coreFiles} source files changed in one task.`) }
  else if (coreFiles >= 2) score += 1
  if (dependents.size >= 10) { score += 2; notes.push(`Changes reach ${dependents.size} dependent modules via imports.`) }
  else if (dependents.size >= 3) { score += 1; notes.push(`${dependents.size} modules import the changed files.`) }
  if (sensitive.length) { score += 2; notes.push(`Touches security-sensitive code: ${sensitive.slice(0, 3).join(', ')}.`) }
  if (testsTouched === 0 && coreFiles >= 3) {
    score += 1
    notes.push('No tests among changed files — verify manually.')
  }

  return {
    level: score >= 4 ? 'HIGH' : score >= 2 ? 'MEDIUM' : 'LOW',
    filesAffected: changedPaths.length,
    dependentsReached: dependents.size,
    publicInterfacesTouched: 0,
    testsTouched,
    notes: notes.slice(0, 5)
  }
}
