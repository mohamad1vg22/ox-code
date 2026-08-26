import { create } from 'zustand'
import type { AISettingsDTO } from '../types'

export type ThinkingLevel = 'eco' | 'balanced' | 'deep' | 'max'

interface SettingsState {
  settings: AISettingsDTO | null
  models: string[]
  modelsError: string | null
  inlineCompletion: boolean
  autoSave: boolean
  fontSize: number
  wordWrap: boolean
  verifyMaxAttempts: number
  thinkingLevel: ThinkingLevel
  agentMaxIterations: number
  load: () => Promise<void>
  update: (patch: Partial<AISettingsDTO>) => Promise<void>
  fetchModels: () => Promise<boolean>
  setLocal: (patch: Partial<Pick<SettingsState, 'inlineCompletion' | 'autoSave' | 'fontSize' | 'wordWrap' | 'verifyMaxAttempts' | 'thinkingLevel' | 'agentMaxIterations'>>) => void
}

const LS_KEY = 'oxcode.editor'

function loadLocal(): Partial<SettingsState> {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

const DEFAULTS = {
  inlineCompletion: true,
  autoSave: false,
  fontSize: 13,
  wordWrap: false,
  verifyMaxAttempts: 5,
  thinkingLevel: 'balanced' as ThinkingLevel,
  agentMaxIterations: 24
} as const

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  ...loadLocal(),
  settings: null,
  models: [],
  modelsError: null,

  load: async () => {
    const settings = await window.oxcode.ai.getSettings()
    set({ settings })
  },

  update: async (patch) => {
    const settings = await window.oxcode.ai.updateSettings(patch)
    set({ settings, modelsError: null })
  },

  fetchModels: async () => {
    try {
      const models = await window.oxcode.ai.listModels()
      set({ models, modelsError: null })
      if (models.length && !models.includes(get().settings?.model ?? '')) {
        await get().update({ model: models[0] })
      }
      return true
    } catch (e) {
      set({ modelsError: (e as Error).message })
      return false
    }
  },

  setLocal: (patch) => {
    set(patch as never)
    const { inlineCompletion, autoSave, fontSize, wordWrap, verifyMaxAttempts, thinkingLevel, agentMaxIterations } = get()
    localStorage.setItem(LS_KEY, JSON.stringify({ inlineCompletion, autoSave, fontSize, wordWrap, verifyMaxAttempts, thinkingLevel, agentMaxIterations }))
  }
}))
