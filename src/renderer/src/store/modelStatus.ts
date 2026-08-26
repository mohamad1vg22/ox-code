import { create } from 'zustand'

export type ModelQuotaState = 'available' | 'low' | 'exhausted' | 'locked' | 'unknown'

export interface ModelQuota {
  id: string
  status: ModelQuotaState
  quotaPct?: number
  remaining?: string
  resetInSec?: number
  resetAt?: string
  queueSec?: number
  planRequired?: string
}

interface Store {
  map: Record<string, ModelQuota>
  lastFetch: number
  fetching: boolean
  fetch: (models: string[]) => Promise<void>
}

const CACHE_MS = 3 * 60 * 1000 // 3 minutes

export const useModelStatus = create<Store>((set, get) => ({
  map: {},
  lastFetch: 0,
  fetching: false,
  fetch: async (models) => {
    if (!models.length) return
    const now = Date.now()
    if (now - get().lastFetch < CACHE_MS && Object.keys(get().map).length) return
    if (get().fetching) return
    set({ fetching: true })
    try {
      let data: ModelQuota[] | null = null
      try {
        data = (await window.oxcode.ai.modelStatus(models)) as ModelQuota[]
      } catch {
        data = null
      }
      if (!data || !Array.isArray(data)) {
        const fallback: Record<string, ModelQuota> = {}
        for (const id of models) fallback[id] = { id, status: 'unknown' }
        set({ map: fallback, lastFetch: now })
      } else {
        const m: Record<string, ModelQuota> = {}
        for (const q of data) m[q.id] = q
        // ensure all requested models have entry
        for (const id of models) if (!m[id]) m[id] = { id, status: 'unknown' }
        set({ map: m, lastFetch: now })
      }
    } finally {
      set({ fetching: false })
    }
  }
}))
