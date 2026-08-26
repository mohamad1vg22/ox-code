import * as fs from 'fs'
import * as path from 'path'
import { isTextFile, getWorkspaceRoot } from './files'

export interface SymbolEntry {
  path: string
  name: string
  kind: string
  line: number
}

export interface ProjectInfo {
  files: number
  languages: Record<string, number>
  dependencies: string[]
  entryPoints: string[]
  testDirs: string[]
}

interface FileRecord {
  symbols: SymbolEntry[]
}

const index = new Map<string, FileRecord>()

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', 'target', '.idea', 'coverage'
])

const LANG_BY_EXT: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
  py: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', cs: 'C#',
  rb: 'Ruby', php: 'PHP', c: 'C', cpp: 'C++', swift: 'Swift', dart: 'Dart',
  vue: 'Vue', svelte: 'Svelte', html: 'HTML', css: 'CSS', scss: 'SCSS', sql: 'SQL'
}

const SYMBOL_PATTERNS: Array<{ re: RegExp; kind: string }> = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class' },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface' },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<{]/, kind: 'type' },
  { re: /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum' },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: 'function' },
  { re: /^\s*def\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class' },
  { re: /^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function' },
  { re: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: 'function' }
]

async function indexFile(relPath: string): Promise<void> {
  if (!getWorkspaceRoot()) return
  const abs = path.join(getWorkspaceRoot()!, relPath)
  let content: string
  try {
    const stat = await fs.promises.stat(abs)
    if (stat.size > 2 * 1024 * 1024) return
    content = await fs.promises.readFile(abs, 'utf-8')
  } catch {
    index.delete(relPath)
    return
  }
  const symbols: SymbolEntry[] = []
  const lines = content.split('\n')
  for (let i = 0; i < Math.min(lines.length, 4000); i++) {
    for (const p of SYMBOL_PATTERNS) {
      const m = lines[i].match(p.re)
      if (m && m[1] && m[1] !== 'new') {
        symbols.push({ path: relPath, name: m[1], kind: p.kind, line: i + 1 })
        break
      }
    }
  }
  index.set(relPath, { symbols })
}

export async function buildIndex(): Promise<number> {
  index.clear()
  const root = getWorkspaceRoot()
  if (!root) return 0

  async function walk(absDir: string, relDir: string): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue
        await walk(path.join(absDir, e.name), rel)
      } else if (e.isFile() && isTextFile(e.name)) {
        await indexFile(rel)
      }
    }
  }

  await walk(root, '')
  return index.size
}

export async function updateFile(relPath: string): Promise<void> {
  await indexFile(relPath)
}

export function removeFromIndex(relPath: string): void {
  index.delete(relPath)
}

export function searchSymbols(query: string, limit = 40): SymbolEntry[] {
  const q = query.toLowerCase()
  const out: SymbolEntry[] = []
  for (const rec of index.values()) {
    for (const s of rec.symbols) {
      if (s.name.toLowerCase().includes(q)) {
        out.push(s)
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

export function getProjectInfo(): ProjectInfo {
  const languages: Record<string, number> = {}
  const testDirs = new Set<string>()
  let files = 0
  for (const p of index.keys()) {
    files++
    const ext = p.split('.').pop()?.toLowerCase() || ''
    const lang = LANG_BY_EXT[ext]
    if (lang) languages[lang] = (languages[lang] || 0) + 1
    if (/^(tests?|__tests__|spec)\//i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p)) {
      testDirs.add(p.split('/')[0])
    }
  }
  const deps: string[] = []
  const entryPoints: string[] = []
  tryReadJson('package.json', (pkg) => {
    for (const key of ['dependencies', 'devDependencies']) {
      const obj = pkg[key]
      if (obj && typeof obj === 'object') deps.push(...Object.keys(obj))
    }
    const main = pkg.main || pkg.module
    if (typeof main === 'string') entryPoints.push(main)
    else entryPoints.push('src/index')
  })
  tryReadLines('requirements.txt', (lines) => deps.push(...lines.filter(Boolean)))
  if (index.has('src/main.py')) entryPoints.push('src/main.py')
  if (index.has('main.py')) entryPoints.push('main.py')

  return {
    files,
    languages,
    dependencies: [...new Set(deps)].slice(0, 200),
    entryPoints,
    testDirs: [...testDirs]
  }
}

function tryReadJson(file: string, cb: (data: Record<string, unknown>) => void): void {
  try {
    const raw = fs.readFileSync(path.join(getWorkspaceRoot()!, file), 'utf-8')
    cb(JSON.parse(raw))
  } catch {
    /* not present */
  }
}

function tryReadLines(file: string, cb: (lines: string[]) => void): void {
  try {
    const raw = fs.readFileSync(path.join(getWorkspaceRoot()!, file), 'utf-8')
    cb(raw.split('\n'))
  } catch {
    /* not present */
  }
}
