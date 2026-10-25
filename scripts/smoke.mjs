// CDP smoke test for the CutClone renderer. Requires the app running with
// remote debugging on port 9223.
import { chromium } from 'playwright-core'

const CDP = 'http://127.0.0.1:9223'

async function main() {
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  if (!context) throw new Error('No context')
  const page = context.pages()[0] ?? (await context.newPage())

  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`))

  console.log('pages:', context.pages().map((p) => p.url()))
  console.log('url:', page.url())
  console.log('title:', await page.title())

  try {
    await page.waitForSelector('canvas', { timeout: 8000 })
    console.log('canvas: FOUND')
  } catch {
    console.log('canvas: NOT FOUND')
    const html = await page.content()
    console.log('body snippet:', html.slice(0, 600))
    const rootHtml = await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 400) ?? 'EMPTY ROOT')
    console.log('root:', rootHtml)
  }

  const counts = {
    topBar: await page.getByText('CutClone').count(),
    exportBtn: await page.getByText('Xuất video').count(),
    transitionsTab: await page.getByText('Chuyển cảnh').count(),
    trackHeader: await page.getByText('Video 1').count()
  }

  await page.screenshot({ path: 'smoke-app.png' })
  console.log(JSON.stringify({ counts, errors: errors.slice(0, 12) }, null, 2))
  await browser.close()
}

main().catch((e) => {
  console.error('SMOKE FAILED:', e.message)
  process.exit(1)
})
