import React from 'react'
import * as MonacoNs from 'monaco-editor'
import { useWorkspace } from '../../store/workspace'
import { useUI } from '../../store/ui'

interface Segment {
  type: 'text' | 'code'
  lang?: string
  code?: string
  text?: string
}

function parse(src: string): Segment[] {
  const segs: Segment[] = []
  const lines = src.split('\n')
  let buf: string[] = []
  let inCode = false
  let lang = ''
  let codeBuf: string[] = []

  const flushText = (): void => {
    if (buf.length) {
      segs.push({ type: 'text', text: buf.join('\n') })
      buf = []
    }
  }

  for (const line of lines) {
    const fence = line.match(/^```\s*(\w*)/)
    if (fence && !inCode) {
      flushText()
      inCode = true
      lang = fence[1] || ''
      codeBuf = []
    } else if (inCode && /^```/.test(line)) {
      segs.push({ type: 'code', lang, code: codeBuf.join('\n') })
      inCode = false
    } else if (inCode) {
      codeBuf.push(line)
    } else {
      buf.push(line)
    }
  }
  if (inCode) segs.push({ type: 'code', lang, code: codeBuf.join('\n') })
  flushText()
  return segs
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|((?:[\w.@/\\-]+\.\w{1,6}):\d+)/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const token = m[0]
    const key = `${keyPrefix}-${i++}`
    if (token.startsWith('`')) parts.push(<code key={key} className="inline">{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) parts.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (/^[\w.@/\\-]+\.\w{1,6}:\d+$/.test(token)) {
      const path = token.replace(/:\d+$/, '')
      const line = Number(token.split(':').pop())
      parts.push(
        <code
          key={key}
          className="inline"
          style={{ cursor: 'pointer', color: 'var(--accent)' }}
          title="Open in editor"
          onClick={() => {
            void window.oxcode.files.exists(path).then((ok) => {
              if (ok) {
                void useWorkspace.getState().openFile(path)
                window.dispatchEvent(new CustomEvent('oxcode:goto', { detail: { line } }))
              }
            })
          }}
        >
          {token}
        </code>
      )
    }
    else parts.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = m.index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function TextBlock({ text }: { text: string }): React.JSX.Element {
  const blocks: React.ReactNode[] = []
  const lines = text.split('\n')
  let list: string[] = []
  let para: string[] = []

  const flushList = (): void => {
    if (list.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {list.map((li, i) => (
            <li key={i}>{renderInline(li, `li-${blocks.length}-${i}`)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  const flushPara = (): void => {
    if (para.length) {
      blocks.push(<p key={`p-${blocks.length}`}>{renderInline(para.join(' '), `p-${blocks.length}`)}</p>)
      para = []
    }
  }

  for (const raw of lines) {
    const h = raw.match(/^(#{1,4})\s+(.*)/)
    const li = raw.match(/^\s*[-*•]\s+(.*)/)
    const oli = raw.match(/^\s*\d+[.)]\s+(.*)/)
    if (h) {
      flushList()
      flushPara()
      const Tag = (`h${Math.min(h[1].length + 1, 4)}`) as 'h2'
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(h[2], `hh-${blocks.length}`)}</Tag>)
    } else if (li) {
      flushPara()
      list.push(li[1])
    } else if (oli) {
      flushPara()
      list.push(oli[1])
    } else if (!raw.trim()) {
      flushList()
      flushPara()
    } else {
      flushList()
      para.push(raw)
    }
  }
  flushList()
  flushPara()
  return <div className="md">{blocks}</div>
}

export function Markdown({ content }: { content: string }): React.JSX.Element {
  const uiToast = useUI((s) => s.toast)
  const segments = parse(content)

  const copyCode = (code: string): void => {
    void navigator.clipboard.writeText(code)
    uiToast('success', 'Copied to clipboard')
  }

  const applyToEditor = (code: string): void => {
    const editors = MonacoNs.editor.getEditors()
    const editor = editors.find((e) => e.hasTextFocus()) ?? editors[0]
    if (!editor) {
      void navigator.clipboard.writeText(code)
      uiToast('info', 'Copied (no editor open)')
      return
    }
    const sel = editor.getSelection()
    const model = editor.getModel()
    if (!model) return
    editor.executeEdits('ox-apply', [
      {
        range: sel && !sel.isEmpty() ? sel : model.getFullModelRange(),
        text: code
      }
    ])
    useUI.getState().toast('info', 'Applied to editor — review & save')
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <TextBlock key={i} text={seg.text ?? ''} />
        ) : (
          <div key={i} className="codeblock">
            <div className="cb-head">
              <span>{seg.lang || 'code'}</span>
              <div className="cb-actions">
                <button className="cb-btn" onClick={() => applyToEditor(seg.code ?? '')}>
                  ⤵ Apply
                </button>
                <button className="cb-btn" onClick={() => copyCode(seg.code ?? '')}>
                  ⧉ Copy
                </button>
              </div>
            </div>
            <pre>{seg.code}</pre>
          </div>
        )
      )}
    </>
  )
}
