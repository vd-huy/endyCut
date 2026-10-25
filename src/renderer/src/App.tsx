import { useEffect, useRef } from 'react'
import { useEditorStore } from './store/editorStore'
import { useProjectStore } from './store/projectStore'
import { PlaybackEngine } from './core/playback'
import { setEngineInstance } from './core/playbackInstance'
import TopBar from './components/layout/TopBar'
import LeftPanel from './components/layout/LeftPanel'
import PreviewArea from './components/preview/PreviewArea'
import Inspector from './components/inspector/Inspector'
import TimelineArea from './components/timeline/TimelineArea'
import ExportModal from './components/ExportModal'
import { importAssets } from './core/media/assets'

export default function App() {
  const doc = useProjectStore((s) => s.doc)
  const importNotice = useEditorStore((s) => s.importNotice)
  const setImportNotice = useEditorStore((s) => s.setImportNotice)
  const engineHolder = useRef<PlaybackEngine | null>(null)

  if (!engineHolder.current) {
    engineHolder.current = new PlaybackEngine(doc, (t) => {
      useEditorStore.getState().setPlayhead(t)
    })
    setEngineInstance(engineHolder.current)
  }
  const engine = engineHolder.current

  engine.setPlayheadGetter(() => useEditorStore.getState().playhead)

  // Push document updates into the engine and repaint while paused.
  useEffect(() => {
    engine.setDoc(doc)
    engine.setLoop(useEditorStore.getState().loop)
    engine.seek(useEditorStore.getState().playhead, true)
  }, [doc, engine])

  useEffect(() => {
    engine.onEndedCallback(() => useEditorStore.getState().setPlaying(false))
    return () => engine.onEndedCallback(null)
  }, [engine])

  // Keep playing state in sync when the engine stops on its own.
  useEffect(() => {
    const id = setInterval(() => {
      const { playing } = useEditorStore.getState()
      if (playing && !engine.isPlaying()) useEditorStore.getState().setPlaying(false)
    }, 250)
    return () => clearInterval(id)
  }, [engine])

  // Auto-save the document (debounced).
  useEffect(() => {
    const id = setTimeout(() => {
      window.api.autosave(JSON.stringify(doc)).catch(() => {})
    }, 1500)
    return () => clearTimeout(id)
  }, [doc])

  // Restore autosaved draft on first launch.
  useEffect(() => {
    window.api.readAutosave().then((json: string | null) => {
      if (!json) return
      try {
        const parsed = JSON.parse(json)
        if (parsed?.tracks?.some((t: { clips: unknown[] }) => t.clips.length > 0)) {
          const restore = window.confirm('Phát hiện dự án nháp đã lưu tự động. Khôi phục dự án đó?')
          if (restore) useProjectStore.getState().loadDocument(parsed)
        }
      } catch {
        /* corrupt autosave — ignore */
      }
    })
  }, [])

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const editor = useEditorStore.getState()
      const project = useProjectStore.getState()
      const fps = project.doc.settings.fps
      if (e.code === 'Space') {
        e.preventDefault()
        if (editor.playing) {
          engine.pause()
          editor.setPlaying(false)
        } else {
          engine.play()
          editor.setPlaying(true)
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (project.selection.clipId) {
          project.deleteClip(project.selection.clipId)
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) project.redo()
        else project.undo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        project.redo()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        splitAtPlayhead()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveProject()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        project.copySelection()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        project.pasteFromClipboard(editor.playhead)
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        if (project.selection.clipId) project.duplicateClip(project.selection.clipId)
      } else if (e.key.toLowerCase() === 'm') {
        project.addMarker(editor.playhead)
      } else if (e.key === 'ArrowLeft') {
        engine.pause()
        editor.setPlaying(false)
        engine.seek(Math.max(0, editor.playhead - (e.shiftKey ? 1 : 1 / fps)))
      } else if (e.key === 'ArrowRight') {
        engine.pause()
        editor.setPlaying(false)
        engine.seek(editor.playhead + (e.shiftKey ? 1 : 1 / fps))
      } else if (e.key === 'Home') {
        engine.seek(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [engine])

  // Global drag-drop import.
  useEffect(() => {
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length === 0) return
      const paths = files
        .map((f) => window.api.pathForFile(f))
        .filter((p): p is string => !!p)
      if (paths.length === 0) return
      setImportNotice(`Đang nhập ${paths.length} tệp…`)
      await importAssets(
        paths,
        (asset) => useProjectStore.getState().addAssetsToLibrary([asset]),
        (path, err) => console.warn('Import lỗi', path, err)
      )
      setImportNotice(null)
    }
    const onDragOver = (e: DragEvent) => e.preventDefault()
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragover', onDragOver)
    return () => {
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragover', onDragOver)
    }
  }, [setImportNotice])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftPanel />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <PreviewArea engine={engine} />
            <Inspector />
          </div>
          <TimelineArea />
        </div>
      </div>
      <ExportModal />
      {importNotice && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink-800 px-4 py-2 text-sm text-white shadow-xl">
          {importNotice}
        </div>
      )}
    </div>
  )
}

export function splitAtPlayhead() {
  const project = useProjectStore.getState()
  const editor = useEditorStore.getState()
  const t = editor.playhead
  const selected = project.selection.clipId
  if (selected) {
    const found = project.findClip(selected)
    if (found && t > found.clip.start && t < found.clip.start + found.clip.duration) {
      project.splitClipAt(selected, t)
      return
    }
  }
  // Split every clip crossing the playhead.
  for (const track of project.doc.tracks) {
    for (const clip of track.clips) {
      if (t > clip.start && t < clip.start + clip.duration) {
        project.splitClipAt(clip.id, t)
      }
    }
  }
}

export async function saveProject() {
  const project = useProjectStore.getState()
  let path = project.filePath
  if (!path) {
    path = await window.api.pickProjectSavePath()
    if (!path) return
  }
  const saved = await window.api.saveProject(path, JSON.stringify(project.doc, null, 2))
  project.markSaved(saved)
  void window.api.addRecentProject(saved, project.doc.settings.name)
}

export async function openProject(): Promise<boolean> {
  const path = await window.api.pickProjectOpenPath()
  if (!path) return false
  try {
    const json = await window.api.readProjectFile(path)
    const parsed = JSON.parse(json)
    if (!parsed?.tracks || !parsed?.settings) throw new Error('Định dạng không hợp lệ')
    useProjectStore.getState().loadDocument(parsed)
    useProjectStore.getState().markSaved(path)
    useEditorStore.getState().setPlayhead(0)
    void window.api.addRecentProject(path, String(parsed.settings?.name ?? path))
    return true
  } catch (error) {
    window.alert(`Không mở được dự án: ${String(error)}`)
    return false
  }
}
