import { create } from 'zustand'
import type { ChatMessage, PendingChange, RequestStats, ToolExecution } from '../types'
import { useWorkspace } from './workspace'

export type ChatMode = 'agent' | 'plan' | 'ask'

export interface PlanState {
  steps: string[]
  messageId: string
  status: 'proposed' | 'approved' | 'cancelled'
  /** index of the phase currently executing (-1 = none) */
  currentStep: number
  /** number of completed phases */
  doneSteps: number
}

export interface CheckpointMarker {
  runId: string
  ts: number
  label: string
}

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  mode: ChatMode
  phase: string
  contextFiles: string[]
  contextChars: number
  customInstruction: string
  plan: PlanState | null
  pendingChanges: PendingChange[]
  lastCheckpointRunId: string | null
  checkpoints: CheckpointMarker[]
  queue: string[]
  stats: RequestStats
  runCounter: number

  setPhase: (p: string) => void
  setStreaming: (v: boolean) => void
  setMode: (m: ChatMode) => void
  addMessage: (m: ChatMessage) => void
  removeMessagesFrom: (id: string) => void
  appendToMessage: (id: string, delta: string) => void
  setMessageContent: (id: string, content: string) => void
  upsertToolExecution: (msgId: string, exec: ToolExecution) => void
  updateToolExecution: (callId: string, patch: Partial<ToolExecution>) => void
  addContextFile: (path: string) => Promise<void>
  removeContextFile: (path: string) => void
  clearContext: () => void
  setCustomInstruction: (text: string) => void
  setPlan: (p: PlanState | null) => void
  updatePlanSteps: (steps: string[]) => void
  advancePlan: () => void
  failPlan: () => void
  addPendingChange: (c: PendingChange) => void
  rejectPendingChange: (id: string) => Promise<void>
  acceptPendingChange: (id: string) => void
  clearPendingChanges: () => void
  registerCheckpoint: (runId: string, label: string) => void
  rollbackCheckpoint: (runId?: string) => Promise<void>
  enqueue: (text: string) => void
  dequeue: () => string | undefined
  resetChat: () => void
  setStats: (patch: Partial<RequestStats>) => void
}

const IDLE_STATS: RequestStats = {
  model: '—',
  status: 'idle',
  inputTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  error: null
}

