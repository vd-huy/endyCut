// Raw-CDP verification for the new features (no Playwright — Chromium 156's
// browser-level handshake stalls with the installed playwright-core version,
// but page-level WebSocket sessions work fine).
import http from 'node:http'

const CDP_HTTP = 'http://127.0.0.1:9223'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => resolve(JSON.parse(d)))
    }).on('error', reject)
  })
}

class CdpSession {
  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP timeout: ${method}`))
        }
      }, 15000)
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    })
    if (r.exceptionDetails) {
      throw new Error(`page eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    }
    return r.result.value
  }
}

async function main() {
  const targets = await getJson(`${CDP_HTTP}/json`)
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('ws error'))
  })
  const cdp = new CdpSession(ws)

  // Dismiss any native dialog (autosave-restore confirm) that blocks the
  // renderer main thread before we can enable Runtime.
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 400))
    try {
      await cdp.send('Page.handleJavaScriptDialog', { accept: false })
    } catch {
      break // no dialog — proceed
    }
  }
  await cdp.send('Runtime.enable')

  const results = {}
  const errors = []
  cdp.send('Runtime.consoleAPICalled').catch(() => {})
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception')
    }
  })

  // 1. Sticker tab exists; inserting a sticker creates a sticker clip.
  results.stickerTab = await cdp.eval(
    `(() => {
      const tab = [...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Sticker'))
      if (!tab) return 'MISSING'
      tab.click()
      return 'OK'
    })()`
  )
  await new Promise((r) => setTimeout(r, 300))
  results.stickerInserted = await cdp.eval(
    `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '😀')
      if (!btn) return 'no-button'
      btn.click()
      return 'clicked'
    })()`
  )
  await new Promise((r) => setTimeout(r, 300))
  results.stickerClipOnTimeline = await cdp.eval(
    `(() => {
      // Sticker clips render on the text track with the emoji as label.
      const clips = [...document.querySelectorAll('[data-lane="true"] > div.absolute')]
      return clips.some(c => c.textContent.includes('😀')) ? 'YES' : 'NO'
    })()`
  )

  // 2. Marker button in the toolbar adds a marker flag on the ruler.
  results.markerButton = await cdp.eval(
    `(() => {
      const btn = document.querySelector('button[title*="mốc đánh dấu"]')
      if (!btn) return 'MISSING'
      btn.click()
      return 'OK'
    })()`
  )
  await new Promise((r) => setTimeout(r, 250))
  results.markerFlagOnRuler = await cdp.eval(
    `[...document.querySelectorAll('svg.lucide-flag')].length`
  )

  // 3. Context menu on a clip shows the new actions.
  results.contextMenu = await cdp.eval(
    `(() => {
      const clips = [...document.querySelectorAll('[data-lane="true"] > div.absolute')]
      if (clips.length === 0) return 'no-clips'
      const target = clips[clips.length - 1]
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 500, clientY: 400 }))
      return 'opened'
    })()`
  )
  await new Promise((r) => setTimeout(r, 250))
  results.contextMenuHasCopy = await cdp.eval(
    `[...document.querySelectorAll('div.fixed button')].some(b => b.textContent.includes('Sao chép')) ? 'YES' : 'NO'`
  )
  results.contextMenuHasRipple = await cdp.eval(
    `[...document.querySelectorAll('div.fixed button')].some(b => b.textContent.includes('liên hoàn')) ? 'YES' : 'NO'`
  )
  await cdp.eval(`document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
  await new Promise((r) => setTimeout(r, 200))

  // 4. Export modal shows the new options.
  results.exportModalOpens = await cdp.eval(
    `(() => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Xuất video'))
      if (!btn) return 'MISSING'
      btn.click()
      return 'OK'
    })()`
  )
  await new Promise((r) => setTimeout(r, 400))
  results.exportFormatWebM = await cdp.eval(
    `[...document.querySelectorAll('option')].some(o => o.textContent.includes('WebM (VP9 + Opus)')) ? 'YES' : 'NO'`
  )
  results.exportQualityCustom = await cdp.eval(
    `[...document.querySelectorAll('option')].some(o => o.textContent.includes('Tùy chỉnh bitrate')) ? 'YES' : 'NO'`
  )
  results.exportResolutionOptions = await cdp.eval(
    `[...document.querySelectorAll('option')].filter(o => /Đầy đủ|720p|480p|2K|4K/.test(o.textContent)).length`
  )
  results.exportSizeEstimate = await cdp.eval(
    `document.body.textContent.includes('Dung lượng ước tính') ? 'YES' : 'NO'`
  )
  // Close via Escape (window keydown handler in the modal).
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await new Promise((r) => setTimeout(r, 300))
  results.exportModalClosed = await cdp.eval(
    `document.body.textContent.includes('Dung lượng ước tính') ? 'STILL-OPEN' : 'CLOSED'`
  )

  // 5. Transitions panel has the new entries.
  await cdp.eval(
    `[...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Chuyển cảnh'))?.click()`
  )
  await new Promise((r) => setTimeout(r, 300))
  results.newTransitions = await cdp.eval(
    `(() => {
      const t = document.body.textContent
      return ['Quay cuộn', 'Hình tròn mở', 'Thu nhỏ'].filter(n => t.includes(n)).length
    })()`
  )

  // 6. Effects library shows the new entries.
  await cdp.eval(
    `[...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Hiệu ứng'))?.click()`
  )
  await new Promise((r) => setTimeout(r, 300))
  results.newEffects = await cdp.eval(
    `(() => {
      const t = document.body.textContent
      return ['Tách RGB', 'VHS cổ điển', 'Giật zoom', 'Noir đen trắng'].filter(n => t.includes(n)).length
    })()`
  )

  // 7. Text panel shows TTS + SRT sections.
  await cdp.eval(
    `[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === 'Chữ')?.click()`
  )
  await new Promise((r) => setTimeout(r, 300))
  results.ttsSection = await cdp.eval(
    `document.body.textContent.includes('Chữ thành giọng đọc') ? 'YES' : 'NO'`
  )
  results.srtSection = await cdp.eval(
    `document.body.textContent.includes('Phụ đề SRT') ? 'YES' : 'NO'`
  )

  // 8. Home modal opens with the recent-projects list.
  results.homeModal = await cdp.eval(
    `(() => {
      const btn = document.querySelector('button[title*="Trang chủ"]')
      if (!btn) return 'MISSING'
      btn.click()
      return 'OK'
    })()`
  )
  await new Promise((r) => setTimeout(r, 400))
  results.homeRecentSection = await cdp.eval(
    `document.body.textContent.includes('Dự án gần đây') ? 'YES' : 'NO'`
  )
  results.homeNewProject = await cdp.eval(
    `document.body.textContent.includes('Dự án mới') ? 'YES' : 'NO'`
  )
  await cdp.eval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await new Promise((r) => setTimeout(r, 250))

  console.log(JSON.stringify(results, null, 2))
  console.log('errors:', JSON.stringify(errors.slice(0, 5)))
  ws.close()
}

main().catch((err) => {
  console.error('SMOKE FAILED:', err.message)
  process.exit(1)
})
