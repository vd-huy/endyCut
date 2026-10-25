import { useEffect, useRef, useState } from 'react'
import { Circle, Loader2, Mic, Monitor, Square, X, Camera } from 'lucide-react'
import { useEditorStore } from '../store/editorStore'
import { useProjectStore } from '../store/projectStore'
import { importAssets } from '../core/media/assets'

type RecordMode = 'screen' | 'camera' | 'voice'

/**
 * CapCut-style recording: screen capture, camera capture or voiceover, saved
 * as WebM/WAV via MediaRecorder and imported straight into the media library.
 */
export default function RecordModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<RecordMode>('voice')
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      stopStreams()
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !recording) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, onClose])

  function stopStreams() {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (previewRef.current) previewRef.current.srcObject = null
  }

  const startPreview = async (target: RecordMode) => {
    setMode(target)
    setError(null)
    stopStreams()
    try {
      let stream: MediaStream
      if (target === 'voice') {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      } else if (target === 'camera') {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true })
      } else {
        const display = await (navigator.mediaDevices as MediaDevices & {
          getDisplayMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>
        }).getDisplayMedia?.({ video: true, audio: true })
        if (!display) return
        stream = display
      }
      streamRef.current = stream
      if (target !== 'voice' && previewRef.current) {
        previewRef.current.srcObject = stream
      }
    } catch (err) {
      setError(String(err))
    }
  }

  const startRecording = () => {
    const stream = streamRef.current
    if (!stream) return
    setError(null)
    try {
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
        ? 'video/webm;codecs=vp9,opus'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }
      recorder.onstop = async () => {
        setBusy(true)
        try {
          const blob = new Blob(chunks, { type: mimeType })
          const buffer = await blob.arrayBuffer()
          const ext = mimeType.startsWith('audio') ? 'webm' : 'webm'
          const dataUrl = `data:application/octet-stream;base64,${arrayBufferToBase64(buffer)}`
          const path = await window.api.writeDataFile(dataUrl, `record-${Date.now()}.${ext}`)
          setImportNoticeBusy()
          await importAssets([path], (asset) => useProjectStore.getState().addAssetsToLibrary([asset]), () => {})
          onClose()
        } catch (err) {
          setError(String(err))
        } finally {
          setBusy(false)
        }
      }
      recorder.start(1000)
      recorderRef.current = recorder
      setRecording(true)
      setSeconds(0)
      timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (err) {
      setError(String(err))
    }
  }

  const setImportNoticeBusy = () => {
    useEditorStore.getState().setImportNotice('Đang nhập bản ghi…')
  }

  const stopRecording = () => {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
      <div className="w-[520px] rounded-2xl border border-ink-600 bg-ink-900 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Ghi hình &amp; thu âm</h2>
          <button onClick={onClose} className="text-ink-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          {(
            [
              { id: 'voice', label: 'Thu giọng nói', icon: Mic },
              { id: 'camera', label: 'Camera', icon: Camera },
              { id: 'screen', label: 'Màn hình', icon: Monitor }
            ] as Array<{ id: RecordMode; label: string; icon: typeof Mic }>
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => void startPreview(id)}
              disabled={recording}
              className={`flex flex-col items-center gap-1.5 rounded-lg py-3 text-[11px] ring-1 transition-colors ${
                mode === id ? 'bg-accent/15 text-accent ring-accent' : 'bg-ink-800 text-ink-300 ring-ink-700 hover:text-white'
              } disabled:opacity-50`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>

        {mode !== 'voice' && (
          <div className="mb-4 flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-black">
            <video ref={previewRef} autoPlay muted playsInline className="max-h-full max-w-full" />
          </div>
        )}
        {mode === 'voice' && recording && (
          <div className="mb-4 flex aspect-video items-center justify-center rounded-lg bg-ink-950">
            <Mic size={40} className="animate-pulse text-accent" />
          </div>
        )}

        {error && <p className="mb-3 rounded-md bg-red-950/60 p-2 text-xs text-red-300">{error}</p>}

        <div className="flex items-center gap-3">
          {!recording ? (
            <>
              <button
                onClick={startRecording}
                disabled={!streamRef.current || busy}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-950/70 py-2 text-sm font-semibold text-red-300 hover:bg-red-900/70 disabled:opacity-40"
              >
                <Circle size={14} fill="currentColor" /> Bắt đầu ghi
              </button>
              {!streamRef.current && <p className="text-[11px] text-ink-500">Chọn nguồn ghi phía trên.</p>}
            </>
          ) : (
            <button
              onClick={stopRecording}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink-700 py-2 text-sm font-semibold text-white hover:bg-ink-600"
            >
              <Square size={14} fill="currentColor" /> Dừng ({String(Math.floor(seconds / 60)).padStart(2, '0')}:
              {String(seconds % 60).padStart(2, '0')})
            </button>
          )}
          {busy && <Loader2 size={16} className="animate-spin text-ink-400" />}
        </div>
        <p className="mt-3 text-[10px] leading-relaxed text-ink-500">
          Bản ghi được lưu vào thư mục dữ liệu app và tự động nhập vào thư viện media.
        </p>
      </div>
    </div>
  )
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
