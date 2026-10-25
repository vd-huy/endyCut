import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FolderOpen, Loader2, X } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { useProjectStore } from '../store/projectStore'
import { documentDuration } from '../core/playback'
import {
  DEFAULT_EXPORT_SETTINGS,
  isAbortError,
  renderProject,
  type ExportFormat,
  type ExportQuality
} from '../core/export/exportVideo'
import { formatDuration } from '../lib/format'

const RESOLUTION_OPTIONS: Array<{ label: string; scale: number }> = [
  { label: 'Đầy đủ', scale: 1 },
  { label: '720p', scale: 720 / 1080 },
  { label: '480p', scale: 480 / 1080 },
  { label: '2K', scale: 1440 / 1080 },
  { label: '4K', scale: 2160 / 1080 }
]

const QUALITY_OPTIONS: Array<{ label: string; value: ExportQuality }> = [
  { label: 'Thấp (file nhỏ)', value: 'low' },
  { label: 'Trung bình', value: 'medium' },
  { label: 'Cao (khuyên dùng)', value: 'high' },
  { label: 'Tùy chỉnh bitrate', value: 'custom' }
]

const FPS_OPTIONS = [24, 25, 30, 50, 60]

export default function ExportModal() {
  const exportState = useEditorStore((s) => s.exportState)
  const setExportState = useEditorStore((s) => s.setExportState)
  const doc = useProjectStore((s) => s.doc)
  const abortRef = useRef(false)

  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [scale, setScale] = useState(1)
  const [fps, setFps] = useState(0) // 0 = theo dự án
  const [quality, setQuality] = useState<ExportQuality>('high')
  const [customBitrate, setCustomBitrate] = useState(12)
  const [audioBitrate, setAudioBitrate] = useState(192)

  // Close with Escape while idle. Must live above the early return (rules of
  // hooks) — the modal mounts/unmounts with exportState.open.
  const running = exportState.running
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !running) {
        setExportState({ open: false, progress: 0, stage: '', error: null, outputPath: null })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, setExportState])

  if (!exportState.open) return null

  const duration = documentDuration(doc)
  const outW = Math.round(doc.settings.width * scale)
  const outH = Math.round(doc.settings.height * scale)
  const outFps = fps > 0 ? fps : doc.settings.fps
  const estVideoBitrate =
    quality === 'custom'
      ? customBitrate * 1_000_000
      : Math.min(40e6, Math.max(1.5e6, outW * outH * outFps * 0.14 * (quality === 'low' ? 0.55 : quality === 'medium' ? 1 : 1.7)))
  const estSizeMb = ((estVideoBitrate + audioBitrate * 1000) * duration) / 8 / 1_000_000

  const start = async () => {
    abortRef.current = false
    setExportState({ running: true, progress: 0, stage: 'Đang chuẩn bị…', error: null, outputPath: null })
    try {
      const { buffer, extension } = await renderProject(doc, {
        onProgress: (progress: number, stage: string) => setExportState({ progress, stage }),
        signal: {
          get aborted() {
            return abortRef.current
          }
        },
        settings: { format, resolutionScale: scale, fps, quality, audioBitrate: audioBitrate * 1000, customBitrate: customBitrate * 1_000_000 }
      })
      // Test hook: an automated run can pre-set the save path via localStorage.
      const testPath = localStorage.getItem('cc-test-export-path')
      let path = testPath
      if (testPath) {
        localStorage.removeItem('cc-test-export-path')
      } else {
        path = await window.api.pickExportSavePath(extension)
      }
      if (!path) {
        setExportState({ running: false, stage: 'Đã hủy', progress: 0 })
        return
      }
      setExportState({ stage: 'Đang ghi file…' })
      await window.api.writeExportFile(path, buffer)
      setExportState({ running: false, progress: 1, stage: 'Hoàn tất!', outputPath: path })
    } catch (error) {
      if (isAbortError(error)) {
        setExportState({ running: false, stage: 'Đã hủy', progress: 0 })
      } else {
        console.error(error)
        setExportState({ running: false, error: String(error), stage: 'Lỗi' })
      }
    }
  }

  const close = () => {
    if (exportState.running) return
    setExportState({ open: false, progress: 0, stage: '', error: null, outputPath: null })
  }

  const selectClass =
    'w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none focus:border-accent'

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="max-h-[92vh] w-[480px] overflow-y-auto rounded-2xl border border-ink-600 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Xuất video</h2>
          {!exportState.running && (
            <button onClick={close} className="text-ink-400 hover:text-white">
              <X size={18} />
            </button>
          )}
        </div>

        {exportState.progress === 0 && !exportState.running && (
          <div className="mb-4 grid grid-cols-2 gap-3">
            <label className="col-span-2 block text-xs text-ink-300">
              Định dạng
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ExportFormat)}
                className={`${selectClass} mt-1`}
              >
                <option value="mp4">MP4 (H.264 + AAC) — tương thích cao nhất</option>
                <option value="webm">WebM (VP9 + Opus) — dung lượng nhỏ</option>
              </select>
            </label>
            <label className="block text-xs text-ink-300">
              Độ phân giải
              <select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className={`${selectClass} mt-1`}
              >
                {RESOLUTION_OPTIONS.map((opt) => (
                  <option key={opt.label} value={opt.scale}>
                    {opt.label} ({Math.round(doc.settings.width * opt.scale)}×{Math.round(doc.settings.height * opt.scale)})
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-300">
              Khung hình
              <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className={`${selectClass} mt-1`}>
                <option value={0}>Theo dự án ({doc.settings.fps} fps)</option>
                {FPS_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-300">
              Chất lượng
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value as ExportQuality)}
                className={`${selectClass} mt-1`}
              >
                {QUALITY_OPTIONS.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-ink-300">
              Âm thanh
              <select
                value={audioBitrate}
                onChange={(e) => setAudioBitrate(Number(e.target.value))}
                className={`${selectClass} mt-1`}
              >
                <option value={128}>128 kbps</option>
                <option value={192}>192 kbps</option>
                <option value={256}>256 kbps</option>
                <option value={320}>320 kbps</option>
              </select>
            </label>
            {quality === 'custom' && (
              <label className="col-span-2 block text-xs text-ink-300">
                Bitrate video: <span className="text-white">{customBitrate} Mbps</span>
                <input
                  type="range"
                  min={2}
                  max={40}
                  step={1}
                  value={customBitrate}
                  onChange={(e) => setCustomBitrate(Number(e.target.value))}
                  className="mt-1 w-full accent-[#4f7cff]"
                />
              </label>
            )}
            <div className="col-span-2 rounded-lg bg-ink-800 p-3 text-xs text-ink-300">
              <div className="flex justify-between">
                <span>Đầu ra</span>
                <span className="text-white">
                  {format.toUpperCase()} · {outW}×{outH} · {outFps} fps
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span>Thời lượng</span>
                <span className="text-white">{formatDuration(duration)}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span>Dung lượng ước tính</span>
                <span className="text-white">≈ {estSizeMb < 1 ? '< 1' : Math.round(estSizeMb)} MB</span>
              </div>
            </div>
          </div>
        )}

        {exportState.running || exportState.progress > 0 ? (
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-ink-300">{exportState.stage || 'Sẵn sàng'}</span>
              <span className="tabular-nums text-white">{Math.round(exportState.progress * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${exportState.progress * 100}%` }}
              />
            </div>
          </div>
        ) : null}

        {exportState.error && (
          <p className="mb-3 rounded-md bg-red-950/60 p-2 text-xs text-red-300">{exportState.error}</p>
        )}

        {exportState.outputPath && (
          <div className="mb-3 flex items-center gap-2 rounded-md bg-emerald-950/50 p-2.5 text-xs text-emerald-300">
            <CheckCircle2 size={16} />
            <span className="flex-1 truncate">Đã lưu: {exportState.outputPath}</span>
            <button
              onClick={async () => {
                const ok = await window.api.showItemInFolder(exportState.outputPath!)
                if (!ok) window.alert('Không mở được thư mục chứa video. Thư mục có thể đã bị di chuyển hoặc xóa.')
              }}
              className="flex items-center gap-1 rounded bg-emerald-900/60 px-2 py-1 hover:bg-emerald-800/60"
            >
              <FolderOpen size={12} /> Mở thư mục
            </button>
          </div>
        )}

        <div className="flex gap-2">
          {!exportState.running && exportState.progress === 0 && (
            <button
              onClick={() => void start()}
              className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-soft"
            >
              Bắt đầu xuất
            </button>
          )}
          {!exportState.running && exportState.progress > 0 && !exportState.outputPath && exportState.error === null && (
            <button
              onClick={() => void start()}
              className="flex-1 rounded-lg bg-accent py-2 text-sm font-semibold text-white hover:bg-accent-soft"
            >
              Xuất lại
            </button>
          )}
          {exportState.running && (
            <button
              onClick={() => {
                abortRef.current = true
              }}
              className="flex-1 rounded-lg bg-red-950/70 py-2 text-sm font-semibold text-red-300 hover:bg-red-900/70"
            >
              Hủy
            </button>
          )}
          {(exportState.outputPath || exportState.error) && !exportState.running && (
            <button onClick={close} className="flex-1 rounded-lg bg-ink-700 py-2 text-sm text-white hover:bg-ink-600">
              Đóng
            </button>
          )}
        </div>

        {exportState.running && (
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-ink-400">
            <Loader2 size={12} className="animate-spin" /> Đừng tắt cửa sổ trong lúc kết xuất.
          </p>
        )}
      </div>
    </div>
  )
}

// Keep the default settings referenced so tree-shaking doesn't complain in tests.
void DEFAULT_EXPORT_SETTINGS
