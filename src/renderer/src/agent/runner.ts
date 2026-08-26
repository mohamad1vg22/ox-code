import type { ChatMessage, ToolCall } from '../types'
import { useChat } from '../store/chat'
import { useWorkspace } from '../store/workspace'
import { useSettings } from '../store/settings'
import { buildSystemPrompt } from '../ai/prompts'
import { executeTool, openAIToolsFormat, toolSummary } from './tools'
import * as checkpoints from './checkpoints'
import { buildSmartContext } from '../core/contextEngine'
import { analyzeChangeRisk } from '../core/risk'
import { runVerification } from '../core/verify'
import { formatRulesForPrompt } from '../core/rules'
import { detectIntent } from '../core/intent'
import { useUI } from '../store/ui'

function getMaxIterations(): number {
  const s = useSettings.getState() as { thinkingLevel?: string; agentMaxIterations?: number }
  if (s.agentMaxIterations) return s.agentMaxIterations
  const map: Record<string, number> = { eco: 8, balanced: 16, deep: 24, max: 40 }
  return map[s.thinkingLevel ?? 'balanced'] ?? 24
}

interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

let activeRequest: string | null = null

export function abortActiveRun(): void {
  if (activeRequest) {
    window.oxcode.ai.abort(activeRequest)
    // immediate local stop — prevents further iterations & shows feedback
    const chat = useChat.getState()
    chat.setStreaming(false)
    chat.setPhase('')
    // mark current streaming assistant message as aborted
    const msgs = chat.messages
    const lastStreaming = [...msgs].reverse().find((m) => m.isStreaming)
    if (lastStreaming) {
      useChat.setState((s) => ({
        messages: s.messages.map((m) => (m.id === lastStreaming.id ? { ...m, isStreaming: false, content: m.content + '\n\n— ⏹ Stopped by user' } : m))
      }))
    }
    activeRequest = null
    void window.oxcode.power.stopKeepAwake()
    useUI.getState().toast('info', 'Stopped', 'Generation halted by user')
  }
}

const HONESTY_CONTRACT = `
VERIFICATION CONTRACT (strict):
- Follow the minimal change principle: fix/implement exactly what was asked; do not restructure unrelated code.
- Preserve the existing code style, naming and architecture of the project.
- When you finish making changes, the system will automatically run this project's real validations (tests/typecheck/lint/build) if any exist.
- If verification results are provided to you and they FAIL, you must fix the failures and try again (within limits).
- NEVER claim success without evidence. End your final answer with EXACTLY one of:
  • "Task Verified ✓" followed by a one-line summary of what validation passed — only when validations ran and passed, or no changes were made that need them.
  • "Verification Failed ✗" plus what still fails — when validations failed and could not be fixed.
  • "Implementation completed." plus an honest note like "Verification not available because this project has no test/build command configured." — only when nothing runnable exists.`

