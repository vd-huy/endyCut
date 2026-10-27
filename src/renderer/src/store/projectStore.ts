import { create } from 'zustand'
import type {
  Clip,
  ClipEffect,
  ColorFilters,
  Compound,
  Keyframe,
  Marker,
  MediaAsset,
  ProjectDocument,
  ProjectSettings,
  Track,
  Transform,
  Transition,
  TextStyle
} from '@shared/document'
import {
  clipSourceSpan,
  clipTimelineTimeForSource,
  createClip,
  createProjectDocument,
  createSticker,
  createText,
  createTrack,
  needsProxy,
  normalizeDocument,
  totalDuration
} from '@shared/document'
import { overlapsTrack, resolveDropStart, splitClip } from '@shared/timelineMath'
import { ensureProxy } from '../core/media/assets'
import { buildReversedMediaAsset } from '../core/media/reverse'

const HISTORY_LIMIT = 60

/** Module-level busy flags so repeated calls don't double-generate. */
const proxyGeneration = new Set<string>()
let reverseBusy = false

interface Selection {
  clipId: string | null
  /** Additional selected clips (multi-select, Shift-click / box select). */
  clipIds: string[]
}

interface ProjectState {
  doc: ProjectDocument
  selection: Selection
  filePath: string | null
  dirty: boolean
  past: string[]
  future: string[]
  /** Clips copied with Ctrl+C, pasted with Ctrl+V at the playhead. */
  clipboard: Clip[]

  pushHistory(): void
  undo(): void
  redo(): void
  canUndo(): boolean
  canRedo(): boolean

  selectClip(clipId: string | null): void
  setSelection(clipIds: string[]): void
  findClip(clipId: string): { track: Track; clip: Clip } | null
  findAsset(assetId: string): MediaAsset | null

  setSettings(patch: Partial<ProjectSettings>): void
  loadDocument(doc: ProjectDocument): void
  resetToNewDocument(): void
  markSaved(filePath: string | null): void

  addAssetsToLibrary(assets: MediaAsset[]): void
  removeAsset(assetId: string): void

  /** Place an asset automatically at the playhead on a suitable track. */
  addAssetToTimeline(assetId: string, atTime: number): void
  /** Drop an asset onto one specific track at a time position. */
  addAssetToTrack(assetId: string, trackId: string, atTime: number): boolean
  addTextClip(atTime: number, trackId?: string): string | null
  addStickerClip(atTime: number, emoji: string): string | null
  /** Replace/create a captions text track from parsed SRT cues. */
  addSrtCaptions(cues: Array<{ start: number; end: number; text: string }>): void
  /** Collect text clips (in timeline order) for SRT export. */
  collectTextCues(): Array<{ start: number; end: number; text: string }>

  moveClip(clipId: string, toTrackId: string, desiredStart: number): boolean
  trimClip(clipId: string, edge: 'left' | 'right', newTime: number): void
  splitClipAt(clipId: string, time: number): void
  deleteClip(clipId: string): void
  /** Delete a clip and shift later clips on the same track left (ripple). */
  rippleDeleteClip(clipId: string): void
  duplicateClip(clipId: string): void
  copySelection(): void
  pasteFromClipboard(atTime: number): void
  updateClip(clipId: string, patch: Partial<Clip>): void
  updateTransform(clipId: string, patch: Partial<Transform>): void
  updateFilters(clipId: string, patch: Partial<ColorFilters>): void
  updateText(clipId: string, patch: Partial<TextStyle>): void
  setTransition(clipId: string, transition: Transition | null): void
  addEffectToClip(clipId: string, effect: Omit<ClipEffect, 'id'>): void
  updateEffect(clipId: string, effectId: string, patch: { start?: number; duration?: number }): void
  removeEffectFromClip(clipId: string, effectId: string): void
  addKeyframe(clipId: string, keyframe: Omit<Keyframe, 'id'>): void
  updateKeyframe(clipId: string, keyframeId: string, patch: Partial<Keyframe>): void
  removeKeyframe(clipId: string, keyframeId: string): void

