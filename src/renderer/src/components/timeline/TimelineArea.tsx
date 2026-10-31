import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity,
  Crosshair,
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
  Waves,
  ZoomIn,
  Plus
} from 'lucide-react'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'
import type { Clip, ClipEffect, Keyframe, KeyframeEasing, Track } from '@shared/document'
import { applyEasing, createDenoiseSettings, createStabilizationSettings, sampleKeyframes } from '@shared/document'
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
  const keyframePanelOpen = useEditorStore((s) => s.keyframePanel.open)

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
  const selectedClip = selectedClipId ? useProjectStore.getState().findClip(selectedClipId) : null
  const selectedIsVideo = selectedClip?.clip.kind === 'video'
  const selectedHasAudio = selectedClip ? (selectedClip.clip.kind === 'video' || selectedClip.clip.kind === 'audio') : false

  const toggleStabilization = () => {
    if (!selectedClip) return
    useProjectStore.getState().pushHistory()
    const cur = selectedClip.clip.stabilization
    useProjectStore.getState().updateClip(selectedClip.clip.id, {
      stabilization: createStabilizationSettings({ enabled: !(cur?.enabled === true), level: cur?.level ?? 2 })
    })
  }

  const toggleDenoise = () => {
    if (!selectedClip) return
    useProjectStore.getState().pushHistory()
    const cur = selectedClip.clip.denoise
    useProjectStore.getState().updateClip(selectedClip.clip.id, {
      denoise: createDenoiseSettings({
        enabled: !(cur?.enabled === true),
        rate: cur?.rate ?? 0.6,
        mode: cur?.mode ?? 'standard'
      })
    })
  }

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
        <IconButton
          title="Đồ thị keyframe (chỉnh đường cong)"
          disabled={!selectedClipId}
          active={keyframePanelOpen}
          onClick={() => useEditorStore.getState().toggleKeyframePanel(selectedClipId)}
        >
          <Activity size={14} />
        </IconButton>
        {selectedIsVideo && (
          <IconButton
            title="Giảm rung — bật/tắt nhanh (chỉnh mức độ trong bảng bên phải)"
            active={selectedClip!.clip.stabilization?.enabled === true}
            disabled={!selectedClip!.clip.assetId || !!selectedClip!.clip.compound}
            onClick={toggleStabilization}
          >
            <Crosshair size={14} />
          </IconButton>
        )}
        {selectedHasAudio && (
          <IconButton
            title="Giảm nhiễu — bật/tắt nhanh (chọn chế độ + cường độ trong bảng bên phải)"
            active={selectedClip!.clip.denoise?.enabled === true}
            onClick={toggleDenoise}
          >
            <Waves size={14} />
          </IconButton>
        )}
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

              {/* Marker guide lines through the lanes (beats included) */}
              {doc.markers.map((m) => (
                <div
                  key={`guide-${m.id}`}
                  className="pointer-events-none absolute top-0 z-0 h-full w-px opacity-60"
                  style={{ left: m.time * pxPerSecond, background: m.color }}
                />
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
      {keyframePanelOpen && <KeyframeGraphPanel />}
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
      <div className="h-full w-px bg-white/95 shadow-[0_0_4px_rgba(0,0,0,0.6)]" />
      <div
        className="absolute -left-1.5 -top-0.5 h-2.5 w-3 cursor-ew-resize rounded-b-sm bg-white/95 shadow-[0_0_4px_rgba(0,0,0,0.6)]"
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

      {/* Keyframe diamonds (selected clip) — click to seek, drag to move */}
      {primary &&
        clip.keyframes.map((kf) => (
          <KeyframeDiamond key={kf.id} clip={clip} kf={kf} pps={pps} />
        ))}

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

/** Diamond marker on the clip: click seeks, horizontal drag re-times it. */
function KeyframeDiamond({
  clip,
  kf,
  pps
}: {
  clip: Clip
  kf: Keyframe
  pps: number
}) {
  const drag = useRef(false)
  const playhead = useEditorStore((s) => s.playhead)
  const active = Math.abs(playhead - (clip.start + kf.time)) < 0.04
  const round = (v: number) => Math.round(v * 100) / 100

  const timelineFromPointer = (clientX: number): number => {
    const lanes = document.querySelector<HTMLElement>('[data-lanes="true"]')
    if (!lanes) return clip.start
    return (clientX - lanes.getBoundingClientRect().left) / pps
  }

  return (
    <button
      title={`Keyframe ${formatTime(kf.time)} — kéo để đổi thời điểm, nhấp để nhảy tới`}
      className="absolute z-20 flex h-4 w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center"
      style={{ left: kf.time * pps, top: 1 }}
      onPointerDown={(e) => {
        e.stopPropagation()
        drag.current = true
        useProjectStore.getState().pushHistory()
        useEditorStore.getState().setPlaying(false)
        useEditorStore.getState().setPlayhead(clip.start + kf.time)
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!drag.current) return
        const local = Math.max(0, Math.min(clip.duration, timelineFromPointer(e.clientX) - clip.start))
        useProjectStore.getState().updateKeyframe(clip.id, kf.id, { time: round(local) })
      }}
      onPointerUp={(e) => {
        drag.current = false
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      }}
    >
      <span
        className={`h-2.5 w-2.5 rotate-45 rounded-[1px] border ${
          active ? 'border-white bg-white' : 'border-amber-200/80 bg-amber-300'
        }`}
      />
    </button>
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
  if (found.clip.compound) {
    items.push({
      label: 'Tách clip ghép (compound)',
      action: () => {
        if (!project.ungroupCompound(clipId)) window.alert('Không tách được clip ghép.')
      }
    })
  } else if (clipKind === 'video') {
    const selectionIds = project.selection.clipIds.length > 0 ? project.selection.clipIds : [clipId]
    if (selectionIds.length >= 2) {
      items.push({
        label: `Gộp thành compound (${selectionIds.length} clip)`,
        action: () => {
          const id = project.groupIntoCompound(selectionIds)
          if (!id) window.alert('Không gộp được: cần ≥ 2 clip thường và không lồng nhau.')
        }
      })
    }
    items.push({
      label: 'Đảo ngược video',
      action: () => {
        void project.reverseClip(clipId).then((ok) => {
          if (!ok) window.alert('Không đảo ngược được clip này.')
        })
      }
    })
    if (found.clip.assetId) {
      const asset = project.findAsset(found.clip.assetId)
      if (asset?.beats && asset.beats.length > 0) {
        items.push({
          label: `Đánh dấu beat (${asset.beats.length} nhịp)`,
          action: () => {
            const count = project.addBeatMarkers(found.clip.assetId!)
            if (count === 0) window.alert('Không có beat mới để đánh dấu.')
          }
        })
      }
    }
    if (project.doc.markers.some((m) => m.label.startsWith('Beat'))) {
      items.push({ label: 'Xóa tất cả marker beat', action: () => project.removeAllBeatMarkers() })
    }
  }
  if (clipKind === 'video' && !found.clip.compound) {
    items.push({
      label: 'Tách âm thanh',
      action: () => {
        const ok = project.extractAudio(clipId)
        if (!ok) window.alert('Không tách được âm thanh — cần một track âm thanh còn trống.')
      }
    })
    // CapCut-style quick mute: "Xóa âm thanh" silences the clip's own audio
    // (reversible via the same menu item) without touching the video track.
    const muted = (found.clip.volume ?? 1) === 0
    items.push({
      label: muted ? 'Bật lại âm thanh' : 'Xóa âm thanh (tắt tiếng)',
      action: () => project.updateClip(clipId, { volume: muted ? 1 : 0 })
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

// ---------------------------------------------------------------------------
// Keyframe graph panel (CapCut curve editor)
// ---------------------------------------------------------------------------

const GRAPH_PROPS = [
  { key: 'scale', label: 'Tỉ lệ', color: '#7dd3fc', min: 0, max: 4, baseline: 1, audio: false },
  { key: 'x', label: 'X', color: '#f472b6', min: -1, max: 1, baseline: 0, audio: false },
  { key: 'y', label: 'Y', color: '#fbbf24', min: -1, max: 1, baseline: 0, audio: false },
  { key: 'rotation', label: 'Xoay', color: '#a78bfa', min: -180, max: 180, baseline: 0, audio: false },
  { key: 'opacity', label: 'Mờ dần', color: '#e2e8f0', min: 0, max: 1, baseline: 1, audio: false },
  { key: 'volume', label: 'Âm lượng', color: '#34d399', min: 0, max: 2, baseline: 1, audio: true }
] as const

type GraphPropKey = (typeof GRAPH_PROPS)[number]['key']

const GRAPH_W = 336
const GRAPH_H = 148
const GRAPH_PAD_X = 26
const GRAPH_PAD_Y = 16

function KeyframeGraphPanel() {
  const panelClipId = useEditorStore((s) => s.keyframePanel.clipId)
  const fallbackClipId = useProjectStore((s) => s.selection.clipId)
  const activeClipId = panelClipId ?? fallbackClipId
  const closePanel = useEditorStore((s) => s.closeKeyframePanel)
  const playhead = useEditorStore((s) => s.playhead)
  const found = useProjectStore((s) => (activeClipId ? s.findClip(activeClipId) : null))

  const [prop, setProp] = useState<GraphPropKey>('scale')
  const [selectedKf, setSelectedKf] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const draggingKf = useRef<string | null>(null)

  if (!found || !activeClipId) return null
  const { clip } = found
  const meta = GRAPH_PROPS.find((p) => p.key === prop)!
  const duration = Math.max(0.001, clip.duration)

  const xOf = (t: number) => GRAPH_PAD_X + (Math.max(0, Math.min(duration, t)) / duration) * (GRAPH_W - GRAPH_PAD_X - 8)
  const yOf = (v: number) => {
    const clamped = Math.max(meta.min, Math.min(meta.max, v))
    return GRAPH_H - GRAPH_PAD_Y - ((clamped - meta.min) / (meta.max - meta.min)) * (GRAPH_H - GRAPH_PAD_Y * 2)
  }

  const pointToGraph = (clientX: number, clientY: number): { t: number; v: number } => {
    const rect = svgRef.current!.getBoundingClientRect()
    const gx = clientX - rect.left
    const gy = clientY - rect.top
    const t = ((gx - GRAPH_PAD_X) / (GRAPH_W - GRAPH_PAD_X - 8)) * duration
    const v = meta.min + ((GRAPH_H - GRAPH_PAD_Y - gy) / (GRAPH_H - GRAPH_PAD_Y * 2)) * (meta.max - meta.min)
    return { t: Math.max(0, Math.round(t * 100) / 100), v: Math.max(meta.min, Math.min(meta.max, Math.round(v * 100) / 100)) }
  }

  const points = clip.keyframes
    .filter((kf) => kf[prop] !== undefined)
    .sort((a, b) => a.time - b.time)

  return (
    <div className="fixed bottom-[17.6rem] right-4 z-40 w-[368px] rounded-xl border border-ink-600 bg-ink-900/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-white">Đồ thị keyframe</p>
        <button onClick={closePanel} className="text-ink-400 hover:text-white" title="Đóng">
          ✕
        </button>
      </div>

      {/* Property chips */}
      <div className="mb-2 flex flex-wrap gap-1">
        {GRAPH_PROPS.filter((p) => !p.audio || clip.kind === 'video' || clip.kind === 'audio').map((p) => (
          <button
            key={p.key}
            onClick={() => setProp(p.key)}
            className={`rounded bg-ink-800 px-2 py-0.5 text-[10px] hover:bg-ink-700 ${
              prop === p.key ? 'font-semibold' : 'text-ink-300'
            }`}
            style={prop === p.key ? { color: p.color } : undefined}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => {
            const store = useProjectStore.getState()
            const local = Math.max(0, Math.min(clip.duration, playhead - clip.start))
            const base = sampleKeyframes(clip, clip.start + local)
            store.pushHistory()
            store.addKeyframe(
              clip.id,
              prop === 'volume'
                ? { time: local, volume: base.volume ?? clip.volume }
                : {
                    time: local,
                    scale: base.scale ?? clip.transform.scale,
                    x: base.x ?? clip.transform.x,
                    y: base.y ?? clip.transform.y,
                    rotation: base.rotation ?? clip.transform.rotation,
                    opacity: base.opacity ?? clip.transform.opacity
                  }
            )
          }}
          className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/30"
        >
          + Playhead
        </button>
      </div>

      {/* Graph */}
      <svg
        ref={svgRef}
        width={GRAPH_W}
        height={GRAPH_H}
        viewBox={`0 0 ${GRAPH_W} ${GRAPH_H}`}
        className="cursor-crosshair rounded border border-ink-700 bg-ink-950"
        onPointerMove={(e) => {
          const id = draggingKf.current
          if (!id || !points.some((kf) => kf.id === id)) return
          const { t, v } = pointToGraph(e.clientX, e.clientY)
          useProjectStore.getState().updateKeyframe(clip.id, id, { time: t, [prop]: v })
        }}
        onPointerUp={(e) => {
          draggingKf.current = null
          ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
        }}
        onDoubleClick={(e) => {
          // Add a full keyframe at the clicked time (values from current state).
          if (e.target !== e.currentTarget) return
          const { t } = pointToGraph(e.clientX, e.clientY)
          const store = useProjectStore.getState()
          const base = sampleKeyframes(clip, clip.start + t)
          store.pushHistory()
          store.addKeyframe(
            clip.id,
            prop === 'volume'
              ? { time: t, volume: base.volume ?? clip.volume }
              : {
                  time: t,
                  scale: base.scale ?? clip.transform.scale,
                  x: base.x ?? clip.transform.x,
                  y: base.y ?? clip.transform.y,
                  rotation: base.rotation ?? clip.transform.rotation,
                  opacity: base.opacity ?? clip.transform.opacity
                }
          )
        }}
      >
        {/* Baseline + frame */}
        <line
          x1={GRAPH_PAD_X - 12}
          y1={yOf(meta.baseline)}
          x2={GRAPH_W - 6}
          y2={yOf(meta.baseline)}
          stroke="#1e2a4a"
          strokeWidth={1}
        />
        <line x1={GRAPH_PAD_X} y1={4} x2={GRAPH_PAD_X} y2={GRAPH_H - GRAPH_PAD_Y} stroke="#334155" strokeWidth={0.5} />
        {/* Playhead position */}
        {playhead >= clip.start && playhead <= clip.start + clip.duration && (
          <line
            x1={xOf(playhead - clip.start)}
            y1={4}
            x2={xOf(playhead - clip.start)}
            y2={GRAPH_H - GRAPH_PAD_Y}
            stroke="#ef4444"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}
        {/* Curve with easing between consecutive keyframes */}
        {points.length >= 2 &&
          points.slice(0, -1).map((kf, i) => {
            const next = points[i + 1]
            const from = kf[prop]!
            const to = next[prop]!
            const steps = 14
            const d: string[] = []
            for (let s = 0; s <= steps; s++) {
              const u = s / steps
              const eased = applyEasing(u, kf.easing ?? 'ease-in-out')
              const value = from + (to - from) * eased
              const t = kf.time + (next.time - kf.time) * u
              d.push(`${s === 0 ? 'M' : 'L'} ${xOf(t)} ${yOf(value)}`)
            }
            return <path key={kf.id} d={d.join(' ')} fill="none" stroke={meta.color} strokeWidth={1.5} />
          })}
        {/* Keyframe diamonds */}
        {points.map((kf) => (
          <circle
            key={kf.id}
            cx={xOf(kf.time)}
            cy={yOf(kf[prop]!)}
            r={kf.id === selectedKf ? 6 : 5}
            fill={meta.color}
            stroke={kf.id === selectedKf ? '#ffffff' : '#0f172a'}
            strokeWidth={kf.id === selectedKf ? 2 : 1}
            className="cursor-grab"
            onPointerDown={(e) => {
              e.stopPropagation()
              setSelectedKf(kf.id)
              draggingKf.current = kf.id
              useProjectStore.getState().pushHistory()
              useEditorStore.getState().setPlaying(false)
              ;(e.target as Element).setPointerCapture(e.pointerId)
            }}
          />
        ))}
      </svg>

      {/* Selected keyframe controls */}
      {selectedKf && points.some((k) => k.id === selectedKf) ? (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[10px] text-ink-400">
            {formatTime(points.find((k) => k.id === selectedKf)!.time)}
          </span>
          <select
            value={points.find((k) => k.id === selectedKf)!.easing ?? 'ease-in-out'}
            onChange={(e) => {
              useProjectStore.getState().pushHistory()
              useProjectStore
                .getState()
                .updateKeyframe(clip.id, selectedKf, { easing: e.target.value as KeyframeEasing })
            }}
            className="flex-1 rounded border border-ink-600 bg-ink-800 px-1 py-0.5 text-[10px] text-white outline-none"
          >
            <option value="ease-in-out">Mượt (mặc định)</option>
            <option value="linear">Tuyến tính</option>
            <option value="ease-in">Chậm vào</option>
            <option value="ease-out">Chậm ra</option>
            <option value="hold">Giữ (bước)</option>
          </select>
          <button
            onClick={() => {
              useProjectStore.getState().pushHistory()
              useProjectStore.getState().removeKeyframe(clip.id, selectedKf)
              setSelectedKf(null)
            }}
            className="rounded bg-ink-800 p-1 text-ink-400 hover:bg-ink-700 hover:text-red-400"
            title="Xóa keyframe"
          >
            <Trash2 size={11} />
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-ink-500">
          Kéo kim cương để đổi thời điểm/giá trị; đúp nhấp vùng trống để thêm keyframe.
        </p>
      )}
    </div>
  )
}
