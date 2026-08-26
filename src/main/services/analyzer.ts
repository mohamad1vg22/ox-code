import * as fs from 'fs'
import * as path from 'path'
import { getWorkspaceRoot, isTextFile } from './files'

export interface AnalysisResult {
  graph: Record<string, string[]> // file -> local deps
  reverseGraph: Record<string, string[]>
  cycles: string[][]
  orphans: string[]
  hubs: Array<{ file: string; dependents: number }>
  totalFiles: number
  totalEdges: number
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', 'target', '.idea', 'coverage'
])

const JS_EXTS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte']
const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|from\s+)['"]([^'"]+)['"]/g

function collectSourceFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string, relDir: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue
        await walk(path.join(dir, e.name), relDir ? `${relDir}/${e.name}` : e.name)
      } else if (e.isFile()) {
        const ext = e.name.split('.').pop()?.toLowerCase() ?? ''
        if ((JS_EXTS.includes(ext) || ext === 'py') && isTextFile(e.name)) {
          out.push(relDir ? `${relDir}/${e.name}` : e.name)
        }
      }
    }
  }
  return walk(root, '').then(() => out)
}

function extractImports(content: string): string[] {
  const specs: string[] = []
  const pyRe = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm
  if (/^\s*(?:from|import)\s+\w+/m.test(content) && !/(?:import|require)\s*[\s(]*['"]/.test(content)) {
    let m: RegExpExecArray | null
    while ((m = pyRe.exec(content))) specs.push(m[1] ?? m[2] ?? '')
    return specs.filter(Boolean)
  }
  let m: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content))) specs.push(m[1])
  return specs
}

function resolveSpec(spec: string, fromFile: string, fileSet: Set<string>): string | null {
  if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('~/')) {
    // python relative-ish module path
    if (!spec.includes('.')) {
      const base = spec.split('.').join('/')
      for (const cand of [`${base}.py`, `${base}/__init__.py`]) {
        if (fileSet.has(cand)) return cand
      }
    }
    return null // external package
  }
  let rel = spec.replace(/^@\//, 'src/').replace(/^~\//, 'src/')
  if (rel.startsWith('.')) rel = path.posix.join(path.posix.dirname(fromFile), rel)

  const candidates = [
    rel,
    `${rel}.ts`, `${rel}.tsx`, `${rel}.js`, `${rel}.jsx`, `${rel}.mjs`, `${rel}.py`,
    `${rel}/index.ts`, `${rel}/index.tsx`, `${rel}/index.js`, `${rel}/__init__.py`
  ]
  for (const c of candidates) if (fileSet.has(c)) return c
  return null
}

export async function analyzeProject(): Promise<AnalysisResult> {
  const root = getWorkspaceRoot()
  const empty: AnalysisResult = { graph: {}, reverseGraph: {}, cycles: [], orphans: [], hubs: [], totalFiles: 0, totalEdges: 0 }
  if (!root) return empty

  const files = await collectSourceFiles(root)
  const fileSet = new Set(files)
  const graph: Record<string, string[]> = {}
  let edges = 0

  for (const f of files) {
    try {
      const stat = await fs.promises.stat(path.join(root, f))
      if (stat.size > 512 * 1024) { graph[f] = []; continue }
      const content = await fs.promises.readFile(path.join(root, f), 'utf-8')
      const deps = new Set<string>()
      for (const spec of extractImports(content)) {
        const resolved = resolveSpec(spec, f, fileSet)
        if (resolved && resolved !== f) deps.add(resolved)
      }
      graph[f] = [...deps]
      edges += deps.size
    } catch {
      graph[f] = []
    }
  }

  // reverse graph + hubs
  const reverseGraph: Record<string, string[]> = {}
  for (const f of files) reverseGraph[f] ??= []
  for (const [f, deps] of Object.entries(graph)) {
    for (const d of deps) (reverseGraph[d] ??= []).push(f)
  }

  // cycle detection (iterative DFS, three-color)
  const color = new Map<string, number>() // 0 white 1 gray 2 black
  const stack: string[] = []
  const cycles: string[][] = []
  const seenCycles = new Set<string>()

  function dfs(start: string): void {
    type Frame = { node: string; iter: number }
    const callStack: Frame[] = [{ node: start, iter: 0 }]
    stack.length = 0
    while (callStack.length) {
      const top = callStack[callStack.length - 1]
      if (top.iter === 0) {
        color.set(top.node, 1)
        stack.push(top.node)
      }
      const deps = graph[top.node] ?? []
      if (top.iter < deps.length) {
        const next = deps[top.iter++]
        const c = color.get(next) ?? 0
        if (c === 1) {
          const idx = stack.indexOf(next)
          if (idx >= 0) {
            const cyc = stack.slice(idx)
            const key = [...cyc].sort().join('|')
            if (!seenCycles.has(key) && cyc.length <= 12) {
              seenCycles.add(key)
              cycles.push([...cyc, next])
            }
          }
        } else if (c === 0) {
          callStack.push({ node: next, iter: 0 })
        }
      } else {
        color.set(top.node, 2)
        stack.pop()
        callStack.pop()
      }
    }
  }
  for (const f of files) if ((color.get(f) ?? 0) === 0) dfs(f)

  // orphans: not imported by anything and not an obvious entry
  const isEntryLike = (f: string): boolean =>
    /^(index|main|app|server|_app|page|layout|\[\w+\])\.[a-z]+$/.test(f.split('/').pop() ?? '') ||
    /(^|\/)(main|index|app|server|cli|worker)\.(ts|tsx|js|jsx|py)$/.test(f) ||
    /\.(config|d)\.[a-z]+$/.test(f) || f.endsWith('.d.ts') || f.includes('.test.') || f.includes('.spec.') ||
    /^tests?\//.test(f) || /scripts?\//.test(f)

  const orphans = files.filter((f) => (reverseGraph[f]?.length ?? 0) === 0 && !isEntryLike(f)).slice(0, 60)

  const hubs = Object.entries(reverseGraph)
    .map(([file, deps]) => ({ file, dependents: deps.length }))
    .sort((a, b) => b.dependents - a.dependents)
    .slice(0, 10)

  return { graph, reverseGraph, cycles: cycles.slice(0, 20), orphans, hubs, totalFiles: files.length, totalEdges: edges }
}
