import { CustomSource } from 'mediabunny'

/**
 * mediabunny input source that reads local files through the preload IPC
 * bridge. Chromium blocks cross-scheme fetch() from the renderer, so direct
 * UrlSource access to media:// is not viable; IPC reads work in both dev
 * (http origin) and production (file origin).
 */
export function createIpcFileSource(path: string): CustomSource {
  return new CustomSource({
    getSize: async () => {
      const size = await window.api.mediaFileSize(path)
      if (size === null || size === undefined) throw new Error('Không đọc được kích thước tệp: ' + path)
      return size
    },
    read: async (start, end) => window.api.mediaReadSlice(path, start, end - start),
    prefetchProfile: 'fileSystem'
  })
}
