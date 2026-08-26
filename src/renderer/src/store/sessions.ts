import { create } from 'zustand'
import { useChat } from './chat'
import type { ChatMessage, RequestStats } from '../types'

export type SessionStatus = 'idle' | 'working' | 'done' | 'error'

export interface SessionTab {
  id: string
  title: string
  status: SessionStatus
  createdAt: number
  messages: ChatMessage[]
  stats: RequestStats
}

interface SessionsState {
  sessions: SessionTab[]
  activeId: string
  newSession: () => void
  closeSession: (id: string) => void
  switchSession: (id: string) => void
  reorder: (from: number, to: number) => void
  ensureOne: () => void
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function makeSession(): SessionTab {
  return {
    id: uid(),
    title: 'New session',
    status: 'idle',
    createdAt: Date.now(),
    messages: [],
    stats: { ...useChat.getState().stats }
  }
}

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 42 ? t.slice(0, 42).trimEnd() + '…' : t || 'New session'
}

const LS_KEY = 'oxcode.sessions.v1'
const MAX_STORED_MESSAGES = 400
const MAX_SESSIONS = 80

function loadPersisted(): { sessions: SessionTab[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { sessions: SessionTab[]; activeId: string; v: number }
    if (!Array.isArray(data.sessions) || !data.sessions.length) return null
    // sanitize: truncate huge messages to avoid quota
    const sessions = data.sessions.slice(0, MAX_SESSIONS).map((s) => ({
      ...s,
      messages: (s.messages ?? []).slice(-MAX_STORED_MESSAGES)
    })) as SessionTab[]
    return { sessions, activeId: data.activeId }
  } catch { return null }
}

function persist(sessions: SessionTab[], activeId: string): void {
  try {
    // also snapshot current chat into active session before persist is done by caller
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, sessions, activeId }))
  } catch {}
}

const _initial = loadPersisted()

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: _initial?.sessions ?? [makeSession()],
  activeId: _initial?.activeId ?? (_initial?.sessions?.[0]?.id ?? ''),

  newSession: () => {
    // snapshot current chat into its session, then reset and activate a new one
    const chat = useChat.getState()
    const s = makeSession()
    set((st) => ({
      sessions: [
        ...st.sessions.map((x) =>
          x.id === st.activeId ? { ...x, messages: chat.messages, stats: chat.stats } : x
        ),
        s
      ],
      activeId: s.id
    }))
    useChat.setState({ messages: [], plan: null, pendingChanges: [], streaming: false, phase: '' })
  },

  closeSession: (id) => {
    const { sessions, activeId } = get()
    const remaining = sessions.filter((s) => s.id !== id)
    if (!remaining.length) {
      const fresh = makeSession()
      useChat.setState({ messages: [], plan: null, pendingChanges: [], streaming: false, phase: '' })
      set({ sessions: [fresh], activeId: fresh.id })
      return
    }
    if (id === activeId) {
      const idx = sessions.findIndex((s) => s.id === id)
      const next = remaining[Math.min(idx, remaining.length - 1)]
      get().switchSession(next.id)
      set({ sessions: remaining })
    } else {
      set({ sessions: remaining })
    }
  },

  switchSession: (id) => {
    const { sessions, activeId } = get()
    if (id === activeId) return
    const chat = useChat.getState()
    const target = sessions.find((s) => s.id === id)
    if (!target) return
    const updated = sessions.map((s) =>
      s.id === activeId
        ? { ...s, messages: chat.messages, stats: chat.stats }
        : s
    )
    useChat.setState({
      messages: target.messages,
      stats: target.stats,
      streaming: false,
      phase: '',
      plan: null,
      pendingChanges: []
    })
    set({ sessions: updated, activeId: id })
  },

  reorder: (from, to) =>
    set((st) => {
      const sessions = [...st.sessions]
      const [moved] = sessions.splice(from, 1)
      sessions.splice(to, 0, moved)
      return { sessions }
    }),

  ensureOne: () => {
    if (!get().sessions.length) {
      const s = makeSession()
      set({ sessions: [s], activeId: s.id })
      persist([s], s.id)
    } else if (!get().activeId) {
      const id = get().sessions[0].id
      set({ activeId: id })
      persist(get().sessions, id)
    } else {
      // hydrate chat with active session on boot
      const st = get()
      const active = st.sessions.find((s) => s.id === st.activeId)
      if (active && active.messages.length) {
        useChat.setState({ messages: active.messages, stats: active.stats })
      }
    }
  }
}))

useSessions.getState().ensureOne()

// persist on every session change (debounced)
let persistTimer: ReturnType<typeof setTimeout> | null = null
useSessions.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => persist(state.sessions, state.activeId), 300)
})

// also persist chat messages into active session continuously
let chatPersistTimer: ReturnType<typeof setTimeout> | null = null
useChat.subscribe((chatState) => {
  if (chatPersistTimer) clearTimeout(chatPersistTimer)
  chatPersistTimer = setTimeout(() => {
    const st = useSessions.getState()
    const active = st.sessions.find((s) => s.id === st.activeId)
    if (!active) return
    const updated = st.sessions.map((s) => s.id === st.activeId ? { ...s, messages: chatState.messages.slice(-MAX_STORED_MESSAGES), stats: chatState.stats } : s)
    // avoid infinite loop: directly set without triggering above persist debounce twice -> we still persist via storage
    useSessions.setState({ sessions: updated } as Partial<SessionsState> as SessionsState)
    persist(updated, st.activeId)
  }, 400)
})

/** Keep the active session's title & status in sync with the chat store. */
let syncInitialized = false
export function initSessionSync(): void {
  if (syncInitialized) return
  syncInitialized = true

  let lastStreaming = false
  useChat.subscribe((state) => {
    const st = useSessions.getState()
    const active = st.sessions.find((s) => s.id === st.activeId)
    if (!active) return

    const patch: Partial<SessionTab> = {}

    // auto-title from the first user message
    if (active.title === 'New session') {
      const firstUser = state.messages.find((m) => m.role === 'user' && !m.content.startsWith('[SYSTEM'))
      if (firstUser) patch.title = titleFrom(firstUser.content)
    }

    // status follows streaming
    if (state.streaming !== lastStreaming) {
      lastStreaming = state.streaming
      patch.status = state.streaming ? 'working' : state.stats.error ? 'error' : 'done'
    }

    if (Object.keys(patch).length) {
      useSessions.setState({
        sessions: st.sessions.map((s) => (s.id === st.activeId ? { ...s, ...patch } : s))
      })
    }
  })
}
