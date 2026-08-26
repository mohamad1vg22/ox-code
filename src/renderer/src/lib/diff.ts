export type DiffLineType = 'add' | 'del' | 'ctx' | 'hunk'

export interface DiffLine {
  type: DiffLineType
  oldNo: number | null
  newNo: number | null
  text: string
}

/** Classic LCS line diff between two texts. */
export function computeDiff(before: string, after: string): DiffLine[] {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')

  // trim large diffs for performance
  if (a.length * b.length > 1_000_000) {
    const prefix = commonPrefix(a, b)
    const suffix = commonSuffix(a, b, prefix.length)
    const midA = a.slice(prefix.length, a.length - suffix.length)
    const midB = b.slice(prefix.length, b.length - suffix.length)
    return [
      ...prefix.map((t, i) => ({ type: 'ctx' as const, oldNo: i + 1, newNo: i + 1, text: t })),
      ...midA.map((t, i) => ({ type: 'del' as const, oldNo: prefix.length + i + 1, newNo: null, text: t })),
      ...midB.map((t, i) => ({ type: 'add' as const, oldNo: null, newNo: prefix.length + i + 1, text: t })),
      ...suffix.map((t, i) => ({
        type: 'ctx' as const,
        oldNo: a.length - suffix.length + i + 1,
        newNo: b.length - suffix.length + i + 1,
        text: t
      }))
    ]
  }

  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', oldNo: i + 1, newNo: j + 1, text: a[i] })
      i++
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: 'del', oldNo: i + 1, newNo: null, text: a[i] })
      i++
    } else {
      out.push({ type: 'add', oldNo: null, newNo: j + 1, text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', oldNo: ++i, newNo: null, text: a[i - 1] })
  while (j < m) out.push({ type: 'add', oldNo: null, newNo: ++j, text: b[j - 1] })
  return out
}

function commonPrefix(a: string[], b: string[]): string[] {
  const out: string[] = []
  while (out.length < a.length && out.length < b.length && a[out.length] === b[out.length]) {
    out.push(a[out.length])
  }
  return out
}

function commonSuffix(a: string[], b: string[], limit: number): string[] {
  const out: string[] = []
  let ia = a.length - 1
  let ib = b.length - 1
  while (ia >= limit && ib >= limit && a[ia] === b[ib] && out.length < 500) {
    out.unshift(a[ia])
    ia--
    ib--
  }
  return out
}

/** Collapse long runs of unchanged lines into hunk separators. */
export function collapseContext(lines: DiffLine[], contextSize = 3): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((l, idx) => {
    if (l.type !== 'ctx') {
      for (let k = Math.max(0, idx - contextSize); k <= Math.min(lines.length - 1, idx + contextSize); k++) {
        keep[k] = true
      }
    }
  })
  const out: DiffLine[] = []
  let skipping = false
  lines.forEach((l, idx) => {
    if (keep[idx]) {
      skipping = false
      out.push(l)
    } else if (!skipping) {
      skipping = true
      out.push({ type: 'hunk', oldNo: null, newNo: null, text: '⋯' })
    }
  })
  return out
}