export async function runAgentTurn(userText?: string, attachments?: import('../types').Attachment[]): Promise<void> {
  const chat = useChat.getState()
  const ws = useWorkspace.getState()
  const settingsStore = useSettings.getState()
  const settings = settingsStore.settings
  if (!settings) {
    useUI.getState().toast('error', 'AI settings not loaded')
    return
  }
  if (chat.streaming) return

  // keep the machine awake while the agent works
  void window.oxcode.power.startKeepAwake()

  if (userText !== undefined) {
    chat.addMessage({ id: uid(), role: 'user', content: userText, attachments })
    chat.setPlan(null)
  }

  const mode = useChat.getState().mode

  // ---------- Smart Context Engine ----------
  chat.setPhase('Analyzing request…')
  const intentInfo = detectIntent(useChat.getState().messages.at(-1)?.content ?? '')
  let contextBlock = ''
  let contextSummary = ''
  try {
    chat.setPhase('Finding relevant files & building context…')
    const ctx = await buildSmartContext(
      intentInfo.keywords.join(' ') + '\n' + (useChat.getState().messages.at(-1)?.content ?? '')
    )
    contextSummary = ctx.summary
    const parts: string[] = []
    if (ctx.files.length) {
      parts.push(
        '--- RELEVANT PROJECT CONTEXT (auto-selected by relevance — do not request more unless truly needed) ---\n' +
          ctx.files.map((f) => `\nFile: ${f.path} (relevance ${f.score}%)\n\`\`\`\n${f.content}\n\`\`\``).join('\n')
      )
    }
    if (ctx.rules.trim()) parts.push(formatRulesForPrompt(ctx.rules))
    if (ctx.recentChanges.length) {
      parts.push(
        '--- RECENT CHANGES ---\n' +
          ctx.recentChanges.slice(0, 8).map((c) => `${c.path} (modified ${c.modifiedAgoMin}m ago)`).join('\n')
      )
    }
    if (ctx.gitDiffStat.trim()) parts.push('--- CURRENT GIT DIFF STAT ---\n' + ctx.gitDiffStat)
    contextBlock = parts.length ? '\n\n' + parts.join('\n\n') : ''
  } catch {
    /* context building is best-effort */
  }

  // Build API messages
  const apiMessages: ApiMessage[] = [
    { role: 'system', content: buildSystemPrompt(mode, null, ws.rootName) },
    { role: 'system', content: HONESTY_CONTRACT }
  ]
  for (const m of useChat.getState().messages) {
    if (m.role === 'user') {
      if (m.attachments && m.attachments.length) {
        const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [{ type: 'text', text: m.content }]
        for (const a of m.attachments) {
          if (a.mime.startsWith('image/')) parts.push({ type: 'image_url', image_url: { url: a.dataUrl } })
          else parts.push({ type: 'text', text: `\n[File: ${a.name} (${a.mime})]\n${a.dataUrl.slice(0, 2000)}` })
        }
        apiMessages.push({ role: 'user', content: parts as never })
      } else {
        apiMessages.push({ role: 'user', content: m.content })
      }
    } else if (m.role === 'assistant') {
      apiMessages.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls && m.toolCalls.length
          ? {
              tool_calls: m.toolCalls.map((tc) => ({
                id: tc.id,
                type: 'function' as const,
                function: { name: tc.name, arguments: tc.args }
              }))
            }
          : {})
      })
    } else if (m.role === 'tool' && m.toolCallId) {
      apiMessages.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content })
    }
  }

  // attach smart context to the last user message
  const lastUserIdx = apiMessages.map((m) => m.role).lastIndexOf('user')
  if (contextBlock && lastUserIdx >= 0) {
    apiMessages[lastUserIdx].content = (apiMessages[lastUserIdx].content ?? '') + contextBlock
  }

  // ---------- Agent loop ----------
  chat.setStreaming(true)
  chat.setStats({ status: 'connecting', error: null, outputTokens: 0 })

  const runId = `run-${Date.now()}`
  const mutatedPaths = new Set<string>()
  const ctx = {
    runId,
    onSnapshot: (p: string) => checkpoints.snapshot(runId, p),
    onChange: (p: string, before: string | null, after: string) => {
      mutatedPaths.add(p)
      useChat.getState().addPendingChange({ id: uid(), path: p, before, after, reverted: false })
      void useWorkspace.getState().refreshTree()
      if (useWorkspace.getState().activePath === p) {
        void useWorkspace.getState().reloadFileFromDisk(p)
      } else {
        void useWorkspace.getState().openFile(p)
      }
    }
  }

  // risk analysis once mutations start accumulating is shown live in UI via store;
  // compute a final report after the loop.

  try {
    const MAX_ITERATIONS = getMaxIterations()
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const finished = await oneCompletion(apiMessages, settings.model, started())
      if (!finished.toolCalls) break

      chat.setPhase('Editing files / running tools…')
      chat.setStats({ status: 'tools' })

      const assistantMsg: ChatMessage = {
        id: uid(),
        role: 'assistant',
        content: finished.text,
        toolCalls: finished.toolCalls,
        toolExecutions: []
      }
      useChat.getState().addMessage(assistantMsg)
      apiMessages.push({
        role: 'assistant',
        content: finished.text || null,
        tool_calls: finished.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args }
        }))
      })

      for (const tc of finished.toolCalls) {
        useChat.getState().upsertToolExecution(assistantMsg.id, {
          id: uid(),
          callId: tc.id,
          name: tc.name,
          argsSummary: toolSummary(tc),
          status: 'running'
        })
        let outcome: { result: string; mutated: boolean }
        try {
          outcome = await executeTool(tc, ctx)
        } catch (e) {
          outcome = { result: `Tool error: ${(e as Error).message}`, mutated: false }
        }
        if (outcome.mutated) {
          useChat.setState({ lastCheckpointRunId: runId })
          useChat.getState().registerCheckpoint(runId, toolSummary(tc).slice(0, 60) || tc.name)
          useChat.getState().advancePlan()
        }
        const failed = outcome.result.startsWith('Error') || outcome.result.startsWith('Tool error')
        if (failed) useChat.getState().failPlan()
        useChat.getState().updateToolExecution(tc.id, {
          status: outcome.result.startsWith('Error') || outcome.result.startsWith('Tool error')
            ? 'error'
            : outcome.result.startsWith('User rejected')
              ? 'awaiting-approval'
              : 'done',
          result: outcome.result.slice(0, 4000)
        })
        apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: outcome.result })
        useChat.getState().addMessage({
          id: uid(),
          role: 'tool',
          content: outcome.result,
          toolCallId: tc.id
        })
      }
    }

    // ---------- Self-Verification Loop ----------
    if (mutatedPaths.size > 0 && mode !== 'plan') {
      const maxAttempts = Math.max(1, Math.min(10, useSettings.getState().verifyMaxAttempts))
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        chat.setPhase(attempt === 1 ? 'Verifying changes (tests/typecheck/build)…' : `Fix attempt ${attempt}/${maxAttempts} — verifying again…`)
        const report = await runVerification()

        if (report.available && report.allOk) {
          const passed = report.steps.map((s) => `${s.name}: PASS`).join(', ')
          useChat.getState().addMessage({
            id: uid(),
            role: 'user',
            content: `[SYSTEM VERIFICATION] All checks passed → ${passed}. You may now state the final result honestly ("Task Verified ✓").`
          })
          await oneCompletion(apiMessages, settings.model, started(), false)
          break
        }
        if (!report.available) {
          useChat.getState().addMessage({
            id: uid(),
            role: 'user',
            content: '[SYSTEM VERIFICATION] No test/typecheck/lint/build command detected in this project. State your final result honestly using "Implementation completed." with the honest unavailability note.'
          })
          await oneCompletion(apiMessages, settings.model, started(), false)
          break
        }

        // failed → feed failure details back into the loop
        const failing = report.steps.find((s) => !s.ok)!
        const failureMsg =
          `[SYSTEM VERIFICATION — attempt ${attempt}/${maxAttempts}] FAILED\n` +
          `Failing check: ${failing.name} (${failing.command})\n` +
          'Output:\n```\n' + failing.output.slice(-3000) + '\n```\n' +
          'Analyze the failure, fix it with your tools, then I will verify again.'
        useChat.getState().addMessage({ id: uid(), role: 'user', content: failureMsg })
        apiMessages.push({ role: 'user', content: failureMsg })

        for (let iter = 0; iter < 8; iter++) {
          const r = await oneCompletion(apiMessages, settings.model, started())
          if (!r.toolCalls) break
          const am: ChatMessage = { id: uid(), role: 'assistant', content: r.text, toolCalls: r.toolCalls, toolExecutions: [] }
          useChat.getState().addMessage(am)
          apiMessages.push({
            role: 'assistant',
            content: r.text || null,
            tool_calls: r.toolCalls.map((tc) => ({ id: tc.id, type: 'function' as const, function: { name: tc.name, arguments: tc.args } }))
          })
          for (const tc of r.toolCalls) {
            useChat.getState().upsertToolExecution(am.id, { id: uid(), callId: tc.id, name: tc.name, argsSummary: toolSummary(tc), status: 'running' })
            let outcome
            try {
              outcome = await executeTool(tc, ctx)
            } catch (e) {
              outcome = { result: `Tool error: ${(e as Error).message}`, mutated: false }
            }
            useChat.getState().updateToolExecution(tc.id, { status: outcome.result.startsWith('Error') ? 'error' : 'done', result: outcome.result.slice(0, 4000) })
            apiMessages.push({ role: 'tool', tool_call_id: tc.id, content: outcome.result })
            useChat.getState().addMessage({ id: uid(), role: 'tool', content: outcome.result, toolCallId: tc.id })
          }
        }

        if (attempt === maxAttempts) {
          useChat.getState().addMessage({
            id: uid(),
            role: 'assistant',
            content: `⚠️ Verification Failed ✗\n\nAfter ${maxAttempts} fix attempts the checks still do not pass. Changes remain applied (checkpointed) — review the diff or rollback from the Changes panel.`
          })
        }
      }
    }

    chat.setPhase('')
    chat.setStats({ status: 'idle' })
  } catch (e) {
    chat.setStats({ status: 'error', error: (e as Error).message })
  } finally {
    useChat.getState().setStreaming(false)
    useChat.getState().setPhase('')
    activeRequest = null
    void window.oxcode.power.stopKeepAwake()

    // process queued messages after the run finishes
    const next = useChat.getState().dequeue()
    if (next) setTimeout(() => void handleSendMessage(next), 150)
  }

  function started(): number {
    return Date.now()
  }
}

