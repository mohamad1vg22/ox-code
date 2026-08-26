import { useEffect, useRef, useState } from 'react'
import { useUI } from '../../store/ui'
import { Icon } from '../ui/Icon'

interface TermLine {
  text: string
  err: boolean
}

export function TerminalPanel({ embedded = false }: { embedded?: boolean } = {}): React.JSX.Element | null {
  const visible = useUI((s) => s.terminalVisible)
  const toggle = useUI((s) => s.toggleTerminal)
  const [lines, setLines] = useState<TermLine[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const outRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDebug = (): void => {
      const last = linesRef.current.slice(-80).map((l) => l.text).join('').trim()
      if (!last) {
        useUI.getState().toast('info', 'Nothing to debug', 'Run something in the terminal first.')
        return
      }
      import('../../agent/runner').then((r) =>
        void r.handleSendMessage(
          `The terminal produced this output. Find the error, locate the responsible code, fix it, and re-run to verify:\n\n\`\`\`\n${last.slice(-6000)}\n\`\`\``
        )
      )
    }
    window.addEventListener('oxcode:debug', onDebug)
    return () => window.removeEventListener('oxcode:debug', onDebug)
  }, [])

  useEffect(() => {
    const off = window.oxcode.terminal.onData((p) => {
      // split error-looking lines for coloring
      const parts = p.data.split('\n')
      setLines((prev) => {
        const next = [...prev]
        for (let i = 0; i < parts.length; i++) {
          const raw = i < parts.length - 1 ? parts[i] + '\n' : parts[i]
          if (i === 0 && next.length && !next[next.length - 1].text.endsWith('\n')) {
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, text: last.text + raw }
          } else if (raw) {
            next.push({ text: raw, err: /\berror\b|exception|failed|traceback/i.test(raw) })
          }
        }
        return next.slice(-3000)
      })
      import('../../core/contextEngine').then((m) =>
        m.setLastTerminalTail(linesRef.current.map((l) => l.text).join('').slice(-2500))
      )
    })
    return off
  }, [])

  const linesRef = useRef<TermLine[]>([])
  linesRef.current = lines

  useEffect(() => {
    outRef.current?.scrollTo({ top: outRef.current.scrollHeight })
  }, [lines])

  if (!visible && !embedded) return null

  return (
    <>
      <div
        className="term-resizer"
        title="Drag to resize terminal"
        onMouseDown={(e) => {
          e.preventDefault()
          document.body.style.cursor = 'row-resize'
          const el = e.currentTarget as HTMLElement
          el.classList.add('active')
          const move = (ev: MouseEvent): void => {
            const h = Math.min(window.innerHeight - 220, Math.max(120, window.innerHeight - ev.clientY - 25))
            document.documentElement.style.setProperty('--term-h', `${h}px`)
          }
          const up = (): void => {
            document.body.style.cursor = ''
            el.classList.remove('active')
            window.removeEventListener('mousemove', move)
            window.removeEventListener('mouseup', up)
          }
          window.addEventListener('mousemove', move)
          window.addEventListener('mouseup', up)
        }}
      />
      <div className="term-panel" style={{ height: 'var(--term-h, 200px)' }}>
        <div className="term-head">
          <span className={`term-status-dot ${busy ? 'busy' : ''}`} title={busy ? 'Command running' : 'Idle'} />
          <span>Terminal</span>
          <span style={{ flex: 1 }} />
          <button
            className="icon-btn"
            title="Clear terminal"
            onClick={() => setLines([])}
          >
            <Icon name="minus" size={13} />
          </button>
        <button
          className="icon-btn"
          title="Debug last output with AI (analyzes errors and fixes them)"
          onClick={() => {
            const last = lines.slice(-80).map((l) => l.text).join('').trim()
            if (!last) {
              useUI.getState().toast('info', 'Nothing to debug', 'Run something first.')
              return
            }
            import('../../agent/runner').then((r) =>
              void r.handleSendMessage(
                `The terminal produced this output. Find the error, locate the responsible code, fix it, and re-run to verify:\n\n\`\`\`\n${last.slice(-6000)}\n\`\`\``
              )
            )
          }}
        >
          <Icon name="bug" size={13} />
        </button>
        <button className="icon-btn" title="Hide terminal (Ctrl+`)" onClick={toggle}>
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="term-out" ref={outRef}>
        {lines.map((l, i) => (
          <span key={i} className={l.err ? 'err-line' : ''}>
            {l.text}
          </span>
        ))}
      </div>
      <form
        className="term-in"
        onSubmit={(e) => {
          e.preventDefault()
          const cmd = input.trim()
          if (!cmd) return
          setInput('')
          setLines((p) => [...p, { text: `❯ ${cmd}\n`, err: false }])
          setBusy(true)
          void window.oxcode.terminal.run(cmd).then(() => {
            setBusy(false)
            setLines((p) => [...p, { text: '', err: false }])
          })
        }}
      >
        <span className="term-prompt">❯</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a command…"
          spellCheck={false}
          autoFocus
        />
      </form>
      </div>
    </>
  )
}
