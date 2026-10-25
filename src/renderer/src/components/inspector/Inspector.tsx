import { Diamond, FlipHorizontal2, FlipVertical2, RotateCcw, Scissors, Snowflake, Sparkles, Trash2 } from 'lucide-react'
import { useEditorStore } from '../../store/editorStore'
import { useProjectStore } from '../../store/projectStore'
import {
  NEUTRAL_FILTERS,
  SPEED_CURVE_PRESETS,
  createChromaKey,
  createMask,
  type AudioEffectKind,
  type BlendMode,
  type Clip,
  type MaskShape,
  type TextAnimationKind
} from '@shared/document'
import { Section, SliderRow } from '../ui/controls'
import { FONT_FAMILIES, TRANSITION_TYPES } from '../../lib/presets'
import { formatTime } from '../../lib/format'
import { freezeFrameAtPlayhead } from '../../core/media/freezeFrame'

const BLEND_MODES: Array<{ id: BlendMode; name: string }> = [
  { id: 'normal', name: 'Bình thường' },
  { id: 'multiply', name: 'Nhân (Multiply)' },
  { id: 'screen', name: 'Màn (Screen)' },
  { id: 'overlay', name: 'Phủ (Overlay)' },
  { id: 'darken', name: 'Tối (Darken)' },
  { id: 'lighten', name: 'Sáng (Lighten)' },
  { id: 'color-dodge', name: 'Gia tăng màu' },
  { id: 'color-burn', name: 'Đốt màu' },
  { id: 'hard-light', name: 'Ánh sáng cứng' },
  { id: 'soft-light', name: 'Ánh sáng mềm' },
  { id: 'difference', name: 'Hiệu (Difference)' },
  { id: 'exclusion', name: 'Loại trừ' },
  { id: 'hue', name: 'Sắc độ' },
  { id: 'saturation', name: 'Độ bão hòa' },
  { id: 'color', name: 'Màu sắc' },
  { id: 'luminosity', name: 'Độ sáng' }
]

const MASK_SHAPES: Array<{ id: MaskShape; name: string }> = [
  { id: 'none', name: 'Không' },
  { id: 'circle', name: 'Tròn' },
  { id: 'rectangle', name: 'Vuông' },
  { id: 'triangle', name: 'Tam giác' },
  { id: 'star', name: 'Ngôi sao' },
  { id: 'heart', name: 'Trái tim' },
  { id: 'linear', name: 'Nút chuyển (dải)' }
]

const AUDIO_EFFECTS: Array<{ id: AudioEffectKind; name: string }> = [
  { id: 'none', name: 'Không' },
  { id: 'echo', name: 'Vọng âm' },
  { id: 'reverb', name: 'Vang phòng' },
  { id: 'robot', name: 'Robot' },
  { id: 'phone', name: 'Điện thoại' },
  { id: 'bass-boost', name: 'Tăng trầm' },
  { id: 'high-pitch', name: 'Tông cao' },
  { id: 'low-pitch', name: 'Tông trầm' },
  { id: 'noise-reduction', name: 'Giảm ồn (cơ bản)' }
]

const TEXT_ANIMATIONS: Array<{ id: TextAnimationKind; name: string }> = [
  { id: 'none', name: 'Không' },
  { id: 'fade', name: 'Mờ dần' },
  { id: 'slide-up', name: 'Trượt lên' },
  { id: 'slide-down', name: 'Trượt xuống' },
  { id: 'slide-left', name: 'Trượt trái' },
  { id: 'slide-right', name: 'Trượt phải' },
  { id: 'typewriter', name: 'Đánh máy' },
  { id: 'zoom', name: 'Phóng to' },
  { id: 'pop', name: 'Nảy ra' },
  { id: 'bounce', name: 'Dội xuống' }
]

