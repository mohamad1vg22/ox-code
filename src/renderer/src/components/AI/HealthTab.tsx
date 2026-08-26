import { useEffect, useState } from 'react'
import { detectValidations } from '../../core/verify'
import type { AnalysisResultDTO } from '../../types'
import { Icon } from '../ui/Icon'

interface RunResult {
  name: string
  ok: boolean
  output: string
}

export function HealthTab(): React.JSX.Element {
  const [validators, setValidators] = useState<Array<{ name: string; command: string; kind: string }>>([])
  const [results, setResults] = useState<Record<string, RunResult>>({})
  const [running, setRunning] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResultDTO | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    void detectValidations().then(setValidators)
    void window.oxcode.analyze.project().then(setAnalysis).catch(() => {})
  }, [])

  const run = async (step: { name: string; command: string; kind: string }): Promise<void> => {
    setRunning(step.name)
    try {
      const r = (await window.oxcode.validate.run(step)) as unknown as RunResult
      setResults((prev) => ({ ...prev, [step.name]: r }))
    } catch (e) {
      setResults((prev) => ({ ...prev, [step.name]: { name: step.name, ok: false, output: (e as Error).message } }))
    } finally {
      setRunning(null)
    }
  }

  return (
    <div style={{ padding: '10px 14px', overflowY: 'auto', height: '100%' }}>
      <div className="panel-header" style={{ padding: '4px 0' }}>Project Health</div>

      <div className="health-grid">
        <div className="health-cell">
          <div className="h-label">Validators found</div>
          <div className={`h-value ${validators.length ? 'h-ok' : ''}`}>{validators.length}</div>
        </div>
        <div className="health-cell">
          <div className="h-label">Circular deps</div>
          <div className={`h-value ${analysis?.cycles.length ? 'h-warn' : 'h-ok'}`}>{analysis?.cycles.length ?? '—'}</div>
        </div>
        <div className="health-cell">
          <div className="h-label">Orphan files</div>
          <div className="h-value">{analysis?.orphans.length ?? '—'}</div>
        </div>
        <div className="health-cell">
          <div className="h-label">Import edges</div>
          <div className="h-value">{analysis?.totalEdges ?? '—'}</div>
        </div>
      </div>

      <div className="panel-header" style={{ padding: '4px 0' }}>Run real checks</div>
      {!validators.length && (
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6 }}>
          No test/typecheck/lint/build command detected in this project — nothing to verify automatically.
        </div>
      )}
      {validators.map((v) => {
        const res = results[v.name]
        return (
          <div key={v.name} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                className={`btn small ${res ? (res.ok ? 'success' : 'danger') : 'ghost'}`}
                disabled={running === v.name}
                onClick={() => void run(v)}
              >
                {running === v.name ? 'Running…' : res ? `${v.name}: ${res.ok ? 'PASS' : 'FAIL'}` : <><Icon name="play" size={11} /> {v.name}</>}
              </button>
              <span className="faint mono" style={{ fontSize: 11 }}>{v.command}</span>
            </div>
            {res && !res.ok && (
              <>
                <button className="cb-btn" onClick={() => setExpanded(expanded === v.name ? null : v.name)}>
                  {expanded === v.name ? 'hide output' : 'show output'}
                </button>
                {expanded === v.name && (
                  <pre className="mono" style={{ background: 'var(--bg0)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, fontSize: 11, maxHeight: 180, overflow: 'auto', whiteSpace: 'pre-wrap', userSelect: 'text' }}>
                    {res.output.slice(-2000)}
                  </pre>
                )}
              </>
            )}
          </div>
        )
      })}

      {!!analysis?.cycles.length && (
        <>
          <div className="panel-header" style={{ padding: '4px 0', display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--yellow)' }}>
            <Icon name="alert-triangle" size={12} /> Circular dependencies
          </div>
          {analysis.cycles.slice(0, 6).map((c: string[], i: number) => (
            <div key={i} className="mono faint" style={{ fontSize: 11, padding: '2px 0', wordBreak: 'break-all' }}>
              {c.join(' → ')}
            </div>
          ))}
        </>
      )}

      {!!analysis?.hubs.length && (
        <>
          <div className="panel-header" style={{ padding: '4px 0' }}>Most depended-on files</div>
          {analysis.hubs.slice(0, 5).map((h: { file: string; dependents: number }) => (
            <div key={h.file} className="mono" style={{ fontSize: 11.5, display: 'flex', justifyContent: 'space-between' }}>
              <span>{h.file}</span><span className="faint">{h.dependents} dependents</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
