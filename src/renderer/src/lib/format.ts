export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}p ${String(s).padStart(2, '0')}s`
}

export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs)
  return d.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })
}
