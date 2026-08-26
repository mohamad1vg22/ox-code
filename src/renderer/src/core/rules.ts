import { useWorkspace } from '../store/workspace'

/**
 * Auto-extracts real conventions from the project (deps, file layout, naming samples).
 * Produces suggested rules the user can accept/edit — never fabricated.
 */
export async function extractConventions(): Promise<string[]> {
  const ws = useWorkspace.getState()
  if (!ws.root) return []
  const rules: string[] = []
  try {
    const info = await window.oxcode.index.projectInfo()
    const deps: string[] = info.dependencies
    const langs = Object.keys(info.languages)
    if (langs.length) rules.push(`Primary languages: ${langs.join(', ')}`)
    if (info.languages['TypeScript']) rules.push('Use TypeScript (strict) for all new code')
    if (deps.some((d: string) => ['react', 'vue', 'svelte'].includes(d))) {
      rules.push(`UI framework in use: ${deps.find((d: string) => ['react', 'vue', 'svelte'].includes(d))} — follow its component patterns`)
    }
    const stateLib = deps.find((d: string) => ['zustand', 'redux', 'mobx', 'jotai', 'recoil'].includes(d))
    if (stateLib) rules.push(`State management: ${stateLib} — do not introduce another state library`)
    const testFW = deps.find((d: string) => ['vitest', 'jest', 'mocha'].includes(d))
    if (testFW) rules.push(`Tests use ${testFW}; test files follow existing *.test.* / *.spec.* layout`)
    if (deps.includes('prisma')) rules.push('Database access goes through Prisma models only')
    if (info.testDirs.length) rules.push(`Tests live under: ${info.testDirs.join(', ')}`)
  } catch {
    /* index not ready */
  }

  // naming style sample from symbol index
  try {
    const syms = ((await window.oxcode.index.symbols('')) as Array<{ name: string; kind: string }>) ?? []
    const funcs = syms.filter((s) => s.kind === 'function' && /^[a-z]/.test(s.name)).length
    const pascalfuncs = syms.filter((s) => s.kind === 'function' && /^[A-Z]/.test(s.name)).length
    if (funcs > pascalfuncs * 2) rules.push('Functions are camelCase; components/classes PascalCase')
  } catch {
    /* skip */
  }

  return rules
}

export function formatRulesForPrompt(rulesText: string): string {
  if (!rulesText.trim()) return ''
  return `\n--- PROJECT RULES (must be respected) ---\n${rulesText.trim()}\n`
}
