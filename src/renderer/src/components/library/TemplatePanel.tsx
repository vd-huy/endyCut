import { useState } from 'react'
import { Download, LayoutTemplate, Link2, ListVideo, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../store/projectStore'
import { useEditorStore } from '../../store/editorStore'
import {
  importTemplateFromLink,
  importDraftFromFolder,
  listCapcutDrafts,
  type TemplateImportOutcome
} from '../../core/template/templateImport'
import type { CapcutDraftInfo } from '../../../../preload'
import { mediaUrlFor } from '../../core/media/assets'
import { formatDuration } from '../../lib/format'

export default function TemplatePanel() {
  const templateRef = useProjectStore((s) => s.doc.templateRef)
  const docDuration = useProjectStore((s) => {
    let end = 0
    for (const t of s.doc.tracks) {
      for (const c of t.clips) end = Math.max(end, c.start + c.duration)
    }
    return end
  })
  const setNotice = useEditorStore((s) => s.setImportNotice)

  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<TemplateImportOutcome | null>(null)
  const [drafts, setDrafts] = useState<CapcutDraftInfo[] | null>(null)

  const notice = (text: string) => {
    setNotice(text)
    setStatus(text)
  }

  const runFromLink = async () => {
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    setOutcome(null)
    try {
      const result = await importTemplateFromLink(url, notice)
      setOutcome(result)
      setDrafts(null)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
      setNotice(null)
      setStatus('')
    }
  }

  const runDraftImport = async (folder?: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setOutcome(null)
    try {
      let target = folder
      if (!target) {
        notice('Đang quét draft CapCut trên máy…')
        const found = await listCapcutDrafts()
        setDrafts(found)
        const candidate = found.find((d) => d.templateId === templateRef?.templateId) ?? found[0]
        if (!candidate) {
          setError(
            'Không tìm thấy draft CapCut nào. Mở mẫu trong CapCut (desktop) rồi thử lại, hoặc chờ CapCut tải xong draft.'
          )
          return
        }
        target = candidate.folder
      }
      const result = await importDraftFromFolder(target, notice)
      setOutcome({
        stage: 'draft',
        meta: null,
        warnings: result.warnings,
        message: 'Đã dựng đầy đủ timeline theo draft CapCut. Kiểm tra rồi xuất video.'
      })
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
      setNotice(null)
      setStatus('')
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-300">
        <LayoutTemplate size={14} className="text-accent" /> Dựng video theo mẫu CapCut
      </div>

      <div className="rounded-lg bg-ink-800/70 p-2.5 text-[11px] leading-relaxed text-ink-400">
        Dán link mẫu (những mẫu cần Pro trong CapCut) — chấp nhận cả link
        template-detail lẫn link web editor (editor-template). CutClone sẽ tự
        dựng lại theo mẫu để bạn thay media của mình rồi xuất video.
      </div>

      <div className="flex items-center gap-1.5 rounded-md bg-ink-800 px-2 py-1.5">
        <Link2 size={13} className="shrink-0 text-ink-400" />
        <input
          placeholder="https://www.capcut.com/template-detail/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runFromLink()
          }}
          className="w-full bg-transparent text-xs text-white outline-none"
        />
      </div>
      <button
        onClick={() => void runFromLink()}
        disabled={busy || !url.trim()}
        className="flex items-center justify-center gap-1.5 rounded-md bg-accent/90 px-3 py-2 text-xs font-semibold text-white hover:bg-accent disabled:opacity-40"
      >
        <Download size={14} /> {busy ? 'Đang xử lý…' : 'Tự dựng theo mẫu'}
      </button>

      {(busy || status) && <div className="text-[11px] text-accent">{status}</div>}
      {error && (
        <div className="rounded-md bg-red-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-red-300">
          {error}
        </div>
      )}

      {outcome && (
        <div className="flex flex-col gap-2 rounded-lg border border-ink-700/60 bg-ink-800/50 p-2.5">
          {outcome.meta && (
            <div className="flex gap-2">
              {outcome.meta.coverUrl && templateRef?.coverPath && (
                <img
                  src={mediaUrlFor(templateRef.coverPath)}
                  alt=""
                  className="h-16 w-9 shrink-0 rounded object-cover"
                />
              )}
              <div className="min-w-0 text-[11px] text-ink-300">
                <div className="truncate font-semibold text-white">{outcome.meta.title}</div>
                {outcome.meta.authorName && (
                  <div className="truncate text-ink-400">bởi {outcome.meta.authorName}</div>
                )}
                <div className="text-ink-400">
                  {outcome.meta.width}×{outcome.meta.height}
                  {outcome.meta.durationMs > 0 && ` · ${formatDuration(outcome.meta.durationMs / 1000)}`}
                  {outcome.meta.segmentAmount > 0 && ` · ${outcome.meta.segmentAmount} đoạn`}
                </div>
              </div>
            </div>
          )}
          <div
            className={`rounded-md px-2.5 py-2 text-[11px] leading-relaxed ${
              outcome.stage === 'draft'
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-amber-500/10 text-amber-200'
            }`}
          >
            {outcome.message}
          </div>
          {outcome.warnings.map((w, i) => (
            <div key={i} className="text-[10px] leading-relaxed text-ink-400">
              • {w}
            </div>
          ))}
        </div>
      )}

      {templateRef && (
        <div className="rounded-lg bg-ink-800/70 px-2.5 py-2 text-[11px] text-ink-300">
          <div className="flex items-center justify-between">
            <span className="truncate font-semibold">Mẫu hiện tại: {templateRef.title}</span>
            <span
              className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                templateRef.stage === 'draft' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-200'
              }`}
            >
              {templateRef.stage === 'draft' ? 'ĐẦY ĐỦ' : 'KHUNG'}
            </span>
          </div>
          <div className="mt-1 text-ink-500">Thời lượng timeline: {formatDuration(docDuration)}</div>
        </div>
      )}

      <div className="mt-1 border-t border-ink-700/60 pt-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-300">
          <ListVideo size={14} className="text-accent" /> Nhập draft từ CapCut
        </div>
        <div className="rounded-lg bg-ink-800/70 p-2.5 text-[11px] leading-relaxed text-ink-400">
          Mở mẫu trong CapCut một lần (nút <b>Dùng mẫu</b> — mở là tải, không cần xuất). Sau đó bấm
          nút dưới để CutClone đọc draft đó và dựng lại toàn bộ clip, chữ, tốc độ, chuyển cảnh.
        </div>
        <button
          onClick={() => void runDraftImport()}
          disabled={busy}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-ink-700/80 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-700 disabled:opacity-40"
        >
          <RefreshCw size={13} /> Nhập draft từ CapCut
        </button>

        {drafts && drafts.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {drafts.slice(0, 8).map((d) => (
              <button
                key={d.folder}
                onClick={() => void runDraftImport(d.folder)}
                disabled={busy}
                className="flex items-center justify-between rounded-md bg-ink-800/70 px-2.5 py-2 text-left text-[11px] text-ink-300 hover:bg-ink-800"
              >
                <span className="truncate">{d.name}</span>
                <span className="ml-2 shrink-0 text-[10px] text-ink-500">
                  {new Date(d.modifiedAt).toLocaleDateString('vi-VN')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