async function loadContextChar(path: string): Promise<number> {
  try {
    const r = await window.oxcode.files.read(path)
    return r.content.length
  } catch {
    return 0
  }
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  mode: 'agent',
  phase: '',
  contextFiles: [],
  contextChars: 0,
  customInstruction: (() => {
    try { return localStorage.getItem('oxcode.customInstruction') ?? '' } catch { return '' }
  })(),
  plan: null,
  pendingChanges: [],
  lastCheckpointRunId: null,
  checkpoints: [],
  queue: [],
  stats: { ...IDLE_STATS },
  runCounter: 0,

  setStreaming: (v) => set({ streaming: v }),
  setPhase: (p) => set({ phase: p }),
  setMode: (m) => set({ mode: m }),

  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

  removeMessagesFrom: (id) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === id)
      return idx >= 0 ? { messages: s.messages.slice(0, idx) } : {}
    }),

  appendToMessage: (id, delta) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m))
    })),

  setMessageContent: (id, content) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, content } : m)) })),

  upsertToolExecution: (msgId, exec) =>
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== msgId) return m
        const execs = m.toolExecutions ?? []
        const existing = execs.find((e) => e.callId === exec.callId)
        return {
          ...m,
          toolExecutions: existing
            ? execs.map((e) => (e.callId === exec.callId ? exec : e))
            : [...execs, exec]
        }
      })
    })),

  updateToolExecution: (callId, patch) =>
    set((s) => ({
      messages: s.messages.map((m) => ({
        ...m,
        toolExecutions: (m.toolExecutions ?? []).map((e) => (e.callId === callId ? { ...e, ...patch } : e))
      }))
    })),

  addContextFile: async (path) => {
    if (get().contextFiles.includes(path)) return
    const chars = await loadContextChar(path)
    set((s) => ({ contextFiles: [...s.contextFiles, path], contextChars: s.contextChars + chars }))
  },

  removeContextFile: (path) => {
    const files = get().contextFiles.filter((f) => f !== path)
    const cached = useWorkspace.getState().contents[path]
    const removed = cached ? cached.length : 2000
    set((s) => ({ contextFiles: files, contextChars: Math.max(0, s.contextChars - removed) }))
  },

  clearContext: () => set({ contextFiles: [], contextChars: 0 }),

  setCustomInstruction: (text) => {
    try {
      if (text.trim()) localStorage.setItem('oxcode.customInstruction', text)
      else localStorage.removeItem('oxcode.customInstruction')
    } catch {
      /* ignore */
    }
    set({ customInstruction: text })
  },

  setPlan: (p) => set({ plan: p }),

  updatePlanSteps: (steps) =>
    set((s) => (s.plan ? { plan: { ...s.plan, steps } } : {})),

  advancePlan: () =>
    set((s) => {
      if (!s.plan || s.plan.status !== 'approved') return {}
      const done = Math.min(s.plan.doneSteps + 1, s.plan.steps.length)
      return { plan: { ...s.plan, doneSteps: done, currentStep: done < s.plan.steps.length ? done : -1 } }
    }),

  failPlan: () =>
    set((s) => (s.plan ? { plan: { ...s.plan, currentStep: -1 } } : {})),

  addPendingChange: (c) => set((s) => ({ pendingChanges: [c, ...s.pendingChanges] })),

  rejectPendingChange: async (id) => {
    const change = get().pendingChanges.find((c) => c.id === id)
    if (!change || change.reverted) return
    try {
      if (change.before === null) {
        await window.oxcode.files.delete(change.path)
      } else {
        await window.oxcode.files.write(change.path, change.before)
      }
    } catch {
      /* keep the change listed so the user can retry */
      return
    }
    await useWorkspace.getState().refreshTree()
    if (useWorkspace.getState().activePath === change.path) {
      await useWorkspace.getState().reloadFileFromDisk(change.path)
    }
    set((s) => ({
      pendingChanges: s.pendingChanges.filter((c) => c.id !== id)
    }))
  },

  acceptPendingChange: (id) =>
    set((s) => ({ pendingChanges: s.pendingChanges.filter((c) => c.id !== id) })),

  clearPendingChanges: () => set({ pendingChanges: [] }),

  registerCheckpoint: (runId, label) =>
    set((s) => {
      if (s.checkpoints.some((c) => c.runId === runId)) return {}
      return { checkpoints: [...s.checkpoints, { runId, ts: Date.now(), label }] }
    }),

  rollbackCheckpoint: async (runId) => {
    const target = runId ?? get().lastCheckpointRunId
    if (!target) return
    const { rollback } = await import('../agent/checkpoints')
    await rollback(target)
    await useWorkspace.getState().refreshTree()
    for (const t of useWorkspace.getState().tabs) {
      await useWorkspace.getState().reloadFileFromDisk(t.path)
    }
    set((s) => ({
      lastCheckpointRunId: null,
      pendingChanges: [],
      checkpoints: s.checkpoints.filter((c) => c.runId !== target)
    }))
  },

  enqueue: (text) => set((s) => ({ queue: [...s.queue, text] })),
  dequeue: () => {
    const q = get().queue
    if (!q.length) return undefined
    set({ queue: q.slice(1) })
    return q[0]
  },

  resetChat: () =>
    set({
      messages: [],
      plan: null,
      pendingChanges: [],
      stats: { ...IDLE_STATS },
      streaming: false,
      queue: []
    }),

  setStats: (patch) => set((s) => ({ stats: { ...s.stats, ...patch } }))
}))
