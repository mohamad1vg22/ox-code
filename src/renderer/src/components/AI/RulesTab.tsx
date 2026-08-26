import { useEffect, useState } from 'react'
import { extractConventions } from '../../core/rules'
import { Icon } from '../ui/Icon'

export function RulesTab(): React.JSX.Element {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(true)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    void window.oxcode.rules.load().then((t) => setText(t ?? ''))
  }, [])

  const save = async (): Promise<void> => {
    await window.oxcode.rules.save(text)
    setSaved(true)
  }

  return (
    <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, height: '100%' }}>
      <div className="panel-header" style={{ padding: '4px 0' }}>Project Rules & Memory</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.55 }}>
        These rules are injected into every AI request for this project. The agent must follow them.
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setSaved(false)
        }}
        placeholder={'e.g.\n- TypeScript only\n- Use functional components\n- Tests use Vitest\n- Never introduce Redux'}
        style={{
          flex: 1,
          minHeight: 220,
          resize: 'none',
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 10,
          fontFamily: 'var(--mono)',
          fontSize: 12,
          lineHeight: 1.6
        }}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn small" disabled={saved} onClick={() => void save()}>
          {saved ? (
            <><Icon name="check" size={12} /> Saved</>
          ) : (
            'Save Rules'
          )}
        </button>
        <button
          className="btn small ghost"
          disabled={detecting}
          onClick={async () => {
            setDetecting(true)
            try {
              const suggestions = await extractConventions()
              if (!suggestions.length) return
              const addition = suggestions.map((s) => `- ${s}`).join('\n')
              setText((prev) => (prev.trim() ? prev.trimEnd() + '\n' + addition + '\n' : addition + '\n'))
              setSaved(false)
            } finally {
              setDetecting(false)
            }
          }}
        >
          {detecting ? 'Detecting…' : <><Icon name="sparkles" size={12} /> Auto-detect conventions</>}
        </button>
      </div>
    </div>
  )
}
