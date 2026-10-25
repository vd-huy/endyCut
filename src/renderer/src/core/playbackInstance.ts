import type { PlaybackEngine } from './playback'

/**
 * Process-wide handle to the active preview engine. Kept separate from App.tsx
 * so non-component modules can grab the engine without circular imports.
 */
let instance: PlaybackEngine | null = null

export function setEngineInstance(engine: PlaybackEngine | null): void {
  instance = engine
}

export function getEngineInstance(): PlaybackEngine | null {
  return instance
}
