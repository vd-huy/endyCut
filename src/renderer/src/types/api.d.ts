import type { CutCloneApi } from '../../../preload'

declare global {
  interface Window {
    api: CutCloneApi
  }
}

export {}
