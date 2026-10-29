import type { MdekoApi } from '../shared/api'

declare global {
  interface Window {
    mdeko: MdekoApi
    platform: string
  }
}

export {}
