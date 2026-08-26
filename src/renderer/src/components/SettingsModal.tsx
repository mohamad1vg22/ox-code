import { useEffect, useState } from 'react'
import { useSettings } from '../store/settings'
import { useUI } from '../store/ui'
import { Icon } from './ui/Icon'

const TABS = [
  ['router', 'AI Provider'],
  ['editor', 'Editor'],
  ['agent', 'Agent'],
  ['about', 'About']
] as const

export function SettingsModal(): React.JSX.Element | null {
  const open = useUI((s) => s.settingsOpen)
  const setOpen = useUI((s) => s.setSettingsOpen)
  const tab = useUI((s) => s.settingsTab)
  const setTab = useUI((s) => s.setSettingsTab)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const models = useSettings((s) => s.models)
  const modelsError = useSettings((s) => s.modelsError)
  const fetchModels = useSettings((s) => s.fetchModels)
  const inline = useSettings((s) => s.inlineCompletion)
  const fontSize = useSettings((s) => s.fontSize)
  const wordWrap = useSettings((s) => s.wordWrap)
  const setLocal = useSettings((s) => s.setLocal)
  const [testing, setTesting] = useState<'idle' | 'busy' | 'ok' | 'fail'>('idle')
  const verifyMax = useSettings((s) => s.verifyMaxAttempts)
  const [verifyLocal, setVerifyLocal] = useState<number | null>(null)
  const verifyShown = verifyLocal ?? verifyMax

  useEffect(() => {
    if (open && settings) void fetchModels()
  }, [open])

  if (!open || !settings) return null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal wide">
        <div className="modal-head">
          Settings
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>
            <Icon name="x" size={13} />
          </button>
        </div>
        <div className="modal-body">
          <div className="settings-layout">
            <div className="settings-nav">
              {TABS.map(([id, label]) => (
                <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="settings-form">
              {tab === 'router' && (
                <>
                  <div className="field">
                    <label>Base URL</label>
                    <input
                      value={settings.baseUrl}
                      onChange={(e) => void update({ baseUrl: e.target.value })}
                      placeholder="http://localhost:9router/v1"
                    />
                    <span className="hint">OpenAI-compatible endpoint of your local 9router.</span>
                  </div>
                  <div className="field">
                    <label>API Key</label>
                    <input
                      type="password"
                      value={settings.apiKey}
                      onChange={(e) => void update({ apiKey: e.target.value })}
                      placeholder="sk-…"
                    />
                  </div>
                  <div className="field">
                    <label>Model</label>
                    <select value={settings.model} onChange={(e) => void update({ model: e.target.value })}>
                      {!models.includes(settings.model) && <option value={settings.model}>{settings.model}</option>}
                      {models.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="hint">{models.length ? `${models.length} models available from 9router` : modelsError ? `Could not load models: ${modelsError}` : 'Loading models…'}</span>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Max Tokens</label>
                      <input type="number" value={settings.maxTokens} onChange={(e) => void update({ maxTokens: Number(e.target.value) })} />
                    </div>
                    <div className="field">
                      <label>Temperature: {settings.temperature}</label>
                      <input type="range" min={0} max={1} step={0.05} value={settings.temperature} onChange={(e) => void update({ temperature: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="field-row">
                    <div className="field">
                      <label>Timeout (ms)</label>
                      <input type="number" value={settings.timeoutMs} onChange={(e) => void update({ timeoutMs: Number(e.target.value) })} />
                    </div>
                    <div className="field">
                      <label>Retry Count</label>
                      <input type="number" min={0} max={5} value={settings.retryCount} onChange={(e) => void update({ retryCount: Number(e.target.value) })} />
                    </div>
                  </div>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={settings.streaming} onChange={(e) => void update({ streaming: e.target.checked })} id="cb-stream" />
                    <label htmlFor="cb-stream">Streaming responses</label>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      className={`btn small ${testing === 'ok' ? 'success' : testing === 'fail' ? 'danger' : ''}`}
                      disabled={testing === 'busy'}
                      onClick={async () => {
                        setTesting('busy')
                        const ok = await fetchModels()
                        setTesting(ok ? 'ok' : 'fail')
                        setTimeout(() => setTesting('idle'), 2500)
                      }}
                    >
                      {testing === 'busy' ? 'Testing…' : testing === 'ok' ? 'Connected' : testing === 'fail' ? 'Failed — check Base URL & key' : 'Test Connection'}
                    </button>
                    {modelsError && <span style={{ color: 'var(--red)', fontSize: 12 }}>{modelsError}</span>}
                  </div>
                </>
              )}

              {tab === 'editor' && (
                <>
                  <div className="field">
                    <label>Font Size: {fontSize}px</label>
                    <input type="range" min={11} max={20} value={fontSize} onChange={(e) => setLocal({ fontSize: Number(e.target.value) })} />
                  </div>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={inline} onChange={(e) => setLocal({ inlineCompletion: e.target.checked })} id="cb-inline" />
                    <label htmlFor="cb-inline">AI inline completion (Copilot-style)</label>
                  </div>
                  <div className="checkbox-row">
                    <input type="checkbox" checked={wordWrap} onChange={(e) => setLocal({ wordWrap: e.target.checked })} id="cb-wrap" />
                    <label htmlFor="cb-wrap">Word wrap</label>
                  </div>
                </>
              )}

              {tab === 'agent' && (
                <>
                  <div className="field">
                    <label>Thinking Depth</label>
                    <select value={useSettings.getState().thinkingLevel} onChange={(e) => setLocal({ thinkingLevel: e.target.value as never })}>
                      <option value="eco">Eco — fast, 8 steps</option>
                      <option value="balanced">Balanced — 16 steps</option>
                      <option value="deep">Deep — 24 steps</option>
                      <option value="max">Max — 40 steps</option>
                    </select>
                    <span className="hint">Controls how many tool-use iterations the agent may run per turn. Higher = more thorough but slower & costlier. Change live from the chat input bar too.</span>
                  </div>
                  <div className="field">
                    <label>Custom iterations (advanced)</label>
                    <input type="number" min={2} max={64} value={useSettings((s) => s.agentMaxIterations)} onChange={(e) => setLocal({ agentMaxIterations: Math.max(2, Math.min(64, Number(e.target.value)||24)) })} />
                  </div>
                  <div className="field">
                    <label>Max verification attempts: {verifyShown}</label>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={verifyShown}
                      onChange={(e) => {
                        setVerifyLocal(Number(e.target.value))
                        setLocal({ verifyMaxAttempts: Number(e.target.value) })
                      }}
                    />
                    <span className="hint">
                      After the agent edits files, the system automatically runs this project's real validations
                      (tests/typecheck/lint/build). On failure it feeds results back to the agent and retries —
                      up to this limit. The agent must report honestly when it cannot pass.
                    </span>
                  </div>
                  <div className="field">
                    <label>Safety</label>
                    <span className="hint">
                      Destructive commands and file deletions always require manual approval before execution.
                      Every mutation is checkpointed and patch-validated (bracket balance + minimal-change guard) —
                      you can roll back from the AI panel at any time.
                    </span>
                  </div>
                </>
              )}

              {tab === 'about' && (
                <div className="muted" style={{ lineHeight: 1.8 }}>
                  <strong style={{ color: 'var(--text)' }}>OX Code v2.0</strong> — AI coding environment.
                  <br />
                  Smart Context Engine · Patch validation · Risk analysis · Self-verification loop · Project rules
                  <br /><br />
                  Default provider: OpenCode Zen (<span className="mono">https://opencode.ai/zen/v1</span>).
                  Any OpenAI-compatible endpoint (including your local 9router) works via Base URL.
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn small ghost" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
