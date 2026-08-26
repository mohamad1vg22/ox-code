import type { OXCodeAPI } from './index'

declare global {
  interface Window {
    oxcode: OXCodeAPI
  }
}

export {}
