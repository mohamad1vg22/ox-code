export interface FileNodeDTO {
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FileNodeDTO[]
}

export interface SearchHitDTO {
  path: string
  line: number
  text: string
}

export interface SymbolDTO {
  path: string
  name: string
  kind: string
  line: number
}

export interface ProjectInfoDTO {
  files: number
  languages: Record<string, number>
  dependencies: string[]
  entryPoints: string[]
  testDirs: string[]
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ToolCall {
  id: string
  name: string
  args: string
}

export type ToolStatus = 'pending' | 'running' | 'done' | 'error' | 'awaiting-approval'

export interface ToolExecution {
  id: string
  callId: string
  name: string
  argsSummary: string
  status: ToolStatus
  result?: string
}

export interface Attachment {
  id: string
  name: string
  mime: string
  dataUrl: string
  size: number
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  attachments?: Attachment[]
  toolCalls?: ToolCall[]
  toolExecutions?: ToolExecution[]
  toolCallId?: string
  isStreaming?: boolean
  error?: boolean
}

export interface PendingChange {
  id: string
  path: string
  before: string | null
  after: string
  reverted: boolean
}

export interface AISettingsDTO {
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

export interface RequestStats {
  model: string
  status: 'idle' | 'connecting' | 'streaming' | 'error' | 'tools'
  inputTokens: number
  outputTokens: number
  latencyMs: number
  error: string | null
}

export interface AnalysisResultDTO {
  graph: Record<string, string[]>
  reverseGraph: Record<string, string[]>
  cycles: string[][]
  orphans: string[]
  hubs: Array<{ file: string; dependents: number }>
  totalFiles: number
  totalEdges: number
}
