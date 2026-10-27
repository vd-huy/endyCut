import { create } from 'zustand'

export type LeftTab = 'media' | 'template' | 'video-effects' | 'text' | 'stickers' | 'effects' | 'transitions'

export interface ExportState {
  open: boolean
  running: boolean
  progress: number // 0..1
  stage: string
  outputPath: string | null
  error: string | null
}

interface EditorState {
  playing: boolean
  /** Timeline playhead in seconds. Updated at frame rate during playback. */
  playhead: number
  pxPerSecond: number
  snapping: boolean
  leftTab: LeftTab
  loop: boolean
  exportState: ExportState
  importNotice: string | null
  /** Floating keyframe graph panel (CapCut curve editor). */
  keyframePanel: { open: boolean; clipId: string | null }
  /** Keyboard shortcut reference / editor modal. */
  keymapOpen: boolean

  setPlaying(playing: boolean): void
  togglePlay(): void
  setPlayhead(time: number): void
  setZoom(pxPerSecond: number): void
  toggleSnapping(): void
  setLeftTab(tab: LeftTab): void
  toggleLoop(): void
  setExportState(patch: Partial<ExportState>): void
  setImportNotice(notice: string | null): void
  /** Toggle the graph panel for a clip; null closes it. */
  toggleKeyframePanel(clipId: string | null): void
  closeKeyframePanel(): void
  setKeymapOpen(open: boolean): void
}

export const useEditorStore = create<EditorState>((set, get) => ({
  playing: false,
  playhead: 0,
  pxPerSecond: 60,
  snapping: true,
  leftTab: 'media',
  loop: false,
  exportState: {
    open: false,
    running: false,
    progress: 0,
    stage: '',
    outputPath: null,
    error: null
  },
  importNotice: null,
  keyframePanel: { open: false, clipId: null },
  keymapOpen: false,

  setPlaying: (playing) => set({ playing }),
  togglePlay: () => set({ playing: !get().playing }),
  setPlayhead: (playhead) => set({ playhead: Math.max(0, playhead) }),
  setZoom: (pxPerSecond) =>
    set({ pxPerSecond: Math.min(600, Math.max(4, pxPerSecond)) }),
  toggleSnapping: () => set({ snapping: !get().snapping }),
  setLeftTab: (leftTab) => set({ leftTab }),
  toggleLoop: () => set({ loop: !get().loop }),
  setExportState: (patch) =>
    set((s) => ({ exportState: { ...s.exportState, ...patch } })),
  setImportNotice: (importNotice) => set({ importNotice }),
  toggleKeyframePanel: (clipId) =>
    set((s) => ({
      keyframePanel:
        s.keyframePanel.open && s.keyframePanel.clipId === clipId
          ? { open: false, clipId: null }
          : { open: true, clipId }
    })),
  closeKeyframePanel: () => set({ keyframePanel: { open: false, clipId: null } }),
  setKeymapOpen: (keymapOpen) => set({ keymapOpen })
}))