export default function Inspector() {
  const doc = useProjectStore((s) => s.doc)
  const selectedId = useProjectStore((s) => s.selection.clipId)
  const findClip = useProjectStore((s) => s.findClip)
  const found = selectedId ? findClip(selectedId) : null

  if (!found) {
    return (
      <aside className="w-72 shrink-0 overflow-y-auto border-l border-ink-700/60 bg-ink-900">
        <Section title="Cài đặt dự án">
          <SliderRow
            label="FPS"
            value={doc.settings.fps}
            min={24}
            max={60}
            step={1}
            format={(v) => String(v)}
            onChange={(v) =>
              useProjectStore.getState().setSettings({ fps: v as 24 | 25 | 30 | 50 | 60 })
            }
          />
          <label className="flex items-center justify-between text-xs">
            <span className="text-ink-300">Màu nền</span>
            <input
              type="color"
              value={doc.settings.backgroundColor}
              onChange={(e) => useProjectStore.getState().setSettings({ backgroundColor: e.target.value })}
              className="h-7 w-12 cursor-pointer rounded border border-ink-600 bg-transparent"
            />
          </label>
        </Section>
        <div className="p-4 text-center text-[11px] leading-relaxed text-ink-400">
          Chọn một clip trên timeline để xem thuộc tính của nó ở đây.
        </div>
      </aside>
    )
  }

  const { clip } = found

  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-ink-700/60 bg-ink-900">
      <div className="border-b border-ink-700/60 px-3 py-2.5">
        <p className="truncate text-sm font-medium text-white">{clipLabel(clip)}</p>
        <p className="text-[11px] text-ink-400">
          {formatTime(clip.start)} → {formatTime(clip.start + clip.duration)}
        </p>
      </div>

      {clip.kind === 'text' && clip.text && <TextSection clip={clip} />}
      {clip.kind === 'sticker' && clip.sticker && <StickerSection clip={clip} />}

      {(clip.kind === 'video' || clip.kind === 'image') && (
        <>
          <TransformSection clip={clip} />
          <KeyframeSection clip={clip} />
          <FilterSection clip={clip} />
          <MaskSection clip={clip} />
          <ChromaKeySection clip={clip} />
          <BlendSection clip={clip} />
          <EffectsSection clip={clip} />
          <TransitionQuickSection clip={clip} />
        </>
      )}

      {(clip.kind === 'video' || clip.kind === 'audio') && (
        <>
          <AudioSection clip={clip} />
          <AudioEffectSection clip={clip} />
        </>
      )}

      {clip.kind !== 'text' && <SpeedSection clip={clip} />}

      <Section title="Hành động">
        <div className="flex gap-2">
          <button
            onClick={() => useProjectStore.getState().duplicateClip(clip.id)}
            className="flex-1 rounded-md bg-ink-800 py-1.5 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-white"
          >
            Nhân đôi
          </button>
          <button
            onClick={() => useProjectStore.getState().deleteClip(clip.id)}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-red-950/60 py-1.5 text-[11px] text-red-300 hover:bg-red-900/60"
          >
            <Trash2 size={12} /> Xóa
          </button>
        </div>
        {clip.kind === 'video' && (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                const ok = useProjectStore.getState().extractAudio(clip.id)
                if (!ok) window.alert('Không tách được âm thanh — cần một track âm thanh còn trống.')
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-ink-800 py-1.5 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-white"
            >
              <Scissors size={12} /> Tách âm thanh
            </button>
            <button
              onClick={() => void freezeFrameAtPlayhead(clip.id)}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-ink-800 py-1.5 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-white"
            >
              <Snowflake size={12} /> Đóng băng khung
            </button>
          </div>
        )}
      </Section>
    </aside>
  )
}

function clipLabel(clip: Clip): string {
  const project = useProjectStore.getState()
  if (clip.kind === 'text') return clip.text?.content.split('\n')[0] || 'Chữ'
  if (clip.kind === 'sticker') return `Sticker ${clip.sticker?.emoji ?? ''}`
  const asset = clip.assetId ? project.findAsset(clip.assetId) : null
  return asset?.fileName ?? 'Clip'
}

