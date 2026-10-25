import { useEffect, useRef } from 'react'
import {
  ChevronFirst,
  ChevronLast,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward
} from 'lucide-react'
import type { PlaybackEngine } from '../../core/playback'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'
import { documentDuration } from '../../core/playback'
import { formatTime } from '../../lib/format'
import { IconButton } from '../ui/controls'

export default function PreviewArea({ engine }: { engine: PlaybackEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playing = useEditorStore((s) => s.playing)
  const playhead = useEditorStore((s) => s.playhead)
  const loop = useEditorStore((s) => s.loop)
  const doc = useProjectStore((s) => s.doc)
  const duration = documentDuration(doc)

  useEffect(() => {
    if (canvasRef.current) engine.attach(canvasRef.current)
    return () => engine.detach()
  }, [engine])

  const toggle = () => {
    const editor = useEditorStore.getState()
    if (editor.playing) {
      engine.pause()
      editor.setPlaying(false)
    } else {
      engine.play()
      editor.setPlaying(true)
    }
  }

  const ratio = doc.settings.width / doc.settings.height

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-ink-950">
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
          style={{ aspectRatio: String(ratio) }}
          onClick={toggle}
        />
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-ink-700/60 bg-ink-900 px-4 py-2">
        <div className="flex items-center gap-1">
          <IconButton title="Về đầu" onClick={() => engine.seek(0)}>
            <ChevronFirst size={17} />
          </IconButton>
          <IconButton
            title="Lùi 1 khung hình"
            onClick={() => {
              engine.pause()
              useEditorStore.getState().setPlaying(false)
              engine.seek(playhead - 1 / doc.settings.fps)
            }}
          >
            <SkipBack size={15} />
          </IconButton>
          <button
            onClick={toggle}
            title="Phát/Dừng (Space)"
            className="mx-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-soft"
          >
            {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
          </button>
          <IconButton
            title="Tới 1 khung hình"
            onClick={() => {
              engine.pause()
              useEditorStore.getState().setPlaying(false)
              engine.seek(playhead + 1 / doc.settings.fps)
            }}
          >
            <SkipForward size={15} />
          </IconButton>
          <IconButton title="Tới cuối" onClick={() => engine.seek(duration)}>
            <ChevronLast size={17} />
          </IconButton>
          <IconButton
            title="Lặp lại"
            active={loop}
            onClick={() => {
              useEditorStore.getState().toggleLoop()
              engine.setLoop(!loop)
            }}
          >
            <Repeat size={15} />
          </IconButton>
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums text-ink-300">
          <span className="text-white">{formatTime(playhead)}</span>
          <span className="text-ink-600">/</span>
          <span>{formatTime(duration)}</span>
          <span className="ml-3 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-400">
            {doc.settings.width}×{doc.settings.height} · {doc.settings.fps}fps
          </span>
        </div>
      </div>
    </div>
  )
}
