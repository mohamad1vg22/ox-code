import type { AnalysisResultDTO } from '../types'
import { useWorkspace } from '../store/workspace'
import { useChat } from '../store/chat'
import { detectIntent, type Intent } from './intent'

export interface ContextFile {
  path: string
  content: string
  score: number
  reason: string
}

export interface BuiltContext {
  summary: string
  files: ContextFile[]
  rules: string
  recentChanges: Array<{ path: string; modifiedAgoMin: number }>
  gitDiffStat: string
  terminalTail: string
}

// ---------- caches (invalidated on workspace change / index rebuild) ----------
let analysisCache: { data: AnalysisResultDTO; at: number } | null = null
const fileContentCache = new Map<string, { content: string; at: number }>()
const CACHE_TTL = 30_000

function invalidateCaches(): void {
  analysisCache = null
  fileContentCache.clear()
}
if (typeof window !== 'undefined') {
  window.addEventListener('oxcode:index-invalidated', invalidateCaches)
}

async function getAnalysis(): Promise<AnalysisResultDTO | null> {
  if (!useWorkspace.getState().root) return null
  if (analysisCache && Date.now() - analysisCache.at < CACHE_TTL) return analysisCache.data
  try {
    const data: AnalysisResultDTO = await window.oxcode.analyze.project()
    analysisCache = { data, at: Date.now() }
    return data
  } catch {
    return null
  }
}

async function readFileCached(path: string): Promise<string> {
  const ws = useWorkspace.getState()
  const cached = fileContentCache.get(path)
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.content
  let content = ''
  try {
    content = (await window.oxcode.files.read(path)).content
  } catch {
    return ''
  }
  fileContentCache.set(path, { content, at: Date.now() })
  return content
}

/** Compress a file for prompt inclusion: keep structure, drop long runs of blanks. */
function compress(content: string, maxChars: number): string {
  let text = content.replace(/\n{3,}/g, '\n\n')
  if (text.length > maxChars) {
    // keep head and tail — most meaning lives there
    const head = Math.floor(maxChars * 0.65)
    const tail = maxChars - head - 20
    text = text.slice(0, head) + '\n\n/* … truncated … */\n\n' + text.slice(-tail)
  }
  return text
}

/**
 * Task-aware smart context builder.
 * Scores project files by relevance to the request using:
 * keyword matches on paths/symbols, import-graph proximity, open/active files,
 * related tests, recency. Only the top files within budget are sent to the model.
 */
export async function buildSmartContext(request: string): Promise<BuiltContext> {
  const ws = useWorkspace.getState()
  const chatState = useChat.getState()
  const { intent, keywords } = detectIntent(request)

  const scores = new Map<string, { score: number; reason: Set<string> }>()
  const bump = (path: string, amount: number, reason: string): void => {
    const cur = scores.get(path) ?? { score: 0, reason: new Set<string>() }
    cur.score += amount
    cur.reason.add(reason)
    scores.set(path, cur)
  }

  // 1) active + open files always relevant
  if (ws.activePath) bump(ws.activePath, intent === 'explain' || intent === 'question' ? 60 : 40, 'active file')
  for (const t of ws.tabs.slice(0, 5)) bump(t.path, 15, 'open tab')

  // 2) pinned context files
  for (const p of chatState.contextFiles) bump(p, 50, 'pinned')

  // 3) symbol index keyword matches
  for (const kw of keywords.slice(0, 6)) {
    try {
      const syms: Array<{ path: string; name: string }> = await window.oxcode.index.symbols(kw)
      for (const s of syms.slice(0, 10)) bump(s.path, 25, `symbol ~${s.name}`)
    } catch {
      /* index not ready */
    }
  }

  // 4) path-name keyword matches over the tree
  if (ws.tree && keywords.length) {
    const walkTree = (nodes: NonNullable<typeof ws.tree>): void => {
      for (const n of nodes) {
        const lowerPath = n.path.toLowerCase()
        let hits = 0
        for (const kw of keywords) if (lowerPath.includes(kw)) hits++
        if (hits > 0 && n.type === 'file') bump(n.path, 12 * hits, 'path match')
        if (n.children) walkTree(n.children)
      }
    }
    walkTree(ws.tree)
  }

  // 5) import-graph proximity: deps & dependents of current seeds
  const analysis = await getAnalysis()
  if (analysis) {
    const seeds = [...scores.entries()].filter(([, v]) => v.score >= 25).map(([k]) => k).slice(0, 4)
    for (const seed of seeds) {
      for (const dep of (analysis.graph[seed] ?? []).slice(0, 8)) bump(dep, 14, 'dependency')
      for (const dep of (analysis.reverseGraph[seed] ?? []).slice(0, 8)) bump(dep, 18, 'used by')
    }
    // 6) tests near seeds
    for (const seed of seeds) {
      const base = seed.replace(/\.[^.]+$/, '')
      for (const f of Object.keys(analysis.graph)) {
        if ((f.includes('.test.') || f.includes('.spec.') || /^tests?\//.test(f)) &&
            (f.includes(base.split('/').pop() ?? '###'))) {
          bump(f, 20, 'related test')
          break
        }
      }
    }
  }

  // intent weighting: bugfix/debug prefer recent changes + terminal errors surface separately;
  // refactor prefers dependents graph (already boosted); testing boosts test files.
  if (intent === 'testing') {
    for (const [p] of scores) if (/test|spec/i.test(p)) bump(p, 15, 'testing focus')
  }

  // select top files under char budget
  const BUDGET_CHARS = intent === 'feature' ? 28000 : 22000
  const PER_FILE = 7000
  const ranked = [...scores.entries()]
    .map(([path, v]) => ({ path, score: v.score, reason: [...v.reason].join(', ') }))
    .filter((f) => /\.(ts|tsx|js|jsx|py|json|md|css|html|rs|go|vue|sql|yml|yaml)$/i.test(f.path))
    .sort((a, b) => b.score - a.score)

  const files: ContextFile[] = []
  let used = 0
  for (const cand of ranked) {
    if (used >= BUDGET_CHARS || files.length >= 8) break
    if (cand.score < 15) break
    const content = await readFileCached(cand.path)
    if (!content.trim()) continue
    const room = Math.min(PER_FILE, BUDGET_CHARS - used)
    files.push({ path: cand.path, content: compress(content, room), score: Math.min(99, cand.score), reason: cand.reason })
    used += Math.min(content.length, room)
  }

  // supporting signals
  let gitDiffStat = ''
  try {
    const r = await window.oxcode.git.run(['diff', '--stat'])
    gitDiffStat = r.output.slice(0, 1200)
  } catch {
    /* not a repo */
  }

  let rules = ''
  try {
    rules = (await window.oxcode.rules.load()) ?? ''
  } catch {
    /* none */
  }

  let recentChanges: Array<{ path: string; modifiedAgoMin: number }> = []
  try {
    recentChanges = await window.oxcode.recentChanges()
  } catch {
    /* skip */
  }

  const summary =
    `Context selection: ${files.length} file(s), ~${Math.ceil(used / 4)} tokens. ` +
    `Intent: ${intent}.`

  return { summary, files, rules, recentChanges, gitDiffStat, terminalTail: lastTerminalTail() }
}

let lastOutputTail = ''
export function setLastTerminalTail(tail: string): void {
  lastOutputTail = tail
}
function lastTerminalTail(): string {
  return lastOutputTail.slice(-2000)
}
