import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Eye,
  EyeOff,
  Flag,
  Lock,
  LockOpen,
  Magnet,
  Scissors,
  Trash2,
  Volume2,
  VolumeX,
  ZoomIn,
  Plus
} from 'lucide-react'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'
import type { Clip, ClipEffect, Track } from '@shared/document'
import { collectSnapCandidates, snapTime } from '@shared/timelineMath'
import { formatTime } from '../../lib/format'
import { IconButton } from '../ui/controls'
import { splitAtPlayhead } from '../../App'

const TRACK_HEIGHT: Record<Track['kind'], number> = { text: 40, video: 56, audio: 48 }
const HEADER_WIDTH = 148

interface DragState {
  kind: 'move' | 'trim-left' | 'trim-right' | 'effect-move' | 'effect-left' | 'effect-right'
  clipId: string
  trackId: string
  originStart: number
  originX: number
  duration: number
  effectId?: string
  effectStart?: number
  effectDuration?: number
}

export default function TimelineArea() {
  const doc = useProjectStore((s) => s.doc)
  const selection = useProjectStore((s) => s.selection)
  const selectClip = useProjectStore((s) => s.selectClip)
  const setSelection = useProjectStore((s) => s.setSelection)
  const pxPerSecond = useEditorStore((s) => s.pxPerSecond)
  const setZoom = useEditorStore((s) => s.setZoom)
  const snapping = useEditorStore((s) => s.snapping)
  const toggleSnapping = useEditorStore((s) => s.toggleSnapping)
  const playhead = useEditorStore((s) => s.playhead)
  const setPlayhead = useEditorStore((s) => s.setPlayhead)
  const setPlaying = useEditorStore((s) => s.setPlaying)

  const scrollRef = useRef<HTMLDivElement>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; clipId: string } | null>(null)

  const duration = Math.max(
    10,
    doc.tracks.reduce((acc, t) => Math.max(acc, ...t.clips.map((c) => c.start + c.duration)), 0) + 8
  )
  const contentWidth = duration * pxPerSecond

  const timeAtPointer = useCallback(
    (clientX: number): number => {
      const lanes = lanesRef.current
      if (!lanes) return 0
      const rect = lanes.getBoundingClientRect()
      return Math.max(0, (clientX - rect.left) / pxPerSecond)
    },
    [pxPerSecond]
  )

  const seek = useCallback(
    (t: number) => {
      setPlaying(false)
      setPlayhead(t)
    },
    [setPlayhead, setPlaying]
  )

  // Ruler drag-to-seek.
  const rulerPointer = useRef(false)
  const onRulerDown = (e: React.PointerEvent) => {
    rulerPointer.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    seek(timeAtPointer(e.clientX))
  }
  const onRulerMove = (e: React.PointerEvent) => {
    if (rulerPointer.current) seek(timeAtPointer(e.clientX))
  }
  const onRulerUp = () => {
    rulerPointer.current = false
  }

  // Clip dragging / trimming.
  const beginDrag = (e: React.PointerEvent, clip: Clip, track: Track, kind: DragState['kind']) => {
    if (track.locked) return
    e.stopPropagation()
    if (e.shiftKey) {
      // Multi-select: add/remove the clip without starting a drag.
      const current = useProjectStore.getState().selection.clipIds
      setSelection(current.includes(clip.id) ? current.filter((id) => id !== clip.id) : [...current, clip.id])
      return
    }
    selectClip(clip.id)
    useProjectStore.getState().pushHistory()
    dragRef.current = {
      kind,
      clipId: clip.id,
      trackId: track.id,
      originStart: clip.start,
      originX: e.clientX,
      duration: clip.duration
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const beginEffectDrag = (
    e: React.PointerEvent,
    clip: Clip,
    track: Track,
    kind: 'effect-move' | 'effect-left' | 'effect-right',
    eff: ClipEffect
  ) => {
    if (track.locked) return
    e.stopPropagation()
    e.preventDefault()
    selectClip(clip.id)
    useProjectStore.getState().pushHistory()
    dragRef.current = {
      kind,
      clipId: clip.id,
      trackId: track.id,
      originStart: clip.start,
      originX: e.clientX,
      duration: clip.duration,
      effectId: eff.id,
      effectStart: eff.start,
      effectDuration: eff.duration
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const project = useProjectStore.getState()
    const dxSeconds = (e.clientX - drag.originX) / pxPerSecond
    const thresholdSeconds = 8 / pxPerSecond

    if (drag.kind === 'move') {
      let desired = Math.max(0, drag.originStart + dxSeconds)
      setSnapLine(null)
      if (snapping) {
        const candidates = collectSnapCandidates(doc.tracks, playhead, drag.clipId)
        const snapStart = snapTime(desired, candidates, thresholdSeconds)
        const snapEnd = snapTime(desired + drag.duration, candidates, thresholdSeconds)
        if (snapStart && (!snapEnd || snapStart.time === desired)) {
          desired = snapStart.time
          setSnapLine(snapStart.time)
        } else if (snapEnd) {
          desired = Math.max(0, snapEnd.time - drag.duration)
          setSnapLine(snapEnd.time)
        }
      }
      // Vertical move: hover another compatible lane.
      const lanes = lanesRef.current
      let targetTrackId = drag.trackId
      if (lanes) {
        const rect = lanes.getBoundingClientRect()
        const y = e.clientY - rect.top
        let acc = 0
        for (const track of doc.tracks) {
          const h = TRACK_HEIGHT[track.kind]
          if (y >= acc && y < acc + h) {
            targetTrackId = track.id
            break
          }
          acc += h
        }
      }
      project.moveClip(drag.clipId, targetTrackId, desired)
    } else if (drag.kind === 'effect-move') {
      const found = project.findClip(drag.clipId)
      if (!found || drag.effectId === undefined) return
      const max = Math.max(0, found.clip.duration - (drag.effectDuration ?? 0))
      const next = Math.min(max, Math.max(0, (drag.effectStart ?? 0) + dxSeconds))
      project.updateEffect(drag.clipId, drag.effectId, { start: next })
    } else if (drag.kind === 'effect-left') {
      if (drag.effectId === undefined) return
      const next = Math.max(0, (drag.effectStart ?? 0) + dxSeconds)
      project.updateEffect(drag.clipId, drag.effectId, {
        start: next,
        duration: (drag.effectDuration ?? 0) - (next - (drag.effectStart ?? 0))
      })
    } else if (drag.kind === 'effect-right') {
      if (drag.effectId === undefined) return
      const end = (drag.effectStart ?? 0) + (drag.effectDuration ?? 0) + dxSeconds
      project.updateEffect(drag.clipId, drag.effectId, { duration: end - (drag.effectStart ?? 0) })
    } else if (drag.kind === 'trim-left') {
      let t = drag.originStart + dxSeconds
      if (snapping) {
        const candidates = collectSnapCandidates(doc.tracks, playhead, drag.clipId)
        const snapped = snapTime(t, candidates, thresholdSeconds)
        if (snapped) {
          t = snapped.time
          setSnapLine(t)
        } else setSnapLine(null)
      } else setSnapLine(null)
      project.trimClip(drag.clipId, 'left', t)
    } else {
      let t = drag.originStart + drag.duration + dxSeconds
      if (snapping) {
        const candidates = collectSnapCandidates(doc.tracks, playhead, drag.clipId)
        const snapped = snapTime(t, candidates, thresholdSeconds)
        if (snapped) {
          t = snapped.time
          setSnapLine(t)
        } else setSnapLine(null)
      } else setSnapLine(null)
      project.trimClip(drag.clipId, 'right', t)
    }
  }

  const endDrag = () => {
    dragRef.current = null
    setSnapLine(null)
  }

  // Ctrl+wheel zoom around the cursor.
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    const lanes = lanesRef.current
    if (!lanes) return
    const rect = lanes.getBoundingClientRect()
    const timeAtCursor = (e.clientX - rect.left) / pxPerSecond
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    const next = pxPerSecond * factor
    setZoom(next)
    requestAnimationFrame(() => {
      const el = scrollRef.current
      if (el) el.scrollLeft = timeAtCursor * next - (e.clientX - rect.left) - HEADER_WIDTH
    })
  }

  // Drop from media library.
  const onLaneDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault()
    const assetId = e.dataTransfer.getData('application/x-cc-asset')
    if (!assetId) return
    const t = timeAtPointer(e.clientX)
    useProjectStore.getState().addAssetToTrack(assetId, track.id, t)
  }

  // Space at empty lane = seek.
  const onLaneDown = (e: React.PointerEvent, track: Track) => {
    if (e.target !== e.currentTarget) return
    if ((e.target as HTMLElement).dataset.lane !== 'true') return
    seek(timeAtPointer(e.clientX))
    selectClip(null)
    void track
  }

  useEffect(() => {
    const close = () => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])

  const selectedClipId = selection.clipId
  const selectedIds = selection.clipIds

  const addMarkerAtPlayhead = () => {
    useProjectStore.getState().addMarker(useEditorStore.getState().playhead)
  }

  return (
    <section className="flex h-64 shrink-0 flex-col border-t border-ink-700/60 bg-ink-900">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-ink-700/60 px-2">
        <IconButton title="Tách tại playhead (Ctrl+B)" onClick={() => splitAtPlayhead()}>
          <Scissors size={14} />
        </IconButton>
        <IconButton
          title="Xóa clip đã chọn (Del)"
          disabled={!selectedClipId}
          onClick={() => selectedClipId && useProjectStore.getState().deleteClip(selectedClipId)}
        >
          <Trash2 size={14} />
        </IconButton>
        <IconButton title="Bắt điểm (snap)" active={snapping} onClick={toggleSnapping}>
          <Magnet size={14} />
        </IconButton>
        <IconButton title="Thêm mốc đánh dấu tại playhead (M)" onClick={addMarkerAtPlayhead}>
          <Flag size={14} />
        </IconButton>
        <div className="mx-1 h-5 w-px bg-ink-700" />
        <IconButton title="Thêm track video" onClick={() => useProjectStore.getState().addTrack('video')}>
          <Plus size={14} />
        </IconButton>
        <span className="text-[11px] text-ink-400">Video</span>
        <button
          onClick={() => useProjectStore.getState().addTrack('audio')}
          className="ml-2 rounded bg-ink-800 px-2 py-0.5 text-[11px] text-ink-300 hover:bg-ink-700"
        >
          + Âm thanh
        </button>
        <div className="flex-1" />
        <ZoomOutButton />
        <span className="text-[10px] text-ink-400">{Math.round(pxPerSecond)}px/s</span>
        <ZoomInButton />
      </div>

      {/* Scrollable timeline */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto" onWheel={onWheel}>
        <div className="relative flex" style={{ width: contentWidth + HEADER_WIDTH }}>
          {/* Headers column */}
          <div className="sticky left-0 z-20 shrink-0 bg-ink-900" style={{ width: HEADER_WIDTH }}>
            <div className="h-7 border-b border-r border-ink-700/60 bg-ink-850" />
            {doc.tracks.map((track) => (
              <TrackHeader key={track.id} track={track} />
            ))}
          </div>

          {/* Ruler + lanes */}
          <div className="relative">
            {/* Ruler */}
            <div
              className="relative h-7 cursor-ew-resize border-b border-ink-700/60 bg-ink-850"
              style={{ width: contentWidth }}
              onPointerDown={onRulerDown}
              onPointerMove={onRulerMove}
              onPointerUp={onRulerUp}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, clipId: '' })
              }}
            >
              <RulerTicks pxPerSecond={pxPerSecond} width={contentWidth} />
              {/* Markers (CapCut-style flags) */}
              {doc.markers.map((m) => (
                <button
                  key={m.id}
                  title={`${m.label} — ${formatTime(m.time)} (nhấp phải để xóa)`}
                  className="absolute bottom-0 z-10 flex flex-col items-center"
                  style={{ left: m.time * pxPerSecond }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    seek(m.time)
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    useProjectStore.getState().removeMarker(m.id)
                  }}
                >
                  <Flag size={10} style={{ color: m.color }} fill={m.color} />
                </button>
              ))}
            </div>

            {/* Lanes */}
            <div ref={lanesRef} data-lanes="true" className="relative" style={{ width: contentWidth }}>
              {doc.tracks.map((track) => (
                <div
                  key={track.id}
                  data-lane="true"
                  onPointerDown={(e) => onLaneDown(e, track)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onLaneDrop(e, track)}
                  className="relative border-b border-ink-700/40"
                  style={{ height: TRACK_HEIGHT[track.kind], background: track.kind === 'audio' ? '#141420' : undefined }}
                >
                  {track.clips.map((clip) => (
                    <ClipView
                      key={clip.id}
                      clip={clip}
                      track={track}
                      selected={selectedIds.includes(clip.id)}
                      primary={clip.id === selectedClipId}
                      pps={pxPerSecond}
                      onDragStart={(e, kind) => beginDrag(e, clip, track, kind)}
                      onEffectDragStart={(e, kind, eff) => beginEffectDrag(e, clip, track, kind, eff)}
                      onDragMove={onDragMove}
                      onDragEnd={endDrag}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        selectClip(clip.id)
                        setContextMenu({ x: e.clientX, y: e.clientY, clipId: clip.id })
                      }}
                    />
                  ))}
                </div>
              ))}

              {/* Playhead line */}
              <PlayheadLine pps={pxPerSecond} playhead={playhead} onSeek={seek} />
              {snapLine !== null && (
                <div
                  className="pointer-events-none absolute top-0 z-30 h-full w-px bg-amber-400/80"
                  style={{ left: snapLine * pxPerSecond }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {contextMenu && (
        <ClipContextMenu {...contextMenu} onClose={() => setContextMenu(null)} />
      )}
    </section>
  )
}

function ZoomInButton() {
  const pps = useEditorStore((s) => s.pxPerSecond)
  const setZoom = useEditorStore((s) => s.setZoom)
  return (
    <IconButton title="Phóng to (Ctrl+lăn)" onClick={() => setZoom(pps * 1.3)}>
      <ZoomIn size={14} />
    </IconButton>
  )
}

function ZoomOutButton() {
  const pps = useEditorStore((s) => s.pxPerSecond)
  const setZoom = useEditorStore((s) => s.setZoom)
  return (
    <IconButton title="Thu nhỏ (Ctrl+lăn)" onClick={() => setZoom(pps / 1.3)}>
      <span className="text-sm font-semibold">−</span>
    </IconButton>
  )
}

function RulerTicks({ pxPerSecond, width }: { pxPerSecond: number; width: number }) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  const step = steps.find((s) => s * pxPerSecond >= 64) ?? 600
  const ticks: number[] = []
  for (let t = 0; t * pxPerSecond <= width; t += step) ticks.push(t)
  return (
    <>
      {ticks.map((t) => (
        <div key={t} className="absolute top-0 h-full" style={{ left: t * pxPerSecond }}>
          <div className="h-2 w-px bg-ink-600" />
          <span className="absolute left-1 top-0.5 text-[9px] text-ink-400">{formatTime(t).slice(0, 5)}</span>
        </div>
      ))}
    </>
  )
}

