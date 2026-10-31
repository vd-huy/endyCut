import type { EndyCutApi } from '../../../preload'

declare global {
  interface Window {
    api: EndyCutApi
  }
}

export {}
