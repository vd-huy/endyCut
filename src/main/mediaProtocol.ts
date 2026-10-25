import { protocol } from 'electron'
import { createReadStream, promises as fsPromises } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

// Serve local media files to the renderer over a privileged custom protocol.
// Range requests are handled manually so <video> seeking works smoothly.

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi',
  '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'
])

export function isValidMediaPath(p: string): boolean {
  if (!path.isAbsolute(p)) return false
  return MEDIA_EXTENSIONS.has(path.extname(p).toLowerCase())
}

function contentTypeFor(p: string): string {
  const ext = path.extname(p).toLowerCase()
  const map: Record<string, string> = {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
    '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
    '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp'
  }
  return map[ext] ?? 'application/octet-stream'
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  let start: number
  let end: number
  if (rawStart === '' && rawEnd === '') return null
  if (rawStart === '') {
    // suffix range: last N bytes
    start = Math.max(0, size - Number(rawEnd))
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null
  return { start, end }
}

/** Build media://local?f=<encoded absolute path> for the renderer. */
export function mediaUrl(filePath: string): string {
  return `media://local?f=${encodeURIComponent(filePath)}`
}

export function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = decodeURIComponent(url.searchParams.get('f') ?? '')
      if (!isValidMediaPath(filePath)) {
        return new Response('Invalid media path', { status: 403 })
      }
      const stat = await fsPromises.stat(filePath)
      if (!stat.isFile()) return new Response('Not a file', { status: 404 })
      const type = contentTypeFor(filePath)
      // The renderer page origin differs from media:// in dev, so CORS headers
      // are required for fetch-based readers (mediabunny).
      const cors = { 'access-control-allow-origin': '*' }
      const range = parseRange(request.headers.get('range'), stat.size)
      if (range) {
        const stream = createReadStream(filePath, { start: range.start, end: range.end })
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            ...cors,
            'content-type': type,
            'accept-ranges': 'bytes',
            'content-length': String(range.end - range.start + 1),
            'content-range': `bytes ${range.start}-${range.end}/${stat.size}`
          }
        })
      }
      const stream = createReadStream(filePath)
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          ...cors,
          'content-type': type,
          'accept-ranges': 'bytes',
          'content-length': String(stat.size)
        }
      })
    } catch (error) {
      return new Response(`Media protocol error: ${String(error)}`, { status: 500 })
    }
  })
}
