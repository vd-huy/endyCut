import { useEffect, useState } from 'react'
import { Captions, Download, Heading1, Loader2, Quote, Type, Volume2 } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { useEditorStore } from '../../store/editorStore'
import { createText } from '@shared/document'
import { buildSrt, parseSrt } from '../../lib/srt'
import { importAssets } from '../../core/media/assets'
import type { TtsVoice } from '../../../../preload'

const PRESETS = [
  { name: 'Tiêu đề', icon: Heading1, patch: { fontSize: 0.12, bold: true } },
  { name: 'Phụ đề', icon: Quote, patch: { fontSize: 0.055, bold: false, y: 0.85, backgroundColor: '#000000cc' } },
  { name: 'Chữ thường', icon: Type, patch: { fontSize: 0.07, bold: false } }
]

export default function TextPanel() {
  const playhead = useEditorStore((s) => s.playhead)
  const addTextClip = useProjectStore((s) => s.addTextClip)
  const setImportNotice = useEditorStore((s) => s.setImportNotice)

  // Text-to-speech (Windows SAPI, offline).
  const [voices, setVoices] = useState<TtsVoice[]>([])
  const [voice, setVoice] = useState('')
  const [rate, setRate] = useState(0)
  const [ttsText, setTtsText] = useState('')
  const [ttsBusy, setTtsBusy] = useState(false)

  useEffect(() => {
    window.api
      .listTtsVoices()
      .then((v) => {
        setVoices(v)
        if (v.length > 0) setVoice(v[0].name)
      })
      .catch(() => setVoices([]))
  }, [])

  const speak = async () => {
    if (!ttsText.trim()) return
    setTtsBusy(true)
    setImportNotice('Đang tạo giọng đọc…')
    try {
      const wavPath = await window.api.synthesizeSpeech(ttsText, voice, rate)
      await importAssets([wavPath], (asset) => useProjectStore.getState().addAssetsToLibrary([asset]), () => {})
      const project = useProjectStore.getState()
      const asset = project.doc.mediaLibrary[project.doc.mediaLibrary.length - 1]
      if (asset) project.addAssetToTimeline(asset.id, playhead)
      setImportNotice('Đã tạo giọng đọc và thêm vào timeline.')
      setTimeout(() => setImportNotice(null), 2500)
    } catch (error) {
      console.error(error)
      setImportNotice(null)
      window.alert(`Không tạo được giọng đọc: ${String(error)}`)
    } finally {
      setTtsBusy(false)
    }
  }

  const importSrt = async () => {
    const path = await window.api.pickSrtOpenPath()
    if (!path) return
    try {
      const content = await window.api.readSrt(path)
      const cues = parseSrt(content)
      if (cues.length === 0) {
        window.alert('Không đọc được phụ đề nào từ tệp này.')
        return
      }
      useProjectStore.getState().addSrtCaptions(cues)
    } catch (error) {
      window.alert(`Lỗi đọc SRT: ${String(error)}`)
    }
  }

  const exportSrt = async () => {
    const cues = useProjectStore.getState().collectTextCues()
    if (cues.length === 0) {
      window.alert('Không có clip chữ nào để xuất phụ đề.')
      return
    }
    const path = await window.api.pickSrtSavePath()
    if (!path) return
    try {
      await window.api.writeSrt(path, buildSrt(cues))
    } catch (error) {
      window.alert(`Lỗi ghi SRT: ${String(error)}`)
    }
  }

  return (
    <div className="p-3">
      <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
        Thêm chữ vào timeline. Chọn clip chữ rồi chỉnh nội dung, font và màu ở panel bên phải.
      </p>
      <div className="space-y-2">
        {PRESETS.map(({ name, icon: Icon, patch }) => (
          <button
            key={name}
            onClick={() => {
              const id = addTextClip(playhead)
              if (id) {
                const project = useProjectStore.getState()
                const text = project.findClip(id)?.clip.text
                if (text) project.updateText(id, { ...createText(), ...patch, content: name === 'Phụ đề' ? 'Phụ đề của bạn' : 'Nhập chữ của bạn' })
              }
            }}
            className="flex w-full items-center gap-3 rounded-lg bg-ink-800 px-3 py-3 text-left text-sm text-white ring-1 ring-ink-700 hover:ring-accent"
          >
            <Icon size={18} className="text-accent" />
            {name}
          </button>
        ))}
      </div>

      <div className="mt-5 border-t border-ink-700/60 pt-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white">
          <Volume2 size={13} className="text-accent" /> Chữ thành giọng đọc (TTS)
        </h3>
        {voices.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-ink-500">
            Không tìm thấy giọng đọc SAPI trên máy này. TTS chỉ chạy trên Windows có giọng đọc cài sẵn.
          </p>
        ) : (
          <div className="space-y-2">
            <textarea
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value)}
              rows={3}
              placeholder="Nhập lời đọc…"
              className="w-full resize-none rounded-md border border-ink-600 bg-ink-800 p-2 text-xs text-white outline-none placeholder:text-ink-500 focus:border-accent"
            />
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
              className="w-full rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-xs text-white outline-none"
            >
              {voices.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.culture})
                </option>
              ))}
            </select>
            <label className="block text-[10px] text-ink-400">
              Tốc độ đọc: {rate > 0 ? `+${rate}` : rate}{' '}
              <input
                type="range"
                min={-5}
                max={5}
                step={1}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-full accent-[#4f7cff]"
              />
            </label>
            <button
              onClick={() => void speak()}
              disabled={ttsBusy || !ttsText.trim()}
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent py-1.5 text-xs font-semibold text-white hover:bg-accent-soft disabled:opacity-50"
            >
              {ttsBusy ? <Loader2 size={13} className="animate-spin" /> : <Volume2 size={13} />}
              Tạo giọng đọc
            </button>
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-ink-700/60 pt-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white">
          <Captions size={13} className="text-accent" /> Phụ đề SRT
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => void importSrt()}
            className="flex-1 rounded-md bg-ink-800 py-1.5 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-white"
          >
            Nhập tệp SRT
          </button>
          <button
            onClick={() => void exportSrt()}
            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-ink-800 py-1.5 text-[11px] text-ink-300 hover:bg-ink-700 hover:text-white"
          >
            <Download size={11} /> Xuất SRT
          </button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
          Nhập SRT sẽ tạo track "Phụ đề" với các clip chữ theo thời gian; xuất SRT lấy toàn bộ clip chữ trên timeline.
        </p>
      </div>
    </div>
  )
}