/** One model completion round. Returns text + parsed tool calls. */
async function oneCompletion(
  apiMessages: ApiMessage[],
  model: string,
  _t0: number,
  allowTools = true
): Promise<{ text: string; toolCalls: ToolCall[] | null }> {
  const requestId = uid()
  activeRequest = requestId
  const chatStore = useChat.getState()

  const msgId = uid()
  chatStore.addMessage({ id: msgId, role: 'assistant', content: '', isStreaming: true })

  const t0 = Date.now()
  const toolAcc = new Map<number, { id: string; name: string; args: string }>()
  let usageTokens: number | undefined
  let streamError: string | null = null

  const offChunk = window.oxcode.ai.onChunk((p: any) => {
    if (p.requestId !== requestId) return
    if (p.type === 'text') {
      useChat.getState().appendToMessage(msgId, p.delta)
      const content = useChat.getState().messages.find((m) => m.id === msgId)?.content.length ?? 0
      useChat.getState().setStats({
        status: 'streaming',
        latencyMs: Date.now() - t0,
        outputTokens: Math.ceil(content / 4)
      })
    } else if (p.type === 'tool_call') {
      const entry = toolAcc.get(p.index) ?? { id: '', name: '', args: '' }
      if (p.id) entry.id = p.id
      if (p.name) entry.name = p.name
      entry.args += p.delta ?? ''
      toolAcc.set(p.index, entry)
    }
  })
  const offDone = window.oxcode.ai.onDone((p: any) => {
    if (p.requestId !== requestId) return
    usageTokens = p.usage?.totalTokens
  })
  const offError = window.oxcode.ai.onError((p: any) => {
    if (p.requestId !== requestId) return
    streamError = p.message
  })

  const body: Record<string, unknown> = { messages: apiMessages }
  if (allowTools) {
    body['tools'] = openAIToolsFormat()
    body['tool_choice'] = 'auto'
  }

  let invokeError: string | null = null
  try {
    const res = await window.oxcode.ai.chat(requestId, body)
    if (!res.ok && res.error) invokeError = res.error
  } catch (e) {
    invokeError = (e as Error).message
  }

  offChunk()
  offDone()
  offError()

  const text = useChat.getState().messages.find((m) => m.id === msgId)?.content ?? ''

  useChat.setState((s) => ({
    messages: s.messages.map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
  }))

  if (streamError || invokeError) {
    const err = streamError ?? invokeError ?? 'Unknown AI error'
    useChat.getState().setMessageContent(msgId, `${text}⚠️ ${err}`.trim())
    useChat.getState().setStats({ status: 'error', error: err })
    useUI.getState().toast('error', 'AI request failed', err)
    return { text: '', toolCalls: null }
  }

  const toolCalls: ToolCall[] = [...toolAcc.values()]
    .filter((t) => t.name)
    .map((t, i) => ({ id: t.id || `call_${i}_${Date.now()}`, name: t.name, args: t.args }))

  useChat.getState().setStats({
    latencyMs: Date.now() - t0,
    inputTokens:
      usageTokens ?? Math.ceil(apiMessages.reduce((a, m) => {
        const c = m.content
        const len = typeof c === 'string' ? (c?.length ?? 0) : c ? JSON.stringify(c).length : 0
        return a + len
      }, 0) / 4)
  })

  return { text, toolCalls: toolCalls.length ? toolCalls : null }
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function handleSendMessage(text: string, attachments?: import('../types').Attachment[]): Promise<void> {
  const chat = useChat.getState()
  if (chat.mode === 'plan') {
    await runAgentTurnWithPlanExtraction(text, attachments)
  } else {
    await runAgentTurn(text, attachments)
  }
}

async function runAgentTurnWithPlanExtraction(text: string, attachments?: import('../types').Attachment[]): Promise<void> {
  await runAgentTurn(text, attachments)
  const msgs = useChat.getState().messages
  const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
  if (!lastAssistant) return
  const match = lastAssistant.content.match(/```plan\n([\s\S]*?)```/)
  if (match) {
    const steps = match[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean)
    useChat.getState().setPlan({ steps, messageId: lastAssistant.id, status: 'proposed', currentStep: -1, doneSteps: 0 })
  }
}

export async function approvePlan(): Promise<void> {
  const plan = useChat.getState().plan
  if (!plan) return
  useChat.getState().setPlan({ ...plan, status: 'approved', doneSteps: 0, currentStep: plan.steps.length ? 0 : -1 })
  useChat.getState().setMode('agent')
  await runAgentTurn('The plan above is approved. Execute it now, step by step, using your tools. Verify with tests/build where applicable.')
}

export function cancelPlan(): void {
  const plan = useChat.getState().plan
  if (plan) useChat.getState().setPlan({ ...plan, status: 'cancelled' })
}

/**
 * Multi-agent pipeline: sequential role-framed agent turns.
 */
export interface PipelineStage {
  agent: string
  instruction: string
}

export async function runPipeline(stages: PipelineStage[]): Promise<void> {
  for (const stage of stages) {
    useChat.getState().addMessage({
      id: uid(),
      role: 'user',
      content: `🤖 [${stage.agent} Agent] ${stage.instruction}`
    })
    await runAgentTurn(`You are now acting as the ${stage.agent} Agent. ${stage.instruction}\n\nWhen done, summarize what you did and what remains for the next agent.`)
  }
}

export const PIPELINES: Record<string, PipelineStage[]> = {
  'Build Feature': [
    { agent: 'Architect', instruction: 'Analyze the request against the current codebase and produce a concrete implementation plan (files, modules, contracts).' },
    { agent: 'Coding', instruction: 'Implement the plan from the Architect. Write all necessary code using your tools.' },
    { agent: 'Tester', instruction: 'Generate and run tests for the new functionality; fix failures you find.' },
    { agent: 'Reviewer', instruction: 'Review all changes made in this session for bugs, security issues and quality. Fix anything critical.' }
  ],
  'Fix & Verify': [
    { agent: 'Debug', instruction: 'Reproduce/locate the reported problem and identify its root cause.' },
    { agent: 'Coding', instruction: 'Implement the fix proposed by the Debug Agent.' },
    { agent: 'Tester', instruction: 'Run the relevant tests / commands to verify the fix. If it fails, fix again until green.' }
  ],
  'Quality Pass': [
    { agent: 'Review', instruction: 'Review the current project state: bugs, security, performance, duplication. Produce a prioritized findings list.' },
    { agent: 'Refactor', instruction: 'Address the top findings from the Review Agent via careful refactors that preserve behavior.' },
    { agent: 'Security', instruction: 'Do a security-focused pass over the changed files (injection, secrets handling, authz, input validation). Fix critical issues.' }
  ]
}
