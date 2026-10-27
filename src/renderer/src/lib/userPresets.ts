// User-defined presets (CapCut-style "Lưu làm mặc định"): the color presets
// capture basic filters + advanced grading; audio presets capture the sound
// section of a clip. They live in localStorage — no project file coupling.

import type { AudioEffectKind, ColorAdvanced, ColorFilters } from '@shared/document'
import { createColorAdvanced, NEUTRAL_FILTERS } from '@shared/document'

const COLOR_KEY = 'cc-user-color-presets'
const AUDIO_KEY = 'cc-user-audio-presets'

export interface UserColorPreset {
  id: string
  name: string
  filters: ColorFilters
  colorAdvanced: ColorAdvanced
}

export interface UserAudioPreset {
  id: string
  name: string
  volume: number
  fadeIn: number
  fadeOut: number
  audioNormalize: boolean
  audioEffect: AudioEffectKind
}

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as T[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value.slice(0, 30)))
  } catch {
    /* quota */
  }
}

export function loadColorPresets(): UserColorPreset[] {
  return read<UserColorPreset>(COLOR_KEY).map((p) => ({
    ...p,
    filters: { ...NEUTRAL_FILTERS, ...p.filters },
    colorAdvanced: createColorAdvanced(p.colorAdvanced)
  }))
}

export function saveColorPreset(name: string, filters: ColorFilters, colorAdvanced: ColorAdvanced | undefined): UserColorPreset {
  const preset: UserColorPreset = {
    id: crypto.randomUUID(),
    name,
    filters: { ...filters },
    colorAdvanced: colorAdvanced ? { ...colorAdvanced } : createColorAdvanced()
  }
  write<UserColorPreset>(COLOR_KEY, [...loadColorPresets(), preset])
  return preset
}

export function deleteColorPreset(id: string): void {
  write<UserColorPreset>(COLOR_KEY, loadColorPresets().filter((p) => p.id !== id))
}

export function loadAudioPresets(): UserAudioPreset[] {
  return read<UserAudioPreset>(AUDIO_KEY)
}

export function saveAudioPreset(name: string, clip: UserAudioPreset): void {
  write<UserAudioPreset>(AUDIO_KEY, [...loadAudioPresets(), { ...clip, id: crypto.randomUUID(), name }])
}

export function deleteAudioPreset(id: string): void {
  write<UserAudioPreset>(AUDIO_KEY, loadAudioPresets().filter((p) => p.id !== id))
}
