import { ArrowUpCircle, Download, RefreshCw, Rocket, X } from 'lucide-react'
import type { UpdateState } from '../../../preload'

const RELEASES_URL = 'https://github.com/vd-huy/endyCut/releases/latest'

/**
 * CapCut-style update dialog: shows the check result, drives the download
 * with a progress bar and restarts into the new version. Rendered from the
 * TopBar's update pill or the manual "Kiểm tra cập nhật" button.
 */
export default function UpdateModal({ state, onClose }: { state: UpdateState; onClose: () => void }) {
  const { status, currentVersion, availableVersion, progressPercent, error } = state

  const title =
    status === 'available' || status === 'downloading' || status === 'downloaded'
      ? `Có phiên bản mới v${availableVersion ?? ''}`
      : status === 'checking'
        ? 'Đang kiểm tra cập nhật…'
        : status === 'error'
          ? 'Không kiểm tra được cập nhật'
          : 'Bạn đang dùng bản mới nhất'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-[400px] rounded-2xl border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <ArrowUpCircle size={22} className="text-accent" />
            <h2 className="text-base font-semibold text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {status === 'checking' && (
          <p className="mb-4 text-xs text-ink-400">Đang hỏi GitHub Releases xem có bản mới hơn v{currentVersion} không…</p>
        )}

        {status === 'not-available' && (
          <p className="mb-4 text-xs text-ink-400">
            EndyCut v{currentVersion} đã là phiên bản mới nhất.
          </p>
        )}

        {(status === 'idle') && (
          <p className="mb-4 text-xs text-ink-400">
            {state.supported
              ? `Phiên bản hiện tại: v${currentVersion}. Bấm "Kiểm tra lại" để hỏi GitHub.`
              : 'Tự động cập nhật chỉ hoạt động trên bản cài đặt (build đã đóng gói). Trong môi trường dev hãy pull code mới từ GitHub.'}
          </p>
        )}

        {status === 'available' && (
          <>
            <p className="mb-4 text-xs leading-relaxed text-ink-400">
              Bạn đang dùng v{currentVersion}. Tải về bản v{availableVersion} rồi cài đặt lại — ứng dụng sẽ tự
              khởi động lại vào bản mới.
            </p>
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => void window.api.updatesDownload()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-soft"
              >
                <Download size={14} /> Tải về bản mới
              </button>
              <button
                onClick={() => void window.api.openExternal(RELEASES_URL)}
                className="rounded-lg bg-ink-800 px-3 py-2 text-xs text-ink-300 hover:bg-ink-700 hover:text-white"
                title="Xem trang Releases trên GitHub"
              >
                GitHub
              </button>
            </div>
          </>
        )}

        {status === 'downloading' && (
          <>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round(progressPercent ?? 0)}%` }}
              />
            </div>
            <p className="mb-4 text-xs tabular-nums text-ink-400">
              Đang tải bản v{availableVersion}… {Math.round(progressPercent ?? 0)}%
            </p>
          </>
        )}

        {status === 'downloaded' && (
          <>
            <p className="mb-4 text-xs text-ink-400">
              Đã tải xong v{availableVersion}. Cài đặt ngay (khởi động lại ứng dụng) — hoặc tự cài khi bạn thoát
              ứng dụng.
            </p>
            <button
              onClick={() => void window.api.updatesInstall()}
              className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-white hover:bg-accent-soft"
            >
              <Rocket size={14} /> Cài đặt & khởi động lại
            </button>
          </>
        )}

        {status === 'error' && (
          <p className="mb-4 break-words text-xs text-red-300">{error ?? 'Lỗi không xác định.'}</p>
        )}

        <div className="flex justify-end gap-2">
          {(status === 'idle' || status === 'error' || status === 'not-available') && (
            <button
              onClick={() => void window.api.updatesCheck()}
              className="flex items-center gap-1.5 rounded-lg bg-ink-800 px-4 py-2 text-xs font-medium text-ink-300 hover:bg-ink-700 hover:text-white"
            >
              <RefreshCw size={13} /> Kiểm tra lại
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded-lg bg-ink-800 px-4 py-2 text-xs font-medium text-ink-300 hover:bg-ink-700 hover:text-white"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
