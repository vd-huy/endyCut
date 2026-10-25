// SubRip (SRT) subtitle parsing/building — used by caption import/export.

export interface SrtCue {
  /** Seconds from timeline start. */
  start: number
  /** Seconds from timeline start. */
  end: number
  text: string
}

function parseTimestamp(raw: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*$/.exec(raw)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
}

/** Parse an SRT document; tolerant of extra blank lines and BOM. */
export function parseSrt(content: string): SrtCue[] {
  const cues: SrtCue[] = []
  const clean = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const blocks = clean.split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0) continue
    const timeLineIndex = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIndex < 0) continue
    const [fromRaw, toRaw] = lines[timeLineIndex].split('-->')
    const start = parseTimestamp(fromRaw ?? '')
    const end = parseTimestamp(toRaw ?? '')
    if (start === null || end === null || end <= start) continue
    const text = lines
      .slice(timeLineIndex + 1)
      .join('\n')
      .trim()
    if (!text) continue
    cues.push({ start, end, text })
  }
  return cues.sort((a, b) => a.start - b.start)
}

function formatTimestamp(seconds: number): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const ms = Math.round((s - Math.floor(s)) * 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(sec)},${pad(Math.min(999, ms), 3)}`
}

/** Build an SRT document from cues. */
export function buildSrt(cues: SrtCue[]): string {
  return (
    cues
      .map((cue, i) => `${i + 1}\n${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}\n${cue.text.trim()}`)
      .join('\n\n') + '\n'
  )
}