  // --- Tier-1 layer additions (CapCut parity) ----------------------------
  /** Merge the selected clips into one nested compound clip. */
  groupIntoCompound(clipIds: string[]): string | null
  /** Unpack a compound clip back onto its own tracks. */
  ungroupCompound(clipId: string): boolean
  /** Patch asset metadata (beats, bpm, rms, proxyPath…). */
  patchAsset(assetId: string, patch: Partial<MediaAsset>): void
  /** Add green beat markers at every detected beat of this asset. */
  addBeatMarkers(assetId: string): number
  removeAllBeatMarkers(): void
  /** Background-render preview proxies for heavy clips. */
  ensureProxies(): Promise<void>
  /** Render a reversed copy of a video clip (audio reversed as well). */
  reverseClip(clipId: string): Promise<boolean>

  /** Create a new audio clip on an audio track that plays a video clip's sound. */
  extractAudio(clipId: string): boolean

  addMarker(time: number, label?: string): void
  updateMarker(markerId: string, patch: Partial<Omit<Marker, 'id'>>): void
  removeMarker(markerId: string): void

  addTrack(kind: Track['kind']): void
  removeTrack(trackId: string): void
  updateTrack(trackId: string, patch: Partial<Track>): void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  doc: createProjectDocument(),
  selection: { clipId: null, clipIds: [] },
  filePath: null,
  dirty: false,
  past: [],
  future: [],
  clipboard: [],

  pushHistory() {
    const { doc, past } = get()
    const next = [...past, JSON.stringify(doc)].slice(-HISTORY_LIMIT)
    set({ past: next, future: [], dirty: true })
  },

  undo() {
    const { past, future, doc } = get()
    if (past.length === 0) return
    const previous = past[past.length - 1]
    set({
      doc: JSON.parse(previous) as ProjectDocument,
      past: past.slice(0, -1),
      future: [...future, JSON.stringify(doc)].slice(-HISTORY_LIMIT),
      selection: { clipId: null, clipIds: [] },
      dirty: true
    })
  },