function TrackHeader({ track }: { track: Track }) {
  const update = useProjectStore((s) => s.updateTrack)
  const h = TRACK_HEIGHT[track.kind]
  return (
    <div
      className="flex flex-col justify-center gap-0.5 border-b border-r border-ink-700/60 bg-ink-850 px-2"
      style={{ height: h }}
    >
      <div className="flex items-center gap-1">
        <span className="flex-1 truncate text-[11px] text-ink-300">{track.name}</span>
        <button
          title={track.hidden ? 'Hiện' : 'Ẩn'}
          onClick={() => update(track.id, { hidden: !track.hidden })}
          className={`rounded p-0.5 ${track.hidden ? 'text-amber-400' : 'text-ink-400 hover:text-white'}`}
        >
          {track.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
        <button
          title={track.muted ? 'Bật tiếng' : 'Tắt tiếng'}
          onClick={() => update(track.id, { muted: !track.muted })}
          className={`rounded p-0.5 ${track.muted ? 'text-red-400' : 'text-ink-400 hover:text-white'}`}
        >
          {track.muted ? <VolumeX size={11} /> : <Volume2 size={11} />}
        </button>
        <button
          title={track.locked ? 'Mở khóa' : 'Khóa'}
          onClick={() => update(track.id, { locked: !track.locked })}
          className={`rounded p-0.5 ${track.locked ? 'text-amber-400' : 'text-ink-400 hover:text-white'}`}
        >
          {track.locked ? <Lock size={11} /> : <LockOpen size={11} />}
        </button>
      </div>
      {track.kind === 'audio' && (
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={track.volume}
          onChange={(e) => update(track.id, { volume: Number(e.target.value) })}
          className="h-1 w-full"
        />
      )}
    </div>
  )
}

function PlayheadLine({
  pps,
  playhead,
  onSeek
}: {
  pps: number
  playhead: number
  onSeek: (t: number) => void
}) {
  const dragging = useRef(false)

  const handle = (clientX: number) => {
    // The lanes container is the offset parent of the playhead.
    const lanes = document.querySelector<HTMLElement>('[data-lanes="true"]')
    if (!lanes) return
    const rect = lanes.getBoundingClientRect()
    onSeek(Math.max(0, (clientX - rect.left) / pps))
  }

  return (
    <div className="absolute top-0 z-30 h-full" style={{ left: playhead * pps }}>
      <div className="h-full w-px bg-red-500" />
      <div
        className="absolute -left-1.5 -top-0.5 h-2.5 w-3 cursor-ew-resize rounded-b-sm bg-red-500"
        onPointerDown={(e) => {
          e.stopPropagation()
          dragging.current = true
          ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => dragging.current && handle(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      />
    </div>
  )
}

function ClipView({
  clip,
  track,
  selected,
  primary,
  pps,
  onDragStart,
  onEffectDragStart,
  onDragMove,
  onDragEnd,
  onContextMenu
}: {
  clip: Clip
  track: Track
  selected: boolean
  primary: boolean
  pps: number
  onDragStart: (e: React.PointerEvent, kind: DragState['kind']) => void
  onEffectDragStart: (
    e: React.PointerEvent,
    kind: 'effect-move' | 'effect-left' | 'effect-right',
    eff: ClipEffect
  ) => void
  onDragMove: (e: React.PointerEvent) => void
  onDragEnd: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const asset = useProjectStore((s) => s.doc.mediaLibrary.find((a) => a.id === clip.assetId))
  const width = Math.max(6, clip.duration * pps)
  const left = clip.start * pps
  const h = TRACK_HEIGHT[track.kind] - 6

  const kindColor =
    clip.kind === 'text'
      ? 'bg-violet-800/90 ring-violet-400/60'
      : clip.kind === 'audio'
        ? 'bg-teal-800/90 ring-teal-400/50'
        : clip.kind === 'image'
          ? 'bg-sky-800/90 ring-sky-400/50'
          : 'bg-indigo-800/90 ring-indigo-400/50'

  return (
    <div
      className={`group absolute top-1 cursor-grab overflow-hidden rounded-md ring-1 active:cursor-grabbing ${kindColor} ${
        selected ? (primary ? 'ring-2 ring-white' : 'ring-2 ring-white/60') : ''
      } ${track.locked ? 'opacity-60' : ''}`}
      style={{ left, width, height: h }}
      onPointerDown={(e) => onDragStart(e, 'move')}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onContextMenu={onContextMenu}
    >
      {/* Body background: thumbnails for video/image, waveform for audio */}
      {clip.kind !== 'text' && asset?.thumbnail && clip.kind !== 'audio' && (
        <div
          className="absolute inset-0 opacity-70"
          style={{
            backgroundImage: `url(${asset.thumbnail})`,
            backgroundSize: 'auto 100%',
            backgroundRepeat: 'repeat-x'
          }}
        />
      )}
      {clip.kind === 'audio' && asset?.waveform && (
        <Waveform peaks={asset.waveform} inPoint={clip.inPoint} duration={clip.duration * clip.speed} assetDuration={asset.duration} color="#5eead4" />
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/45 px-1.5 py-0.5">
        <span className="truncate text-[9px] font-medium text-white">
          {clip.kind === 'text'
            ? clip.text?.content.split('\n')[0]
            : clip.kind === 'sticker'
              ? clip.sticker?.emoji
              : asset?.fileName ?? 'Clip'}
        </span>
        {clip.speed !== 1 && <span className="ml-1 shrink-0 text-[8px] text-amber-300">{clip.speed}×</span>}
      </div>

      {/* Fade triangles */}
      {clip.fadeIn > 0 && (
        <div
          className="pointer-events-none absolute left-0 top-0 border-t border-l bg-black/50"
          style={{ borderWidth: `${Math.min(h, clip.fadeIn * pps)}px` }}
        />
      )}
      {clip.fadeOut > 0 && (
        <div
          className="pointer-events-none absolute right-0 top-0 border-t border-r bg-black/50"
          style={{ borderWidth: `${Math.min(h, clip.fadeOut * pps)}px` }}
        />
      )}

      {/* Transition badge */}
      {clip.transitionIn && (
        <div className="pointer-events-none absolute left-0 top-0 rounded-br bg-accent px-1 text-[8px] text-white">
          ⇥{clip.transitionIn.duration.toFixed(1)}s
        </div>
      )}

      {/* Trim handles */}
      <div
        className="absolute left-0 top-0 h-full w-1.5 cursor-w-resize bg-white/0 hover:bg-white/40"
        onPointerDown={(e) => onDragStart(e, 'trim-left')}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      />
      <div
        className="absolute right-0 top-0 h-full w-1.5 cursor-e-resize bg-white/0 hover:bg-white/40"
        onPointerDown={(e) => onDragStart(e, 'trim-right')}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      />

      {/* Effect bars — drag to reposition inside the clip, edges to resize */}
      {(clip.kind === 'video' || clip.kind === 'image') &&
        (clip.effects ?? []).map((eff) => (
          <div
            key={eff.id}
            className="absolute z-10 flex h-4 cursor-grab items-center gap-0.5 overflow-hidden rounded bg-accent/85 px-1.5 text-[8px] font-semibold text-white shadow ring-1 ring-white/40 active:cursor-grabbing"
            style={{ left: eff.start * pps, width: Math.max(22, eff.duration * pps), bottom: 17 }}
            title={`${eff.name} — kéo để di chuyển, kéo mép hai bên để co giãn`}
            onPointerDown={(e) => onEffectDragStart(e, 'effect-move', eff)}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
          >
            <div
              className="absolute left-0 top-0 h-full w-1.5 cursor-w-resize bg-white/30"
              onPointerDown={(e) => onEffectDragStart(e, 'effect-left', eff)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
            />
            <div
              className="absolute right-0 top-0 h-full w-1.5 cursor-e-resize bg-white/30"
              onPointerDown={(e) => onEffectDragStart(e, 'effect-right', eff)}
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
            />
            <span className="truncate">✦ {eff.name}</span>
          </div>
        ))}
    </div>
  )
}

function Waveform({
  peaks,
  inPoint,
  duration,
  assetDuration,
  color
}: {
  peaks: number[]
  inPoint: number
  duration: number
  assetDuration: number
  color: string
}) {
  const count = Math.max(2, Math.min(peaks.length, Math.floor(duration * 40)))
  const bars: number[] = []
  for (let i = 0; i < count; i++) {
    const sourceT = inPoint + (i / count) * duration
    const idx = Math.min(peaks.length - 1, Math.floor((sourceT / Math.max(0.01, assetDuration)) * peaks.length))
    bars.push(peaks[idx])
  }
  return (
    <div className="absolute inset-x-0 top-0 flex h-full items-center gap-px px-0.5 opacity-80">
      {bars.map((v, i) => (
        <div
          key={i}
          className="min-w-px flex-1 rounded-sm"
          style={{ height: `${Math.max(4, v * 88)}%`, background: color }}
        />
      ))}
    </div>
  )
}

function ClipContextMenu({
  x,
  y,
  clipId,
  onClose
}: {
  x: number
  y: number
  clipId: string
  onClose: () => void
}) {
  const project = useProjectStore.getState()
  const found = clipId ? project.findClip(clipId) : null

  if (!found) {
    // Ruler context menu: marker management at the clicked position.
    const lanes = document.querySelector<HTMLElement>('[data-lanes="true"]')
    const time = Math.max(0, (x - (lanes?.getBoundingClientRect().left ?? 0)) / useEditorStore.getState().pxPerSecond)
    return (
      <div
        className="fixed z-50 min-w-40 rounded-lg border border-ink-600 bg-ink-800 py-1 shadow-2xl"
        style={{ left: x, top: y }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            project.addMarker(time)
            onClose()
          }}
          className="block w-full px-3 py-1.5 text-left text-xs text-ink-200 hover:bg-ink-700"
        >
          Thêm mốc đánh dấu
        </button>
        {project.doc.markers.length > 0 && (
          <>
            <div className="my-1 h-px bg-ink-700" />
            {project.doc.markers.slice(-6).map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  project.removeMarker(m.id)
                  onClose()
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-ink-300 hover:bg-ink-700"
              >
                <span className="truncate">
                  {m.label} · {formatTime(m.time)}
                </span>
                <Trash2 size={11} className="ml-2 shrink-0 text-ink-500" />
              </button>
            ))}
          </>
        )}
      </div>
    )
  }

  const clipKind = found.clip.kind
  const items: Array<{ label: string; action: () => void; danger?: boolean }> = [
    { label: 'Tách tại playhead', action: () => project.splitClipAt(clipId, useEditorStore.getState().playhead) },
    { label: 'Sao chép (Ctrl+C)', action: () => project.copySelection() },
    { label: 'Nhân đôi', action: () => project.duplicateClip(clipId) }
  ]
  if (clipKind === 'video') {
    items.push({
      label: 'Tách âm thanh',
      action: () => {
        const ok = project.extractAudio(clipId)
        if (!ok) window.alert('Không tách được âm thanh — cần một track âm thanh còn trống.')
      }
    })
  }
  items.push(
    { label: 'Xóa liên hoàn (dồn clip sau)', action: () => project.rippleDeleteClip(clipId) },
    { label: 'Xóa', danger: true, action: () => project.deleteClip(clipId) }
  )
  return (
    <div
      className="fixed z-50 min-w-40 rounded-lg border border-ink-600 bg-ink-800 py-1 shadow-2xl"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          onClick={() => {
            item.action()
            onClose()
          }}
          className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-ink-700 ${
            item.danger ? 'text-red-300' : 'text-ink-200'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
