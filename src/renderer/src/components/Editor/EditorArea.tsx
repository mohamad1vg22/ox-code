import { useEffect, useRef } from 'react'
import Editor, { loader } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { useWorkspace } from '../../store/workspace'
import { useSettings } from '../../store/settings'
import { WelcomeCenter } from '../Welcome/WelcomeCenter'
import { Icon } from '../ui/Icon'

loader.config({ monaco })

let inlineProviderRegistered = false

function registerInlineCompletion(): void {
  if (inlineProviderRegistered) return
  inlineProviderRegistered = true
  let inFlight: AbortController | null = null

  monaco.languages.registerInlineCompletionsProvider(
    { pattern: '**' },
    {
      async provideInlineCompletions(model, position, _context, token) {
        const settings = useSettings.getState()
        if (!settings.inlineCompletion || !settings.settings?.apiKey) return { items: [] }
        if (token.isCancellationRequested) return { items: [] }

        const prefix = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 80),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        })
        const suffix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 40),
          endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), position.lineNumber + 40))
        })
        if (prefix.trim().length < 8) return { items: [] }

        inFlight?.abort()
        const controller = new AbortController()
        inFlight = controller

        try {
          const requestId = `inline-${Date.now()}`
          let out = ''
          const offC = window.oxcode.ai.onChunk((p: any) => {
            if (p.requestId === requestId && p.type === 'text') out += p.delta
          })
          // non-streaming request is simpler for completion; still uses chunk path if streamed
          await window.oxcode.ai.chat(requestId, {
            messages: [
              {
                role: 'system',
                content:
                  'You are a code completion engine. Continue the code at <CURSOR>. Reply with ONLY the raw code continuation — no markdown, no explanation. Usually one line to a few lines.'
              },
              { role: 'user', content: `<PREFIX>${prefix}<CURSOR>${suffix ? `\n<SUFFIX>${suffix}` : ''}` }
            ],
            max_tokens: 160,
            temperature: 0.1,
            stream: false
          })
          offC()
          const text = out.replace(/^```[a-z]*\n?|```$/g, '').replace(/\n+$/, '')
          if (!text) return { items: [] }
          return {
            items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }]
          }
        } catch {
          return { items: [] }
        }
      },
      freeInlineCompletions(): void {}
    }
  )
}

export function EditorArea(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activePath = useWorkspace((s) => s.activePath)
  const contents = useWorkspace((s) => s.contents)
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    registerInlineCompletion()
  }, [])

  useEffect(() => {
    const goto = (e: Event): void => {
      const line = (e as CustomEvent).detail?.line
      if (line && editorRef.current) {
        editorRef.current.revealLineInCenter(line)
        editorRef.current.setPosition({ lineNumber: line, column: 1 })
        editorRef.current.focus()
      }
    }
    window.addEventListener('oxcode:goto', goto)
    return () => window.removeEventListener('oxcode:goto', goto)
  }, [])

  useEffect(() => {
    const saveHandler = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void useWorkspace.getState().saveFile()
      }
    }
    window.addEventListener('keydown', saveHandler)
    return () => window.removeEventListener('keydown', saveHandler)
  }, [])

  const activeTab = tabs.find((t) => t.path === activePath)

  if (!tabs.length) {
    return (
      <div className="editor-empty" style={{ display: 'flex' }}>
        <WelcomeCenter />
      </div>
    )
  }

  const crumbs = (activeTab?.path ?? '').split('/')

  return (
    <div className="editor-wrap">
      <div className="tabbar">
        {tabs.map((t) => (
          <div
            key={t.path}
            className={`tab ${activePath === t.path ? 'active' : ''}`}
            onClick={() => useWorkspace.getState().setActive(t.path)}
            title={t.path}
          >
            {t.dirty ? <span className="dirty-dot">●</span> : <span style={{ width: 6 }} />}
            <span>{t.name}</span>
            <button
              className="close"
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                useWorkspace.getState().closeTab(t.path)
              }}
            >
              <Icon name="x" size={11} />
            </button>
          </div>
        ))}
      </div>
      {activeTab && (
        <>
          <div className="breadcrumbs">
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i > 0 && <span className="crumb-sep">›</span>}
                <span className="crumb" onClick={() => void useWorkspace.getState().openFile(crumbs.slice(0, i + 1).join('/'))}>
                  {c}
                </span>
              </span>
            ))}
          </div>
          <Editor
          key={activeTab.path}
          height="100%"
          theme="vs-dark"
          language={activeTab.language}
          value={contents[activeTab.path] ?? ''}
          onChange={(v) => useWorkspace.getState().updateContent(activeTab.path, v ?? '')}
          onMount={(editor) => {
            editorRef.current = editor
          }}
          options={{
            fontSize: useSettings.getState().fontSize,
            fontFamily: "'JetBrains Mono','Cascadia Code',Consolas,monospace",
            fontLigatures: true,
            minimap: { enabled: true, scale: 0.9 },
            smoothScrolling: true,
            cursorBlinking: 'phase',
            cursorSmoothCaretAnimation: 'on',
            padding: { top: 12 },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            wordWrap: useSettings.getState().wordWrap ? 'on' : 'off',
            inlineSuggest: { enabled: true },
            suggestOnTriggerCharacters: true,
            renderWhitespace: 'selection',
            renderLineHighlight: 'all',
            stickyScroll: { enabled: true }
          }}
        />
        </>
      )}
    </div>
  )
}