  redo() {
    const { past, future, doc } = get()
    if (future.length === 0) return
    const nextDoc = future[future.length - 1]
    set({
      doc: JSON.parse(nextDoc) as ProjectDocument,
      past: [...past, JSON.stringify(doc)].slice(-HISTORY_LIMIT),
      future: future.slice(0, -1),
      selection: { clipId: null, clipIds: [] },
      dirty: true
    })
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  selectClip: (clipId) => set({ selection: { clipId, clipIds: clipId ? [clipId] : [] } }),

  setSelection: (clipIds) =>
    set({ selection: { clipId: clipIds[clipIds.length - 1] ?? null, clipIds: [...clipIds] } }),

  findClip(clipId) {
    for (const track of get().doc.tracks) {
      const clip = track.clips.find((c) => c.id === clipId)
      if (clip) return { track, clip }
    }
    return null
  },

  findAsset(assetId) {
    return get().doc.mediaLibrary.find((a) => a.id === assetId) ?? null
  },

  setSettings(patch) {
    get().pushHistory()
    set((state) => ({
      doc: {
        ...state.doc,
        settings: { ...state.doc.settings, ...patch },
        modifiedAt: Date.now()
      }
    }))
  },

  loadDocument(raw) {
    const doc = normalizeDocument(raw)
    set({ doc, selection: { clipId: null, clipIds: [] }, past: [], future: [], filePath: null, dirty: false })
  },

  resetToNewDocument() {
    set({
      doc: createProjectDocument(),
      selection: { clipId: null, clipIds: [] },
      past: [],
      future: [],
      filePath: null,
      dirty: false
    })
  },

  markSaved: (filePath) => set({ filePath, dirty: false }),

  addAssetsToLibrary(assets) {
    if (assets.length === 0) return
    set((state) => ({
      doc: {
        ...state.doc,
        mediaLibrary: [...state.doc.mediaLibrary, ...assets],
        modifiedAt: Date.now()
      },
      dirty: true
    }))
  },

  removeAsset(assetId) {
    get().pushHistory()
    set((state) => {
      const doc = clone(state.doc)
      doc.mediaLibrary = doc.mediaLibrary.filter((a) => a.id !== assetId)
      for (const track of doc.tracks) {
        track.clips = track.clips.filter((c) => c.assetId !== assetId)
      }
      return { doc, selection: { clipId: null, clipIds: [] } }
    })
  },

  addAssetToTimeline(assetId, atTime) {
    const asset = get().findAsset(assetId)
    if (!asset) return
    const state = get()
    // Choose track: match by kind, first track where the clip fits.
    const wantedKind = asset.kind === 'audio' ? 'audio' : 'video'
    const kindOfClip: Clip['kind'] = asset.kind === 'image' ? 'image' : asset.kind
    const duration = asset.kind === 'image' ? Math.max(2, Math.min(5, asset.duration)) : asset.duration
    const tracks = state.doc.tracks
    let target = tracks.find((t) => t.kind === wantedKind && !overlapsTrack(t, '', atTime, duration) && !t.locked)
    if (!target) {
      // create a new track of that kind on top of existing ones
      const name = `${wantedKind === 'audio' ? 'Âm thanh' : 'Video'} ${tracks.filter((t) => t.kind === wantedKind).length + 1}`
      get().pushHistory()
      set((s) => {
        const doc = clone(s.doc)
        const insertIndex = wantedKind === 'video'
          ? doc.tracks.findIndex((t) => t.kind !== 'text')
          : doc.tracks.length
        const track = createTrack(wantedKind, name)
        doc.tracks.splice(Math.max(0, insertIndex), 0, track)
        return { doc }
      })
      target = get().doc.tracks.find((t) => t.kind === wantedKind)!
    } else {
      get().pushHistory()
    }
    const clip = createClip({
      kind: kindOfClip,
      assetId,
      start: Math.max(0, atTime),
      duration
    })
    set((s) => {
      const doc = clone(s.doc)
      const track = doc.tracks.find((t) => t.id === target!.id)!
      track.clips.push(clip)
      track.clips.sort((a, b) => a.start - b.start)
      return { doc, selection: { clipId: clip.id, clipIds: [clip.id] } }
    })
  },

  addAssetToTrack(assetId, trackId, atTime) {
    const asset = get().findAsset(assetId)
    if (!asset) return false
    const track = get().doc.tracks.find((t) => t.id === trackId)
    if (!track || track.locked) return false
    const wantedKind = asset.kind === 'audio' ? 'audio' : 'video'
    if (track.kind !== wantedKind) return false
    const kindOfClip: Clip['kind'] = asset.kind === 'image' ? 'image' : asset.kind
    const duration = asset.kind === 'image' ? Math.max(2, Math.min(5, asset.duration)) : asset.duration
    const resolved = resolveDropStart(track, '', Math.max(0, atTime), duration)
    if (resolved === null) return false
    get().pushHistory()
    const clip = createClip({ kind: kindOfClip, assetId, start: resolved, duration })
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks.find((t) => t.id === trackId)!
      target.clips.push(clip)
      target.clips.sort((a, b) => a.start - b.start)
      return { doc, selection: { clipId: clip.id, clipIds: [clip.id] } }
    })
    return true
  },

  addTextClip(atTime, trackId) {
    const state = get()
    const track = trackId
      ? state.doc.tracks.find((t) => t.id === trackId)
      : state.doc.tracks.find((t) => t.kind === 'text')
    if (!track) return null
    const duration = 3
    const resolved = resolveDropStart(track, '', Math.max(0, atTime), duration)
    if (resolved === null) return null
    get().pushHistory()
    const clip = createClip({ kind: 'text', start: resolved, duration, text: createText() })
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks.find((t) => t.id === track.id)!
      target.clips.push(clip)
      target.clips.sort((a, b) => a.start - b.start)
      return { doc, selection: { clipId: clip.id, clipIds: [clip.id] } }
    })
    return clip.id
  },

  addStickerClip(atTime, emoji) {
    const state = get()
    const track = state.doc.tracks.find((t) => t.kind === 'text')
    if (!track) return null
    const duration = 3
    const resolved = resolveDropStart(track, '', Math.max(0, atTime), duration)
    if (resolved === null) return null
    get().pushHistory()
    const clip = createClip({ kind: 'sticker', start: resolved, duration, sticker: createSticker(emoji) })
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks.find((t) => t.id === track.id)!
      target.clips.push(clip)
      target.clips.sort((a, b) => a.start - b.start)
      return { doc, selection: { clipId: clip.id, clipIds: [clip.id] } }
    })
    return clip.id
  },

  addSrtCaptions(cues) {
    if (cues.length === 0) return
    get().pushHistory()
    set((s) => {
      const doc = clone(s.doc)
      // Reuse the existing captions track when present, otherwise create one.
      let track = doc.tracks.find((t) => t.kind === 'text' && t.name === 'Phụ đề')
      if (!track) {
        track = createTrack('text', 'Phụ đề')
        const insertIndex = doc.tracks.findIndex((t) => t.kind !== 'text')
        doc.tracks.splice(Math.max(0, insertIndex), 0, track)
      }
      track.clips = cues.map((cue) =>
        createClip({
          kind: 'text',
          start: Math.max(0, cue.start),
          duration: Math.max(0.2, cue.end - cue.start),
          text: { ...createText(), content: cue.text, fontSize: 0.055, y: 0.88, backgroundColor: '#000000cc', bold: false }
        })
      )
      return { doc }
    })
  },

  collectTextCues() {
    const cues: Array<{ start: number; end: number; text: string }> = []
    for (const track of get().doc.tracks) {
      if (track.kind !== 'text') continue
      for (const clip of track.clips) {
        const content = clip.text?.content.trim()
        if (!content) continue
        cues.push({ start: clip.start, end: clip.start + clip.duration, text: content })
      }
    }
    return cues.sort((a, b) => a.start - b.start)
  },

  extractAudio(clipId) {    const found = get().findClip(clipId)
    if (!found || !found.clip.assetId) return false
    const asset = get().findAsset(found.clip.assetId)
    if (!asset || asset.kind !== 'video') return false
    const audioTrack = get().doc.tracks.find((t) => t.kind === 'audio' && !t.locked)
    if (!audioTrack) return false
    const { clip } = found
    const resolved = resolveDropStart(audioTrack, '', clip.start, clip.duration)
    if (resolved === null) return false
    get().pushHistory()
    const audioClip = createClip({
      kind: 'audio',
      assetId: clip.assetId,
      start: resolved,
      duration: clip.duration,
      inPoint: clip.inPoint,
      speed: clip.speed,
      speedCurve: clip.speedCurve ? clone(clip.speedCurve) : undefined,
      volume: clip.volume,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut
    })
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks.find((t) => t.id === audioTrack.id)!
      target.clips.push(audioClip)
      target.clips.sort((a, b) => a.start - b.start)
      return { doc, selection: { clipId: audioClip.id, clipIds: [audioClip.id] } }
    })
    return true
  },

  rippleDeleteClip(clipId) {
    const found = get().findClip(clipId)
    if (!found) return
    get().pushHistory()
    set((s) => {
      const doc = clone(s.doc)
      const track = doc.tracks.find((t) => t.id === found.track.id)!
      const removed = track.clips.find((c) => c.id === clipId)
      if (!removed) return {}
      track.clips = track.clips
        .filter((c) => c.id !== clipId)
        .map((c) => (c.start >= removed.start + removed.duration - 1e-6 ? { ...c, start: c.start - removed.duration } : c))
      return { doc, selection: { clipId: null, clipIds: [] } }
    })
  },

  copySelection() {
    const { selection } = get()
    const ids = selection.clipIds.length > 0 ? selection.clipIds : selection.clipId ? [selection.clipId] : []
    const clips = ids
      .map((id) => get().findClip(id)?.clip)
      .filter((c): c is Clip => !!c)
    if (clips.length > 0) set({ clipboard: clone(clips) })
  },

  pasteFromClipboard(atTime) {
    const { clipboard } = get()
    if (clipboard.length === 0) return
    get().pushHistory()
    const baseStart = Math.min(...clipboard.map((c) => c.start))
    const offset = Math.max(0, atTime) - baseStart
    const pasted: Array<{ clip: Clip; trackId: string }> = []
    for (const c of clipboard) {
      const originTrack = get().doc.tracks.find((tr) => tr.clips.some((old) => old.id === c.id))
      pasted.push({ clip: { ...clone(c), id: crypto.randomUUID(), start: Math.max(0, c.start + offset) }, trackId: originTrack?.id ?? '' })
    }
    if (pasted.length === 0) return
    set((s) => {
      const doc = clone(s.doc)
      for (const { clip, trackId } of pasted) {
        const target = doc.tracks.find((t) => t.id === trackId)
        if (!target || target.locked) continue
        const resolved = resolveDropStart(target, '', clip.start, clip.duration)
        clip.start = resolved ?? clip.start
        target.clips.push(clip)
        target.clips.sort((a, b) => a.start - b.start)
      }
      const first = pasted[0]?.clip
      return { doc, selection: first ? { clipId: first.id, clipIds: pasted.map((p) => p.clip.id) } : { clipId: null, clipIds: [] } }
    })
  },

  moveClip(clipId, toTrackId, desiredStart) {
    const found = get().findClip(clipId)
    if (!found) return false
    const { track } = found
    const target = get().doc.tracks.find((t) => t.id === toTrackId)
    if (!target || target.locked) return false
    if (track.kind !== target.kind) return false
    const resolved = resolveDropStart(target, clipId, Math.max(0, desiredStart), found.clip.duration)
    if (resolved === null) return false
    set((s) => {
      const doc = clone(s.doc)
      const source = doc.tracks.find((t) => t.id === track.id)!
      const index = source.clips.findIndex((c) => c.id === clipId)
      if (index < 0) return {}
      const [clip] = source.clips.splice(index, 1)
      clip.start = resolved
      const destination = doc.tracks.find((t) => t.id === toTrackId)!
      destination.clips.push(clip)
      destination.clips.sort((a, b) => a.start - b.start)
      return { doc, dirty: true }
    })
    return true
  },

  trimClip(clipId, edge, newTime) {
    const found = get().findClip(clipId)
    if (!found) return
    const { clip, track } = found
    const asset = clip.assetId ? get().findAsset(clip.assetId) : null
    const sourceDuration = asset && asset.kind !== 'image' ? asset.duration : 0
    let start = clip.start
    let duration = clip.duration
    let inPoint = clip.inPoint
    if (edge === 'left') {
      const delta = Math.min(Math.max(newTime, 0), clip.start + clip.duration - 0.05) - clip.start
      const minSource = -clip.inPoint / clip.speed
      const clampedDelta = Math.max(delta, minSource)
      start = clip.start + clampedDelta
      duration = clip.duration - clampedDelta
      inPoint = clip.inPoint + clampedDelta * clip.speed
    } else {
      let end = Math.max(newTime, clip.start + 0.05)
      if (sourceDuration > 0) {
        end = Math.min(end, clip.start + (sourceDuration - clip.inPoint) / clip.speed)
      }
      // cannot cross the next neighbor
      for (const other of track.clips) {
        if (other.id === clip.id) continue
        if (other.start >= clip.start + clip.duration - 1e-6 && other.start > clip.start) {
          end = Math.min(end, other.start)
        }
      }
      duration = end - clip.start
    }
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks.find((t) => t.id === track.id)!.clips.find((c) => c.id === clipId)!
      target.start = start
      target.duration = Math.max(0.05, duration)
      target.inPoint = inPoint
      return { doc, dirty: true }
    })
  },

  splitClipAt(clipId, time) {
    const found = get().findClip(clipId)
    if (!found) return
    const result = splitClip(found.clip, time)
    if (!result) return
    get().pushHistory()
    set((s) => {
      const doc = clone(s.doc)
      const track = doc.tracks.find((t) => t.id === found.track.id)!
      const index = track.clips.findIndex((c) => c.id === clipId)
      if (index < 0) return {}
      track.clips.splice(index, 1, result.left, result.right)
      return { doc, selection: { clipId: result.right.id, clipIds: [result.right.id] } }
    })
  },

  deleteClip(clipId) {
    const found = get().findClip(clipId)
    if (!found) return
    get().pushHistory()
    set((s) => {
      const doc = clone(s.doc)
      const track = doc.tracks.find((t) => t.id === found.track.id)!
      track.clips = track.clips.filter((c) => c.id !== clipId)
      return { doc, selection: { clipId: null, clipIds: [] } }
    })
  },

  duplicateClip(clipId) {
    const found = get().findClip(clipId)
    if (!found) return
    const { clip, track } = found
    const resolved = resolveDropStart(track, clipId, clip.start + clip.duration, clip.duration)
    if (resolved === null) return
    get().pushHistory()
    const copy: Clip = { ...clone(clip), id: crypto.randomUUID(), start: resolved }
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks.find((t) => t.id === track.id)!
      target.clips.push(copy)
      target.clips.sort((a, b) => a.start - b.start)
      return { doc, selection: { clipId: copy.id, clipIds: [copy.id] } }
    })
  },

  updateClip(clipId, patch) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      Object.assign(target, patch)
      return { doc, dirty: true }
    })
  },

  updateTransform(clipId, patch) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      target.transform = { ...target.transform, ...patch }
      return { doc, dirty: true }
    })
  },

  updateFilters(clipId, patch) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      target.filters = { ...target.filters, ...patch }
      return { doc, dirty: true }
    })
  },

  updateText(clipId, patch) {
    const found = get().findClip(clipId)
    if (!found || !found.clip.text) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      target.text = { ...target.text!, ...patch }
      return { doc, dirty: true }
    })
  },

  setTransition(clipId, transition) {
    const found = get().findClip(clipId)
    if (!found) return
    get().pushHistory()
    get().updateClip(clipId, { transitionIn: transition })
  },

  addEffectToClip(clipId, effect) {
    const found = get().findClip(clipId)
    if (!found) return
    get().pushHistory()
    const clipped: Omit<ClipEffect, 'id'> = {
      ...effect,
      start: Math.max(0, Math.min(effect.start, found.clip.duration - 0.1)),
      duration: Math.max(0.1, Math.min(effect.duration, found.clip.duration - Math.max(0, effect.start)))
    }
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      target.effects = [
        ...(target.effects ?? []).filter((e) => !(e.kind === effect.kind && Math.abs(e.start - clipped.start) < 0.05)),
        { ...clipped, id: crypto.randomUUID() }
      ].sort((a, b) => a.start - b.start)
      return { doc, dirty: true }
    })
  },

  updateEffect(clipId, effectId, patch) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      const list = target.effects ?? []
      const index = list.findIndex((e) => e.id === effectId)
      if (index < 0) return {}
      const eff = { ...list[index] }
      if (patch.start !== undefined) eff.start = patch.start
      if (patch.duration !== undefined) eff.duration = patch.duration
      eff.duration = Math.max(0.1, eff.duration)
      eff.start = Math.max(0, Math.min(eff.start, Math.max(0, target.duration - 0.1)))
      eff.duration = Math.min(eff.duration, Math.max(0.1, target.duration - eff.start))
      const next = [...list]
      next[index] = eff
      target.effects = next
      return { doc, dirty: true }
    })
  },

  removeEffectFromClip(clipId, effectId) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      target.effects = (target.effects ?? []).filter((e) => e.id !== effectId)
      return { doc, dirty: true }
    })
  },

  addKeyframe(clipId, keyframe) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      target.keyframes = [
        ...target.keyframes.filter((k) => Math.abs(k.time - keyframe.time) > 0.001),
        { ...keyframe, id: crypto.randomUUID() }
      ].sort((a, b) => a.time - b.time)
      return { doc, dirty: true }
    })
  },

  updateKeyframe(clipId, keyframeId, patch) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      const index = target.keyframes.findIndex((k) => k.id === keyframeId)
      if (index < 0) return {}
      const next = [...target.keyframes]
      next[index] = { ...next[index], ...patch }
      target.keyframes = next.sort((a, b) => a.time - b.time)
      return { doc, dirty: true }
    })
  },

  removeKeyframe(clipId, keyframeId) {
    const found = get().findClip(clipId)
    if (!found) return
    set((s) => {
      const doc = clone(s.doc)
      const target = doc.tracks
        .find((t) => t.id === found.track.id)!
        .clips.find((c) => c.id === clipId)!
      target.keyframes = target.keyframes.filter((k) => k.id !== keyframeId)
      return { doc, dirty: true }
    })
  },

  groupIntoCompound(clipIds) {
    const ids = clipIds.filter((id) => id)
    if (ids.length === 0) return null
    const picked = ids.map((id) => get().findClip(id)).filter((f): f is NonNullable<typeof f> => !!f)
    if (picked.length === 0) return null
    if (picked.some((f) => f.clip.compound)) return null // no nested compounds
    const minStart = Math.min(...picked.map((f) => f.clip.start))
    const maxEnd = Math.max(...picked.map((f) => f.clip.start + f.clip.duration))
    if (maxEnd - minStart < 0.2) return null

    const innerVideo: Clip[] = []
    const innerText: Clip[] = []
    const innerAudio: Clip[] = []
    for (const { clip } of picked) {
      const inner: Clip = { ...clone(clip), start: clip.start - minStart }
      if (clip.kind === 'text' || clip.kind === 'sticker') innerText.push(inner)
      else if (clip.kind === 'audio') innerAudio.push(inner)
      else innerVideo.push(inner)
    }
    const tracks: Track[] = []
    if (innerVideo.length > 0) {
      innerVideo.sort((a, b) => a.start - b.start)
      tracks.push({ ...createTrack('video', 'Media'), clips: innerVideo })
    }
    if (innerText.length > 0) {
      innerText.sort((a, b) => a.start - b.start)
      tracks.push({ ...createTrack('text', 'Chữ'), clips: innerText })
    }
    if (innerAudio.length > 0) {
      innerAudio.sort((a, b) => a.start - b.start)
      tracks.push({ ...createTrack('audio', 'Âm thanh'), clips: innerAudio })
    }
    if (tracks.length === 0) return null

    const hostTrack = picked[0].track
    const removedIds = new Set(ids)
    get().pushHistory()
    const compoundClip = createClip({
      kind: 'video',
      start: minStart,
      duration: maxEnd - minStart,
      compound: { duration: maxEnd - minStart, tracks }
    })
    set((s) => {
      const doc = clone(s.doc)
      for (const track of doc.tracks) {
        track.clips = track.clips.filter((c) => !removedIds.has(c.id))
      }
      const target =
        doc.tracks.find((t) => t.id === hostTrack.id && !t.locked) ??
        doc.tracks.find((t) => t.kind === 'video' && !t.locked)
      if (!target) return {}
      target.clips.push(compoundClip)
      target.clips.sort((a, b) => a.start - b.start)
      return { doc, selection: { clipId: compoundClip.id, clipIds: [compoundClip.id] } }
    })
    return compoundClip.id
  },

  ungroupCompound(clipId) {
    const found = get().findClip(clipId)
    if (!found || !found.clip.compound) return false
    const compound = found.clip.compound
    const base = found.clip.start
    get().pushHistory()
    set((s) => {
      const doc = clone(s.doc)
      // Remove the compound clip itself.
      for (const track of doc.tracks) {
        track.clips = track.clips.filter((c) => c.id !== clipId)
      }
      // Visual inner clips land on a fresh top video track; audio inners on
      // a new bottom audio track — CapCut-style "tách các nhóm".
      const visualClips: Clip[] = []
      const audioClips: Clip[] = []
      for (const innerTrack of compound.tracks) {
        for (const inner of innerTrack.clips) {
          const outer: Clip = { ...inner, start: base + inner.start }
          if (inner.kind === 'audio') audioClips.push(outer)
          else visualClips.push(outer)
        }
      }
      if (visualClips.length > 0) {
        visualClips.sort((a, b) => a.start - b.start)
        const track = createTrack('video', `Video ${doc.tracks.filter((t) => t.kind === 'video').length + 1}`)
        track.clips = visualClips
        const insertIndex = doc.tracks.findIndex((t) => t.kind !== 'text')
        doc.tracks.splice(Math.max(0, insertIndex), 0, track)
      }
      if (audioClips.length > 0) {
        audioClips.sort((a, b) => a.start - b.start)
        const track = createTrack('audio', `Âm thanh ${doc.tracks.filter((t) => t.kind === 'audio').length + 1}`)
        track.clips = audioClips
        doc.tracks.push(track)
      }
      return {
        doc,
        selection: audioClips.length === 0 && visualClips.length > 0
          ? { clipId: visualClips[0].id, clipIds: visualClips.map((c) => c.id) }
          : { clipId: null, clipIds: [] }
      }
    })
    return true
  },

  patchAsset(assetId, patch) {
    set((s) => ({
      doc: {
        ...s.doc,
        mediaLibrary: s.doc.mediaLibrary.map((a) => (a.id === assetId ? { ...a, ...patch } : a))
      },
      dirty: true
    }))
  },

  addBeatMarkers(assetId) {
    const asset = get().findAsset(assetId)
    if (!asset?.beats || asset.beats.length === 0) return 0
    const existing = get().doc.markers.map((m) => Math.round(m.time * 100) / 100)
    const positions: number[] = []
    for (const track of get().doc.tracks) {
      if (track.kind === 'text') continue
      for (const clip of track.clips) {
        if (clip.assetId !== assetId) continue
        for (const beat of asset.beats) {
          const source = clip.inPoint + beat
          if (source > clip.inPoint + clipSourceSpan(clip) + 0.001) continue
          const t = Math.round(clipTimelineTimeForSource(clip, source) * 100) / 100
          if (!existing.includes(t) && !positions.includes(t)) positions.push(t)
        }
      }
    }
    if (positions.length === 0) return 0
    positions.sort((a, b) => a - b)
    get().pushHistory()
    set((s) => ({
      doc: {
        ...s.doc,
        markers: [
          ...s.doc.markers,
          ...positions.map((t, i) => ({
            id: crypto.randomUUID(),
            time: t,
            label: `Beat ${i + 1}`,
            color: '#22c55e'
          }))
        ].sort((a, b) => a.time - b.time),
        modifiedAt: Date.now()
      },
      dirty: true
    }))
    return positions.length
  },

  removeAllBeatMarkers() {
    const count = get().doc.markers.filter((m) => m.label.startsWith('Beat')).length
    if (count === 0) return
    get().pushHistory()
    set((s) => ({
      doc: {
        ...s.doc,
        markers: s.doc.markers.filter((m) => !m.label.startsWith('Beat')),
        modifiedAt: Date.now()
      },
      dirty: true
    }))
  },

  async ensureProxies() {
    const heavy = get().doc.mediaLibrary.filter(
      (a) => needsProxy(a) && !a.proxyPath && !proxyGeneration.has(a.id)
    )
    for (const asset of heavy) {
      if (proxyGeneration.has(asset.id)) continue
      proxyGeneration.add(asset.id)
      try {
        const proxyPath = await ensureProxy(asset)
        if (proxyPath) {
          get().patchAsset(asset.id, { proxyPath })
        }
      } catch {
        /* best-effort */
      } finally {
        proxyGeneration.delete(asset.id)
      }
    }
  },

  async reverseClip(clipId) {
    const found = get().findClip(clipId)
    if (!found || !found.clip.assetId) return false
    const asset = get().findAsset(found.clip.assetId)
    if (!asset || asset.kind !== 'video') return false
    if (reverseBusy) return false
    reverseBusy = true
    try {
      const reversed = await buildReversedMediaAsset(asset)
      if (!reversed) return false
      get().pushHistory()
      set((s) => {
        const doc = clone(s.doc)
        doc.mediaLibrary = [...doc.mediaLibrary, reversed]
        const target = doc.tracks
          .find((t) => t.id === found.track.id)!
          .clips.find((c) => c.id === clipId)!
        target.assetId = reversed.id
        target.inPoint = 0
        return { doc, dirty: true }
      })
      return true
    } catch {
      return false
    } finally {
      reverseBusy = false
    }
  },

  addMarker(time, label) {
    get().pushHistory()
    const marker: Marker = {
      id: crypto.randomUUID(),
      time: Math.max(0, time),
      label: label ?? `Mốc ${get().doc.markers.length + 1}`,
      color: '#4f7cff'
    }
    set((s) => ({ doc: { ...s.doc, markers: [...s.doc.markers, marker].sort((a, b) => a.time - b.time), modifiedAt: Date.now() }, dirty: true }))
  },

  updateMarker(markerId, patch) {
    set((s) => ({
      doc: {
        ...s.doc,
        markers: s.doc.markers
          .map((m) => (m.id === markerId ? { ...m, ...patch } : m))
          .sort((a, b) => a.time - b.time),
        modifiedAt: Date.now()
      },
      dirty: true
    }))
  },

  removeMarker(markerId) {
    get().pushHistory()
    set((s) => ({
      doc: { ...s.doc, markers: s.doc.markers.filter((m) => m.id !== markerId), modifiedAt: Date.now() }
    }))
  },

  addTrack(kind) {
    get().pushHistory()
    set((s) => {
      const doc = clone(s.doc)
      const count = doc.tracks.filter((t) => t.kind === kind).length + 1
      const name = kind === 'text' ? `Chữ ${count}` : kind === 'video' ? `Video ${count}` : `Âm thanh ${count}`
      const track = createTrack(kind, name)
      if (kind === 'video') {
        const insertIndex = doc.tracks.findIndex((t) => t.kind !== 'text')
        doc.tracks.splice(Math.max(0, insertIndex), 0, track)
      } else {
        doc.tracks.push(track)
      }
      return { doc }
    })
  },

  removeTrack(trackId) {
    const doc0 = get().doc
    if (doc0.tracks.length <= 1) return
    get().pushHistory()
    set((s) => {
      const doc = clone(s.doc)
      doc.tracks = doc.tracks.filter((t) => t.id !== trackId)
      return { doc, selection: { clipId: null, clipIds: [] } }
    })
  },

  updateTrack(trackId, patch) {
    set((s) => {
      const doc = clone(s.doc)
      const track = doc.tracks.find((t) => t.id === trackId)
      if (!track) return {}
      Object.assign(track, patch)
      return { doc, dirty: true }
    })
  }
}))

export function timelineDuration(doc: ProjectDocument): number {
  return Math.max(totalDuration(doc), 5)
}

/** Replace the working document with a fresh empty one. */
export function resetToNewDocument(): void {
  useProjectStore.getState().resetToNewDocument()
}
