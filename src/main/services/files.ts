import * as fs from 'fs'
import * as path from 'path'

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNode[]
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', 'target', '.idea', 'coverage'
])
const MAX_FILE_SIZE = 2 * 1024 * 1024
const MAX_TREE_FILES = 20000

let workspaceRoot: string | null = null

export function getWorkspaceRoot(): string | null {
  return workspaceRoot
}

export function setWorkspaceRoot(root: string): void {
  workspaceRoot = root
}

function resolveSafe(relPath: string): string {
  if (!workspaceRoot) throw new Error('No workspace open')
  const abs = relPath ? path.resolve(workspaceRoot, relPath) : workspaceRoot
  const norm = path.normalize(abs)
  if (!norm.startsWith(path.normalize(workspaceRoot))) throw new Error('Path outside workspace')
  return norm
}

export async function listTree(dir = ''): Promise<FileNode> {
  const abs = resolveSafe(dir)
  let fileCount = 0

  async function walk(absDir: string, relDir: string): Promise<FileNode[]> {
    if (fileCount > MAX_TREE_FILES) return []
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true })
    } catch {
      return []
    }
    const nodes: FileNode[] = []
    const dirs: fs.Dirent[] = []
    for (const e of entries) {
      if (e.isDirectory() && IGNORED_DIRS.has(e.name)) continue
      if (e.isDirectory()) dirs.push(e)
      else if (e.isFile()) {
        fileCount++
        nodes.push({ name: e.name, path: relDir ? `${relDir}/${e.name}` : e.name, type: 'file' })
      }
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name))
    for (const d of dirs) {
      const childRel = relDir ? `${relDir}/${d.name}` : d.name
      nodes.push({
        name: d.name,
        path: childRel,
        type: 'dir',
        children: await walk(path.join(absDir, d.name), childRel)
      })
    }
    return nodes
  }

  const children = await walk(abs, dir)
  const name = workspaceRoot!.split(/[\\/]/).filter(Boolean).pop() || ''
  return { name, path: '', type: 'dir', children }
}

export async function readFile(relPath: string): Promise<{ content: string; truncated: boolean }> {
  const abs = resolveSafe(relPath)
  const stat = await fs.promises.stat(abs)
  const truncated = stat.size > MAX_FILE_SIZE
  const content = await fs.promises.readFile(abs, 'utf-8')
  return { content: truncated ? content.slice(0, MAX_FILE_SIZE) : content, truncated }
}

export async function writeFile(relPath: string, content: string): Promise<void> {
  const abs = resolveSafe(relPath)
  await fs.promises.mkdir(path.dirname(abs), { recursive: true })
  await fs.promises.writeFile(abs, content, 'utf-8')
}

export async function deleteEntry(relPath: string): Promise<void> {
  await fs.promises.rm(resolveSafe(relPath), { recursive: true, force: true })
}

export async function renameEntry(from: string, to: string): Promise<void> {
  const fromAbs = resolveSafe(from)
  const toAbs = resolveSafe(to)
  await fs.promises.mkdir(path.dirname(toAbs), { recursive: true })
  await fs.promises.rename(fromAbs, toAbs)
}

export async function entryExists(relPath: string): Promise<boolean> {
  try {
    await fs.promises.stat(resolveSafe(relPath))
    return true
  } catch {
    return false
  }
}

const TEXT_EXTS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'txt', 'css', 'scss', 'html',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'cs', 'php', 'c', 'cpp', 'h', 'hpp', 'swift',
  'yml', 'yaml', 'toml', 'ini', 'sql', 'sh', 'bat', 'ps1', 'vue', 'svelte', 'graphql',
  'prisma', 'gitignore', 'env', 'xml', 'gradle', 'cmake', 'dart'
])

export function isTextFile(name: string): boolean {
  const base = name.toLowerCase()
  if (base === '.gitignore' || base === '.env' || base === 'dockerfile' || base === 'makefile') return true
  const ext = base.includes('.') ? base.split('.').pop()! : ''
  return TEXT_EXTS.has(ext)
}

export async function searchCode(
  query: string,
  opts: { caseSensitive?: boolean; regex?: boolean } = {}
): Promise<SearchHit[]> {
  const root = resolveSafe('')
  const results: SearchHit[] = []
  let matcher: RegExp | null = null
  try {
    matcher = new RegExp(
      opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      opts.caseSensitive ? 'g' : 'gi'
    )
  } catch {
    return results
  }

  async function walk(absDir: string, relDir: string): Promise<void> {
    if (results.length >= 500) return
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const abs = path.join(absDir, e.name)
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue
        await walk(abs, rel)
      } else if (e.isFile() && isTextFile(e.name)) {
        let stat: fs.Stats
        try {
          stat = await fs.promises.stat(abs)
        } catch {
          continue
        }
        if (stat.size > MAX_FILE_SIZE) continue
        let content: string
        try {
          content = await fs.promises.readFile(abs, 'utf-8')
        } catch {
          continue
        }
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          matcher!.lastIndex = 0
          if (matcher!.test(lines[i])) {
            results.push({ path: rel, line: i + 1, text: lines[i].slice(0, 400) })
            if (results.length >= 500) return
          }
        }
      }
    }
  }

  await walk(root, '')
  return results
}
