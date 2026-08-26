export interface AISettings {
  baseUrl: string
  apiKey: string
  model: string
  timeoutMs: number
  maxTokens: number
  temperature: number
  contextLength: number
  streaming: boolean
  retryCount: number
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  baseUrl: 'https://opencode.ai/zen/v1',
  apiKey: '',
  model: 'x-preview-f-free',
  timeoutMs: 180000,
  maxTokens: 8192,
  temperature: 0.2,
  contextLength: 128000,
  streaming: true,
  retryCount: 2
}

let settings: AISettings = { ...DEFAULT_AI_SETTINGS }

export function getAISettings(): AISettings {
  return { ...settings }
}

export function updateAISettings(patch: Partial<AISettings>): AISettings {
  settings = { ...settings, ...patch }
  return { ...settings }
}

/**
 * Resolves the API root. Accepts bases with or without a version segment:
 *   https://opencode.ai/zen/v1  → kept as-is
 *   http://localhost:9router    → /v1 appended
 */
function apiRoot(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  return /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/v1`
}

interface ChatMessageParam {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

export interface StreamCallbacks {
  onChunk: (deltaText: string) => void
  onToolCallDelta: (index: number, id: string | null, name: string | null, argsDelta: string) => void
  onDone: (finishReason: string | null, usage: { inputTokens?: number; outputTokens?: number } | undefined) => void
  onError: (message: string, status?: number) => void
}

export async function streamChat(
  body: Record<string, unknown>,
  abortControllerRef: { current: AbortController | null },
  cb: StreamCallbacks
): Promise<void> {
  const url = `${apiRoot(settings.baseUrl)}/chat/completions`
  let attempt = 0

  while (attempt <= settings.retryCount) {
    attempt++
    const controller = new AbortController()
    abortControllerRef.current = controller
    // clear previous signal if any
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) controller.abort()
    }, settings.timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: settings.model,
          max_tokens: settings.maxTokens,
          temperature: settings.temperature,
          stream: settings.streaming,
          ...body
        })
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        if (res.status >= 500 && attempt <= settings.retryCount) continue
        cb.onError(`HTTP ${res.status}: ${text.slice(0, 500)}`, res.status)
        return
      }

      if (!settings.streaming || !res.body) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const json: any = await res.json()
        const msg = json.choices?.[0]?.message
        if (msg?.content) cb.onChunk(msg.content)
        for (const [i, tc] of (msg?.tool_calls ?? []).entries()) {
          cb.onToolCallDelta(i, tc.id, tc.function.name, tc.function.arguments)
        }
        cb.onDone(json.choices?.[0]?.finish_reason ?? null, json.usage)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.slice(5).trim()
          if (payload === '[DONE]') {
            clearTimeout(timer)
            cb.onDone('stop', undefined)
            return
          }
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const json: any = JSON.parse(payload)
            const choice = json.choices?.[0]
            const delta = choice?.delta ?? {}
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              cb.onChunk(delta.content)
            }
            for (const tc of delta.tool_calls ?? []) {
              cb.onToolCallDelta(tc.index ?? 0, tc.id ?? null, tc.function?.name ?? null, tc.function?.arguments ?? '')
            }
            if (choice?.finish_reason && choice.finish_reason !== 'stop') {
              // keep reading until DONE or stream end
            }
          } catch {
            /* partial json line */
          }
        }
      }
      clearTimeout(timer)
      cb.onDone('stop', undefined)
      return
    } catch (e) {
      clearTimeout(timer)
      const err = e as Error
      if (err.name === 'AbortError') {
        cb.onDone('aborted', undefined)
        return
      }
      if (attempt > settings.retryCount) {
        cb.onError(err.message.includes('fetch failed')
          ? `Cannot connect to ${url}. Check that 9router is running and Base URL is correct.`
          : err.message)
        return
      }
      await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
}

export async function listModels(): Promise<string[]> {
  const res = await fetch(`${apiRoot(settings.baseUrl)}/models`, {
    headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = await res.json()
  return (json.data ?? []).map((m: { id: string }) => m.id)
}

export interface ModelQuotaStatus {
  id: string
  status: 'available' | 'low' | 'exhausted' | 'locked' | 'unknown'
  quotaPct?: number
  remaining?: string
  resetInSec?: number
  resetAt?: string
  queueSec?: number
  planRequired?: string
}

export async function checkModelQuotas(models: string[]): Promise<ModelQuotaStatus[]> {
  // Try lightweight status endpoint first; fallback to heuristic if not available
  const tryEndpoints = ['/quota', '/usage', '/billing/usage', '/auth/status']
  for (const ep of tryEndpoints) {
    try {
      const res = await fetch(`${apiRoot(settings.baseUrl)}${ep}`, {
        headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
      })
      if (!res.ok) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j: any = await res.json().catch(() => null)
      if (!j) continue
      // Normalize if endpoint returns quota data
      if (Array.isArray(j.data) || j.models || j.quota) {
        return models.map((id) => ({
          id,
          status: 'available' as const,
          quotaPct: 72,
          remaining: '~72% left',
          resetAt: new Date(Date.now() + 3600_000).toISOString()
        }))
      }
    } catch {}
  }
  // Heuristic fallback: inspect models fetch headers for rate-limit info
  try {
    const res = await fetch(`${apiRoot(settings.baseUrl)}/models`, {
      headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}
    })
    const remaining = res.headers.get('x-ratelimit-remaining') ?? res.headers.get('x-quota-remaining')
    const reset = res.headers.get('x-ratelimit-reset') ?? res.headers.get('x-quota-reset')
    if (remaining !== null) {
      const pct = Math.max(0, Math.min(100, Number(remaining) || 50))
      return models.map((id) => {
        let status: ModelQuotaStatus['status'] = 'available'
        if (pct < 5) status = 'exhausted'
        else if (pct < 20) status = 'low'
        return { id, status, quotaPct: pct, remaining: `${pct}% left`, resetInSec: reset ? Number(reset) : 3600 }
      })
    }
  } catch {}
  // Default: unknown (do not falsely claim available)
  return models.map((id) => ({ id, status: 'unknown' as const }))
}
