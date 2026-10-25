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

  setPlaying(playing: boolean): void
  togglePlay(): void
  setPlayhead(time: number): void
  setZoom(pxPerSecond: number): void
  toggleSnapping(): void
  setLeftTab(tab: LeftTab): void
  toggleLoop(): void
  setExportState(patch: Partial<ExportState>): void
  setImportNotice(notice: string | null): void
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
  setImportNotice: (importNotice) => set({ importNotice })
}))
