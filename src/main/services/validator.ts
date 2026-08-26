import * as fs from 'fs'
import * as path from 'path'
import { getWorkspaceRoot } from './files'

export interface ValidationStep {
  name: string
  command: string
  kind: 'test' | 'typecheck' | 'lint' | 'build'
}

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv', 'target'])

async function exists(rel: string): Promise<boolean> {
  try {
    await fs.promises.access(path.join(getWorkspaceRoot()!, rel))
    return true
  } catch {
    return false
  }
}

async function readJson(rel: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.promises.readFile(path.join(getWorkspaceRoot()!, rel), 'utf-8'))
  } catch {
    return null
  }
}

/**
 * Detects which validation commands this project actually supports.
 * Nothing is hardcoded to a stack — everything is derived from real project files.
 */
export async function detectValidations(): Promise<ValidationStep[]> {
  const root = getWorkspaceRoot()
  if (!root) return []
  const steps: ValidationStep[] = []

  const pkg = await readJson('package.json')
  if (pkg) {
    const scripts = (pkg['scripts'] ?? {}) as Record<string, string>
    if (scripts['test']) steps.push({ name: 'Tests', command: 'npm test -- --run', kind: 'test' })
    else if ((pkg['devDependencies'] as Record<string, unknown>)?.['vitest']) steps.push({ name: 'Tests', command: 'npx vitest run', kind: 'test' })
    else if ((pkg['devDependencies'] as Record<string, unknown>)?.['jest']) steps.push({ name: 'Tests', command: 'npx jest', kind: 'test' })

    if (scripts['typecheck'] || scripts['type-check']) {
      steps.push({ name: 'Typecheck', command: scripts['typecheck'] ? 'npm run typecheck' : 'npm run type-check', kind: 'typecheck' })
    } else if (
      (await exists('tsconfig.json')) &&
      (((pkg['devDependencies'] as Record<string, unknown>)?.['typescript'] ?? (pkg['dependencies'] as Record<string, unknown>)?.['typescript']))
    ) {
      steps.push({ name: 'Typecheck', command: 'npx tsc --noEmit -p tsconfig.json', kind: 'typecheck' })
    }

    if (scripts['lint']) steps.push({ name: 'Lint', command: 'npm run lint', kind: 'lint' })
    if (scripts['build'] && !scripts['build'].includes('next dev')) steps.push({ name: 'Build', command: 'npm run build', kind: 'build' })
    return steps
  }

  if (await exists('pytest.ini') || await exists('tests')) steps.push({ name: 'Tests', command: 'python -m pytest -x -q', kind: 'test' })
  else if (await exists('test_main.py') || await exists('main.py')) steps.push({ name: 'Tests', command: 'python -m pytest -x -q', kind: 'test' })
  else if (await exists('go.mod')) steps.push({ name: 'Tests', command: 'go test ./...', kind: 'test' })
  else if (await exists('Cargo.toml')) steps.push({ name: 'Tests', command: 'cargo check', kind: 'typecheck' })
  else if (await exists('pubspec.yaml')) steps.push({ name: 'Tests', command: 'flutter test', kind: 'test' })
  else if (await exists('pom.xml') || await exists('build.gradle')) steps.push({ name: 'Build', command: process.platform === 'win32' ? 'gradlew.bat build' : './gradlew build', kind: 'build' })

  return steps.slice(0, 4)
}

/** Recently modified project files (real mtimes). */
export async function recentChanges(limit = 12): Promise<Array<{ path: string; modifiedAgoMin: number }>> {
  const root = getWorkspaceRoot()
  if (!root) return []
  const out: Array<{ path: string; mtimeMs: number }> = []
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
      } else if (e.isFile() && isTextLike(e.name)) {
        try {
          const st = await fs.promises.stat(path.join(dir, e.name))
          out.push({ path: relDir ? `${relDir}/${e.name}` : e.name, mtimeMs: st.mtimeMs })
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk(root, '')
  const now = Date.now()
  return out
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((f) => ({ path: f.path, modifiedAgoMin: Math.max(0, Math.round((now - f.mtimeMs) / 60000)) }))
}

function isTextLike(name: string): boolean {
  return /\.(ts|tsx|js|jsx|py|json|md|css|html|rs|go|vue|sql|yml|yaml)$/i.test(name)
}
