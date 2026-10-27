import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface TemplateMeta {
  templateId: string
  title: string
  desc: string
  authorName: string
  coverUrl: string
  previewVideoUrl: string
  width: number
  height: number
  durationMs: number
  segmentAmount: number
  usageAmount: number
  resolvedUrl: string
}

export interface CapcutDraftInfo {
  folder: string
  name: string
  modifiedAt: number
  templateId: string
  hasContent: boolean
}

export interface TtsVoice {
  name: string
  culture: string
}

export interface RecentProjectEntry {
  path: string
  name: string
  openedAt: number
}

export interface CutCloneApi {
  /** Native file picker for media; returns absolute paths. */
  pickMediaFiles(): Promise<string[]>
  /** Size in bytes of a local media file. */
  mediaFileSize(path: string): Promise<number>
  /** Read a byte range of a local media file (validated + capped). */
  mediaReadSlice(path: string, start: number, length: number): Promise<Uint8Array>
  /** Absolute path of a File object dropped into the renderer, or null. */
  pathForFile(file: File): string | null
  saveProject(filePath: string, json: string): Promise<string>
  pickProjectSavePath(): Promise<string | null>
  pickProjectOpenPath(): Promise<string | null>
  readProjectFile(filePath: string): Promise<string>
  autosave(json: string): Promise<void>
  readAutosave(): Promise<string | null>
  /** Recent projects list for the home screen. */
  recentProjects(): Promise<RecentProjectEntry[]>
  addRecentProject(filePath: string, name: string): Promise<RecentProjectEntry[]>
  removeRecentProject(filePath: string): Promise<RecentProjectEntry[]>
  /** Persist a data-URL payload under userData/generated; returns the path. */
  writeDataFile(dataUrl: string, fileName: string): Promise<string>
  /** Pick + read an Adobe .cube color LUT. */
  pickColorLutPath(): Promise<string | null>
  readColorLut(path: string): Promise<string>
  /** Save a preview-proxy mp4 produced in the renderer; returns its path. */
  writeProxy(sourcePath: string, data: ArrayBuffer): Promise<string>
  /** Offline Windows SAPI text-to-speech. */
  listTtsVoices(): Promise<TtsVoice[]>
  synthesizeSpeech(text: string, voice: string, rate: number): Promise<string>
  /** SRT subtitle import/export. */
  pickSrtOpenPath(): Promise<string | null>
  pickSrtSavePath(): Promise<string | null>
  readSrt(filePath: string): Promise<string>
  writeSrt(filePath: string, content: string): Promise<string>
  pickExportSavePath(extension?: string): Promise<string | null>
  writeExportFile(filePath: string, data: ArrayBuffer): Promise<boolean>
  /** Reveal the file in Explorer; falls back to opening its folder. */
  showItemInFolder(path: string): Promise<boolean>
  /** Fetch capcut.com template page and extract its public metadata. */
  resolveTemplateLink(url: string): Promise<TemplateMeta>
  /** Download a template asset into the app data folder. */
  downloadTemplateFile(url: string, destPath: string): Promise<string>
  /** Scan CapCut/JianYing desktop draft folders (newest first). */
  listCapcutDrafts(): Promise<CapcutDraftInfo[]>
  /** Read draft_content.json (+ optional meta) from a CapCut draft folder. */
  readCapcutDraft(folder: string): Promise<{ content: string; meta: string | null }>
  /** App data folder root — template downloads live under templates/. */
  getUserDataPath(): Promise<string>
  platform: string
}

const api: CutCloneApi = {
  pickMediaFiles: () => ipcRenderer.invoke('media:pickFiles'),
  mediaFileSize: (path) => ipcRenderer.invoke('media:fileSize', path),
  mediaReadSlice: (path, start, length) => ipcRenderer.invoke('media:readSlice', path, start, length),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return null
    }
  },
  saveProject: (filePath, json) => ipcRenderer.invoke('project:save', filePath, json),
  pickProjectSavePath: () => ipcRenderer.invoke('project:pickSavePath'),
  pickProjectOpenPath: () => ipcRenderer.invoke('project:pickOpenPath'),
  readProjectFile: (filePath) => ipcRenderer.invoke('project:read', filePath),
  autosave: (json) => ipcRenderer.invoke('project:autosave', json),
  readAutosave: () => ipcRenderer.invoke('project:readAutosave'),
  recentProjects: () => ipcRenderer.invoke('project:recentList'),
  addRecentProject: (filePath, name) => ipcRenderer.invoke('project:recentAdd', filePath, name),
  removeRecentProject: (filePath) => ipcRenderer.invoke('project:recentRemove', filePath),
  writeDataFile: (dataUrl, fileName) => ipcRenderer.invoke('data:writeFile', dataUrl, fileName),
  pickColorLutPath: () => ipcRenderer.invoke('color:pickLutPath'),
  readColorLut: (path) => ipcRenderer.invoke('color:readLut', path),
  writeProxy: (sourcePath, data) => ipcRenderer.invoke('media:writeProxy', sourcePath, data),
  listTtsVoices: () => ipcRenderer.invoke('tts:listVoices'),
  synthesizeSpeech: (text, voice, rate) => ipcRenderer.invoke('tts:synthesize', text, voice, rate),
  pickSrtOpenPath: () => ipcRenderer.invoke('srt:pickOpenPath'),
  pickSrtSavePath: () => ipcRenderer.invoke('srt:pickSavePath'),
  readSrt: (filePath) => ipcRenderer.invoke('srt:read', filePath),
  writeSrt: (filePath, content) => ipcRenderer.invoke('srt:write', filePath, content),
  pickExportSavePath: (extension) => ipcRenderer.invoke('export:pickSavePath', extension),
  writeExportFile: (filePath, data) => ipcRenderer.invoke('export:write', filePath, data),
  showItemInFolder: (p) => ipcRenderer.invoke('shell:showItemInFolder', p),
  resolveTemplateLink: (url) => ipcRenderer.invoke('template:resolveLink', url),
  downloadTemplateFile: (url, destPath) => ipcRenderer.invoke('template:downloadFile', url, destPath),
  listCapcutDrafts: () => ipcRenderer.invoke('template:listDrafts'),
  readCapcutDraft: (folder) => ipcRenderer.invoke('template:readDraft', folder),
  getUserDataPath: () => ipcRenderer.invoke('app:userDataPath'),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