function TransformSection({ clip }: { clip: Clip }) {
  const t = clip.transform
  const update = useProjectStore.getState().updateTransform
  const push = useProjectStore.getState().pushHistory
  const cropPreset = (targetAspect: number | null) => {
    push()
    if (targetAspect === null) {
      update(clip.id, { crop: { left: 0, right: 0, top: 0, bottom: 0 } })
      return
    }
    const asset = clip.assetId ? useProjectStore.getState().findAsset(clip.assetId) : null
    const srcAspect = asset && asset.height > 0 ? asset.width / asset.height : 16 / 9
    if (srcAspect > targetAspect) {
      const inset = Math.max(0, Math.min(0.89, (1 - targetAspect / srcAspect) / 2))
      update(clip.id, { crop: { left: inset, right: inset, top: 0, bottom: 0 } })
    } else {
      const inset = Math.max(0, Math.min(0.89, (1 - srcAspect / targetAspect) / 2))
      update(clip.id, { crop: { left: 0, right: 0, top: inset, bottom: inset } })
    }
  }
  return (
    <Section title="Biến đổi">
      <SliderRow label="Tỉ lệ" value={t.scale} min={0.05} max={4} onCommitStart={push} onChange={(v) => update(clip.id, { scale: v })} />
      <SliderRow label="X" value={t.x} min={-1} max={1} onCommitStart={push} onChange={(v) => update(clip.id, { x: v })} />
      <SliderRow label="Y" value={t.y} min={-1} max={1} onCommitStart={push} onChange={(v) => update(clip.id, { y: v })} />
      <SliderRow
        label="Xoay"
        value={t.rotation}
        min={-180}
        max={180}
        step={1}
        format={(v) => `${v}°`}
        onCommitStart={push}
        onChange={(v) => update(clip.id, { rotation: v })}
      />
      <SliderRow
        label="Mờ dần"
        value={t.opacity}
        min={0}
        max={1}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommitStart={push}
        onChange={(v) => update(clip.id, { opacity: v })}
      />
      <div className="flex gap-1 pt-1">
        <button
          onClick={() => {
            push()
            update(clip.id, { flipX: !t.flipX })
          }}
          className={`flex flex-1 items-center justify-center gap-1 rounded bg-ink-800 py-1 text-[11px] hover:bg-ink-700 ${t.flipX ? 'text-accent' : 'text-ink-300'}`}
        >
          <FlipHorizontal2 size={12} /> Lật ngang
        </button>
        <button
          onClick={() => {
            push()
            update(clip.id, { flipY: !t.flipY })
          }}
          className={`flex flex-1 items-center justify-center gap-1 rounded bg-ink-800 py-1 text-[11px] hover:bg-ink-700 ${t.flipY ? 'text-accent' : 'text-ink-300'}`}
        >
          <FlipVertical2 size={12} /> Lật dọc
        </button>
      </div>
      <p className="pt-1 text-[11px] font-medium text-ink-300">Cắt khung</p>
      <div className="flex flex-wrap gap-1">
        <button onClick={() => cropPreset(null)} className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700">
          Đặt lại
        </button>
        <button onClick={() => cropPreset(1)} className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700">
          1:1
        </button>
        <button onClick={() => cropPreset(9 / 16)} className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700">
          9:16
        </button>
        <button onClick={() => cropPreset(4 / 5)} className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700">
          4:5
        </button>
        <button onClick={() => cropPreset(16 / 9)} className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700">
          16:9
        </button>
      </div>
      <SliderRow label="Cắt trái" value={t.crop.left} min={0} max={0.9} format={pct} onCommitStart={push} onChange={(v) => update(clip.id, { crop: { ...t.crop, left: v } })} />
      <SliderRow label="Cắt phải" value={t.crop.right} min={0} max={0.9} format={pct} onCommitStart={push} onChange={(v) => update(clip.id, { crop: { ...t.crop, right: v } })} />
      <SliderRow label="Cắt trên" value={t.crop.top} min={0} max={0.9} format={pct} onCommitStart={push} onChange={(v) => update(clip.id, { crop: { ...t.crop, top: v } })} />
      <SliderRow label="Cắt dưới" value={t.crop.bottom} min={0} max={0.9} format={pct} onCommitStart={push} onChange={(v) => update(clip.id, { crop: { ...t.crop, bottom: v } })} />
    </Section>
  )
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`
}

function KeyframeSection({ clip }: { clip: Clip }) {
  const playhead = useEditorStore((s) => s.playhead)
  const addKeyframe = useProjectStore.getState().addKeyframe
  const updateKeyframe = useProjectStore.getState().updateKeyframe
  const removeKeyframe = useProjectStore.getState().removeKeyframe
  const push = useProjectStore.getState().pushHistory
  const localTime = Math.max(0, Math.min(clip.duration, playhead - clip.start))
  const withVolumeKeyframes = clip.keyframes.some((k) => k.volume !== undefined)

  return (
    <Section title="Keyframe">
      <button
        onClick={() => {
          push()
          addKeyframe(clip.id, {
            time: localTime,
            scale: clip.transform.scale,
            x: clip.transform.x,
            y: clip.transform.y,
            rotation: clip.transform.rotation,
            opacity: clip.transform.opacity
          })
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent/20 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/30"
      >
        <Diamond size={12} /> Thêm keyframe tại playhead
      </button>
      {clip.kind === 'video' && (
        <button
          onClick={() => {
            push()
            addKeyframe(clip.id, { time: localTime, volume: clip.volume })
          }}
          className="mt-1 w-full rounded-md bg-ink-800 py-1.5 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-white"
        >
          Thêm keyframe âm lượng
        </button>
      )}
      {clip.keyframes.length === 0 ? (
        <p className="text-[11px] text-ink-400">Chưa có keyframe. Chỉnh transform rồi thêm keyframe để tạo chuyển động.</p>
      ) : (
        <ul className="max-h-36 space-y-1 overflow-y-auto">
          {clip.keyframes.map((k) => (
            <li key={k.id} className="rounded bg-ink-800 px-2 py-1 text-[11px]">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => useEditorStore.getState().setPlayhead(clip.start + k.time)}
                  className="text-ink-300 hover:text-white"
                  title="Nhảy tới keyframe"
                >
                  {formatTime(k.time)}
                </button>
                <span className="text-ink-400">
                  {k.volume !== undefined
                    ? `🔊 ${Math.round(k.volume * 100)}%`
                    : `×${k.scale?.toFixed(2)} · ${((k.opacity ?? 1) * 100).toFixed(0)}%`}
                </span>
                <button onClick={() => { push(); removeKeyframe(clip.id, k.id) }} className="text-ink-400 hover:text-red-400">
                  <Trash2 size={11} />
                </button>
              </div>
              <select
                value={k.easing ?? 'ease-in-out'}
                onChange={(e) => {
                  push()
                  updateKeyframe(clip.id, k.id, { easing: e.target.value as import('@shared/document').KeyframeEasing })
                }}
                className="mt-0.5 w-full rounded border border-ink-600 bg-ink-900 px-1 py-0.5 text-[10px] text-white outline-none"
              >
                <option value="ease-in-out">Mượt (mặc định)</option>
                <option value="linear">Tuyến tính</option>
                <option value="ease-in">Chậm vào</option>
                <option value="ease-out">Chậm ra</option>
                <option value="hold">Giữ (bước)</option>
              </select>
            </li>
          ))}
        </ul>
      )}
      {withVolumeKeyframes && (
        <p className="text-[10px] text-ink-500">Keyframe âm lượng áp dụng khi phát và khi xuất.</p>
      )}
    </Section>
  )
}

function EffectsSection({ clip }: { clip: Clip }) {
  const removeEffect = useProjectStore.getState().removeEffectFromClip
  const effects = clip.effects ?? []
  return (
    <Section title="Hiệu ứng">
      {effects.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-ink-500">
          Chưa có hiệu ứng. Chọn từ tab "Hiệu ứng" ở panel trái.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {effects.map((eff) => (
            <li
              key={eff.id}
              className="flex items-center justify-between rounded-md bg-ink-800/70 px-2 py-1.5 text-[11px] text-ink-200"
            >
              <span className="flex items-center gap-1.5 truncate">
                <Sparkles size={11} className="shrink-0 text-accent" />
                {eff.name}
                <span className="text-ink-500">
                  {formatTime(eff.start)} → {formatTime(eff.start + eff.duration)}
                </span>
              </span>
              <button
                onClick={() => removeEffect(clip.id, eff.id)}
                className="shrink-0 text-ink-500 hover:text-red-400"
                title="Gỡ hiệu ứng"
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function FilterSection({ clip }: { clip: Clip }) {
  const f = clip.filters
  const update = useProjectStore.getState().updateFilters
  const push = useProjectStore.getState().pushHistory
  return (
    <Section title="Màu sắc">
      <SliderRow label="Độ sáng" value={f.brightness} min={0.2} max={2} onCommitStart={push} onChange={(v) => update(clip.id, { brightness: v, presetId: null })} />
      <SliderRow label="Tương phản" value={f.contrast} min={0.2} max={2} onCommitStart={push} onChange={(v) => update(clip.id, { contrast: v, presetId: null })} />
      <SliderRow label="Đậm màu" value={f.saturation} min={0} max={2} onCommitStart={push} onChange={(v) => update(clip.id, { saturation: v, presetId: null })} />
      <SliderRow label="Phơi sáng" value={f.exposure} min={0.5} max={1.8} onCommitStart={push} onChange={(v) => update(clip.id, { exposure: v, presetId: null })} />
      <SliderRow
        label="Nhiệt độ"
        value={f.temperature}
        min={-1}
        max={1}
        format={(v) => (v > 0.02 ? `Ấm ${(v * 100).toFixed(0)}` : v < -0.02 ? `Lạnh ${(-v * 100).toFixed(0)}` : 'Trung tính')}
        onCommitStart={push}
        onChange={(v) => update(clip.id, { temperature: v, presetId: null })}
      />
      <SliderRow
        label="Sắc độ"
        value={f.hue}
        min={-1}
        max={1}
        format={(v) => `${Math.round(v * 90)}°`}
        onCommitStart={push}
        onChange={(v) => update(clip.id, { hue: v, presetId: null })}
      />
      <SliderRow label="Điểm sáng" value={f.highlights} min={-1} max={1} onCommitStart={push} onChange={(v) => update(clip.id, { highlights: v, presetId: null })} />
      <SliderRow label="Điểm tối" value={f.shadows} min={-1} max={1} onCommitStart={push} onChange={(v) => update(clip.id, { shadows: v, presetId: null })} />
      <button
        onClick={() => {
          push()
          update(clip.id, { ...NEUTRAL_FILTERS, presetId: null })
        }}
        className="flex items-center gap-1 text-[11px] text-ink-400 hover:text-white"
      >
        <RotateCcw size={11} /> Đặt lại
      </button>
    </Section>
  )
}

function MaskSection({ clip }: { clip: Clip }) {
  const mask = clip.mask ?? createMask()
  const update = useProjectStore.getState().updateClip
  const push = useProjectStore.getState().pushHistory
  const set = (patch: Partial<typeof mask>) => update(clip.id, { mask: { ...mask, ...patch } })
  return (
    <Section title="Mặt nạ">
      <select
        value={mask.shape}
        onChange={(e) => {
          push()
          set({ shape: e.target.value as MaskShape })
        }}
        className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
      >
        {MASK_SHAPES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {mask.shape !== 'none' && (
        <>
          <SliderRow label="Tâm X" value={mask.cx} min={0} max={1} onCommitStart={push} onChange={(v) => set({ cx: v })} />
          <SliderRow label="Tâm Y" value={mask.cy} min={0} max={1} onCommitStart={push} onChange={(v) => set({ cy: v })} />
          <SliderRow label="Bán ngang" value={mask.rx} min={0.02} max={1} onCommitStart={push} onChange={(v) => set({ rx: v })} />
          <SliderRow label="Bán dọc" value={mask.ry} min={0.02} max={1} onCommitStart={push} onChange={(v) => set({ ry: v })} />
          <SliderRow label="Xoay" value={mask.rotation} min={-180} max={180} step={1} format={(v) => `${v}°`} onCommitStart={push} onChange={(v) => set({ rotation: v })} />
          <SliderRow label="Làm mềm" value={mask.feather} min={0} max={1} onCommitStart={push} onChange={(v) => set({ feather: v })} />
          <label className="flex items-center justify-between text-xs">
            <span className="text-ink-300">Đảo ngược</span>
            <input type="checkbox" checked={mask.invert} onChange={(e) => { push(); set({ invert: e.target.checked }) }} className="accent-[#4f7cff]" />
          </label>
        </>
      )}
    </Section>
  )
}

function ChromaKeySection({ clip }: { clip: Clip }) {
  const chroma = clip.chromaKey ?? createChromaKey()
  const update = useProjectStore.getState().updateClip
  const push = useProjectStore.getState().pushHistory
  const set = (patch: Partial<typeof chroma>) => update(clip.id, { chromaKey: { ...chroma, ...patch } })
  return (
    <Section title="Khóa màu (nền xanh)">
      <label className="flex items-center justify-between text-xs">
        <span className="text-ink-300">Bật khóa màu</span>
        <input
          type="checkbox"
          checked={chroma.enabled}
          onChange={(e) => {
            push()
            set({ enabled: e.target.checked })
          }}
          className="accent-[#4f7cff]"
        />
      </label>
      {chroma.enabled && (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-300">Màu cần xóa</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => set({ color: '#00b140' })}
                className="h-6 w-6 rounded border border-ink-600 bg-[#00b140]"
                title="Xanh lá chuẩn"
              />
              <button
                onClick={() => set({ color: '#0000ff' })}
                className="h-6 w-6 rounded border border-ink-600 bg-blue-700"
                title="Xanh dương"
              />
              <input
                type="color"
                value={chroma.color}
                onChange={(e) => set({ color: e.target.value })}
                className="h-7 w-10 cursor-pointer rounded border border-ink-600 bg-transparent"
              />
            </div>
          </div>
          <SliderRow label="Độ giống" value={chroma.similarity} min={0} max={1} onCommitStart={push} onChange={(v) => set({ similarity: v })} />
          <SliderRow label="Làm mềm" value={chroma.smoothness} min={0} max={1} onCommitStart={push} onChange={(v) => set({ smoothness: v })} />
          <SliderRow label="Khử lem" value={chroma.spill} min={0} max={1} onCommitStart={push} onChange={(v) => set({ spill: v })} />
          <p className="text-[10px] leading-relaxed text-ink-500">
            Quay nhân vật trước nền xanh/đơn sắc rồi bật khóa màu để xóa nền.
          </p>
        </>
      )}
    </Section>
  )
}

function BlendSection({ clip }: { clip: Clip }) {
  const update = useProjectStore.getState().updateClip
  const push = useProjectStore.getState().pushHistory
  return (
    <Section title="Chế độ pha trộn">
      <select
        value={clip.blendMode ?? 'normal'}
        onChange={(e) => {
          push()
          update(clip.id, { blendMode: e.target.value as BlendMode })
        }}
        className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
      >
        {BLEND_MODES.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <p className="text-[10px] leading-relaxed text-ink-500">
        Pha trộn clip này với các lớp bên dưới (chỉ áp dụng cho phần nhìn thấy được).
      </p>
    </Section>
  )
}

function SpeedSection({ clip }: { clip: Clip }) {
  const update = useProjectStore.getState().updateClip
  const push = useProjectStore.getState().pushHistory
  const doc = useProjectStore.getState().doc
  const curve = clip.speedCurve
  const setSpeed = (v: number) => {
    const asset = clip.assetId ? doc.mediaLibrary.find((a) => a.id === clip.assetId) : null
    const maxDuration = asset && asset.kind !== 'image' ? (asset.duration - clip.inPoint) / v : Infinity
    update(clip.id, { speed: v, duration: Math.min((clip.duration * clip.speed) / v, Math.max(0.1, maxDuration)) })
  }
  return (
    <Section title="Tốc độ">
      <SliderRow
        label="Tốc độ"
        value={clip.speed}
        min={0.25}
        max={4}
        step={0.05}
        format={(v) => `${v.toFixed(2)}×`}
        onCommitStart={push}
        onChange={setSpeed}
      />
      <div className="flex gap-1">
        {[0.5, 1, 1.5, 2].map((s) => (
          <button
            key={s}
            onClick={() => {
              push()
              setSpeed(s)
            }}
            className={`flex-1 rounded bg-ink-800 py-1 text-[11px] hover:bg-ink-700 ${
              Math.abs(clip.speed - s) < 0.01 && !curve?.enabled ? 'text-accent' : 'text-ink-300'
            }`}
          >
            {s}×
          </button>
        ))}
      </div>
      <p className="pt-1 text-[11px] font-medium text-ink-300">Tốc độ biến thiên (ramp)</p>
      <label className="flex items-center justify-between text-xs">
        <span className="text-ink-300">Bật đường cong</span>
        <input
          type="checkbox"
          checked={curve?.enabled ?? false}
          onChange={(e) => {
            push()
            update(clip.id, {
              speedCurve: {
                enabled: e.target.checked,
                points: curve?.points ?? [{ t: 0, v: 0.5 }, { t: 1, v: 2 }]
              }
            })
          }}
          className="accent-[#4f7cff]"
        />
      </label>
      {curve?.enabled && (
        <>
          <div className="flex flex-wrap gap-1">
            {Object.entries(SPEED_CURVE_PRESETS).map(([id, preset]) => (
              <button
                key={id}
                onClick={() => {
                  push()
                  update(clip.id, { speedCurve: { enabled: true, points: preset.points.map((p) => ({ ...p })) } })
                }}
                className="rounded bg-ink-800 px-2 py-1 text-[10px] text-ink-300 hover:bg-ink-700 hover:text-white"
              >
                {preset.name}
              </button>
            ))}
          </div>
          <SliderRow
            label="Tốc đầu"
            value={curve.points[0]?.v ?? 1}
            min={0.25}
            max={4}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onCommitStart={push}
            onChange={(v) => {
              const points = curve.points.map((p) => ({ ...p }))
              points[0] = { ...points[0], v }
              update(clip.id, { speedCurve: { ...curve, points } })
            }}
          />
          <SliderRow
            label="Tốc cuối"
            value={curve.points[curve.points.length - 1]?.v ?? 1}
            min={0.25}
            max={4}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onCommitStart={push}
            onChange={(v) => {
              const points = curve.points.map((p) => ({ ...p }))
              points[points.length - 1] = { ...points[points.length - 1], v }
              update(clip.id, { speedCurve: { ...curve, points } })
            }}
          />
          <p className="text-[10px] text-ink-500">Âm thanh đi theo biến thiên tốc độ khi xuất.</p>
        </>
      )}
    </Section>
  )
}

function AudioEffectSection({ clip }: { clip: Clip }) {
  const update = useProjectStore.getState().updateClip
  const push = useProjectStore.getState().pushHistory
  const effect = clip.audioEffect ?? 'none'
  return (
    <Section title="Hiệu ứng âm thanh">
      <select
        value={effect}
        onChange={(e) => {
          push()
          update(clip.id, { audioEffect: e.target.value as AudioEffectKind })
        }}
        className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
      >
        {AUDIO_EFFECTS.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <p className="text-[10px] leading-relaxed text-ink-500">
        {effect === 'high-pitch' || effect === 'low-pitch'
          ? 'Tông cao/trầm áp dụng đầy đủ khi xuất; bản nghe trước giữ nguyên cao độ.'
          : 'Nghe thử trực tiếp trong preview và áp dụng khi xuất.'}
      </p>
    </Section>
  )
}

function TransitionQuickSection({ clip }: { clip: Clip }) {
  const setTransition = useProjectStore.getState().setTransition
  const push = useProjectStore.getState().pushHistory
  return (
    <Section title="Chuyển cảnh (vào)">
      <select
        value={clip.transitionIn?.type ?? ''}
        onChange={(e) => {
          push()
          const type = e.target.value
          if (!type) {
            setTransition(clip.id, null)
          } else {
            setTransition(clip.id, {
              type: type as import('@shared/document').TransitionType,
              duration: clip.transitionIn?.duration ?? Math.min(1, clip.duration * 0.4)
            })
          }
        }}
        className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
      >
        <option value="">Không</option>
        {TRANSITION_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      {clip.transitionIn && (
        <SliderRow
          label="Thời lượng"
          value={clip.transitionIn.duration}
          min={0.2}
          max={Math.max(0.3, Math.min(3, clip.duration * 0.8))}
          format={(v) => `${v.toFixed(1)}s`}
          onCommitStart={push}
          onChange={(v) =>
            setTransition(clip.id, { ...clip.transitionIn!, duration: v })
          }
        />
      )}
    </Section>
  )
}

function AudioSection({ clip }: { clip: Clip }) {
  const update = useProjectStore.getState().updateClip
  const push = useProjectStore.getState().pushHistory
  return (
    <Section title="Âm thanh">
      <SliderRow
        label="Âm lượng"
        value={clip.volume}
        min={0}
        max={2}
        format={(v) => `${Math.round(v * 100)}%`}
        onCommitStart={push}
        onChange={(v) => update(clip.id, { volume: v })}
      />
      <SliderRow label="Fade in" value={clip.fadeIn} min={0} max={Math.min(5, clip.duration / 2)} step={0.1} format={(v) => `${v.toFixed(1)}s`} onCommitStart={push} onChange={(v) => update(clip.id, { fadeIn: v })} />
      <SliderRow label="Fade out" value={clip.fadeOut} min={0} max={Math.min(5, clip.duration / 2)} step={0.1} format={(v) => `${v.toFixed(1)}s`} onCommitStart={push} onChange={(v) => update(clip.id, { fadeOut: v })} />
    </Section>
  )
}

function TextSection({ clip }: { clip: Clip }) {
  const text = clip.text!
  const update = useProjectStore.getState().updateText
  const push = useProjectStore.getState().pushHistory
  return (
    <>
      <Section title="Nội dung">
        <textarea
          value={text.content}
          onChange={(e) => update(clip.id, { content: e.target.value })}
          onFocus={push}
          rows={3}
          className="w-full resize-none rounded-md border border-ink-600 bg-ink-800 p-2 text-xs text-white outline-none focus:border-accent"
        />
        <select
          value={text.fontFamily}
          onChange={(e) => update(clip.id, { fontFamily: e.target.value })}
          className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
        >
          {FONT_FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <button
            onClick={() => update(clip.id, { bold: !text.bold })}
            className={`flex-1 rounded bg-ink-800 py-1 text-xs font-bold hover:bg-ink-700 ${text.bold ? 'text-accent' : 'text-white'}`}
          >
            B
          </button>
          <button
            onClick={() => update(clip.id, { italic: !text.italic })}
            className={`flex-1 rounded bg-ink-800 py-1 text-xs italic hover:bg-ink-700 ${text.italic ? 'text-accent' : 'text-white'}`}
          >
            I
          </button>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              onClick={() => update(clip.id, { align: a })}
              className={`flex-1 rounded bg-ink-800 py-1 text-[10px] uppercase hover:bg-ink-700 ${text.align === a ? 'text-accent' : 'text-white'}`}
            >
              {a === 'left' ? '◀' : a === 'center' ? '◆' : '▶'}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Kiểu chữ">
        <SliderRow label="Cỡ chữ" value={text.fontSize} min={0.02} max={0.3} format={(v) => `${Math.round(v * 100)}`} onCommitStart={push} onChange={(v) => update(clip.id, { fontSize: v })} />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-ink-300">Màu chữ</span>
          <div className="flex items-center gap-1">
            <input type="color" value={text.color} onChange={(e) => update(clip.id, { color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-ink-600 bg-transparent" />
            <input type="color" value={text.strokeColor} title="Màu viền" onChange={(e) => update(clip.id, { strokeColor: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-ink-600 bg-transparent" />
            <input
              type="color"
              value={text.backgroundColor ?? '#000000'}
              title="Nền"
              onChange={(e) => update(clip.id, { backgroundColor: e.target.value + 'cc' })}
              className="h-7 w-10 cursor-pointer rounded border border-ink-600 bg-transparent"
            />
          </div>
        </div>
        <SliderRow label="Viền" value={text.strokeWidth} min={0} max={0.15} format={(v) => `${Math.round(v * 100)}`} onCommitStart={push} onChange={(v) => update(clip.id, { strokeWidth: v })} />
        <SliderRow label="Vị trí X" value={text.x} min={0} max={1} onCommitStart={push} onChange={(v) => update(clip.id, { x: v })} />
        <SliderRow label="Vị trí Y" value={text.y} min={0} max={1} onCommitStart={push} onChange={(v) => update(clip.id, { y: v })} />
        <SliderRow label="Rộng dòng" value={text.maxWidth} min={0.2} max={1} onCommitStart={push} onChange={(v) => update(clip.id, { maxWidth: v })} />
      </Section>
      <Section title="Hoạt ảnh chữ">
        <label className="block text-xs text-ink-300">
          Vào
          <select
            value={text.animation?.in ?? 'none'}
            onChange={(e) => {
              push()
              update(clip.id, {
                animation: {
                  in: e.target.value as TextAnimationKind,
                  out: text.animation?.out ?? 'none',
                  duration: text.animation?.duration ?? 0.5
                }
              })
            }}
            className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
          >
            {TEXT_ANIMATIONS.map((a) => (
              <option key={`in-${a.id}`} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-ink-300">
          Ra
          <select
            value={text.animation?.out ?? 'none'}
            onChange={(e) => {
              push()
              update(clip.id, {
                animation: {
                  in: text.animation?.in ?? 'none',
                  out: e.target.value as TextAnimationKind,
                  duration: text.animation?.duration ?? 0.5
                }
              })
            }}
            className="mt-1 w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
          >
            {TEXT_ANIMATIONS.map((a) => (
              <option key={`out-${a.id}`} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {(text.animation?.in !== 'none' || text.animation?.out !== 'none') && (
          <SliderRow
            label="Thời lượng"
            value={text.animation?.duration ?? 0.5}
            min={0.2}
            max={Math.max(0.3, clip.duration / 2)}
            step={0.1}
            format={(v) => `${v.toFixed(1)}s`}
            onCommitStart={push}
            onChange={(v) =>
              update(clip.id, {
                animation: {
                  in: text.animation?.in ?? 'none',
                  out: text.animation?.out ?? 'none',
                  duration: v
                }
              })
            }
          />
        )}
      </Section>
    </>
  )
}

function StickerSection({ clip }: { clip: Clip }) {
  const st = clip.sticker!
  const update = useProjectStore.getState().updateClip
  const push = useProjectStore.getState().pushHistory
  const set = (patch: Partial<typeof st>) => update(clip.id, { sticker: { ...st, ...patch } })
  return (
    <>
      <Section title="Sticker">
        <input
          value={st.emoji}
          onChange={(e) => set({ emoji: e.target.value.slice(0, 8) })}
          className="w-full rounded-md border border-ink-600 bg-ink-800 p-2 text-center text-2xl outline-none focus:border-accent"
          placeholder="Chọn emoji ở panel Sticker"
        />
        <SliderRow label="Kích thước" value={st.size} min={0.05} max={1.2} format={pct} onCommitStart={push} onChange={(v) => set({ size: v })} />
        <SliderRow label="Vị trí X" value={st.x} min={0} max={1} onCommitStart={push} onChange={(v) => set({ x: v })} />
        <SliderRow label="Vị trí Y" value={st.y} min={0} max={1} onCommitStart={push} onChange={(v) => set({ y: v })} />
        <SliderRow label="Xoay" value={st.rotation} min={-180} max={180} step={1} format={(v) => `${v}°`} onCommitStart={push} onChange={(v) => set({ rotation: v })} />
        <SliderRow label="Mờ dần" value={st.opacity} min={0} max={1} format={pct} onCommitStart={push} onChange={(v) => set({ opacity: v })} />
        <label className="flex items-center justify-between text-xs">
          <span className="text-ink-300">Lật ngang</span>
          <input type="checkbox" checked={st.flipX} onChange={(e) => { push(); set({ flipX: e.target.checked }) }} className="accent-[#4f7cff]" />
        </label>
      </Section>
      <TransformSection clip={clip} />
      <KeyframeSection clip={clip} />
    </>
  )
}
