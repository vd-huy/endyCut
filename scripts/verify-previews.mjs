// Final DOM verification: scoped to the left panel aside, all 24 catalog
// entries must show a baked GIF across the four expanded section views.
import { chromium } from 'playwright-core'

const CDP = 'http://127.0.0.1:9223'
const browser = await chromium.connectOverCDP(CDP)
const page = browser.contexts()[0].pages()[0]
const warns = []
page.on('console', (msg) => {
  const text = msg.text()
  if ((msg.type() === 'warning' || msg.type() === 'error') && text.includes('effectPreview')) {
    warns.push(`[${msg.type()}] ${text}`)
  }
})
page.on('pageerror', (err) => warns.push(`[pageerror] ${err.message}`))

await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('canvas', { timeout: 20000 })
await page.waitForTimeout(500)

await page.getByRole('button', { name: 'Hiệu ứng', exact: true }).first().click()
await page.waitForTimeout(400)

const panelGifs = async () => page.locator('aside img[src^="data:image/gif"]').count()
const panelTiles = async () => page.locator('aside button p').count()

const categories = await page.getByRole('button', { name: 'Xem tất cả' }).count()
console.log('CATEGORIES:', categories)

const seen = new Set()
for (let i = 0; i < categories; i++) {
  await page.getByRole('button', { name: 'Xem tất cả' }).first().click()
  for (let t = 0; t < 16; t++) {
    const tiles = await panelTiles()
    const gifs = await panelGifs()
    if (tiles > 0 && gifs >= tiles) break
    await page.waitForTimeout(500)
  }
  const tiles = await panelTiles()
  const gifs = await panelGifs()
  const names = await page.locator('aside button p').allTextContents()
  for (const n of names) seen.add(n.trim())
  console.log(`EXPAND-${i}: tiles=${tiles} gifs=${gifs}`)
  const collapse = page.getByRole('button', { name: 'Thu gọn' })
  if ((await collapse.count()) > 0) await collapse.first().click()
  await page.waitForTimeout(300)
}
console.log('UNIQUE-EFFECTS-WITH-GIF-NAME-LIST:', seen.size)

// Collapsed view sweep as well.
for (let t = 0; t < 16; t++) {
  const tiles = await panelTiles()
  const gifs = await panelGifs()
  if (tiles > 0 && gifs >= tiles) break
  await page.waitForTimeout(500)
}
console.log('COLLAPSED:', JSON.stringify({ tiles: await panelTiles(), gifs: await panelGifs() }))

try {
  await page.screenshot({ path: 'smoke-effect-gifs.png', animations: 'disabled', timeout: 60000 })
  console.log('SCREENSHOT: ok')
} catch (e) {
  console.log('SCREENSHOT failed:', String(e).slice(0, 120))
}

await page.getByRole('button', { name: 'Bộ lọc', exact: true }).first().click()
await page.waitForTimeout(600)
const sceneTiles = await page.locator('aside img[src^="data:image/jpeg"]').count()
console.log('FILTER-SCENE-TILES:', sceneTiles, seen.size > 0 ? '(filters separate)' : '')
try {
  await page.screenshot({ path: 'smoke-filter-scene.png', animations: 'disabled', timeout: 60000 })
  console.log('SCREENSHOT2: ok')
} catch (e) {
  console.log('SCREENSHOT2 failed:', String(e).slice(0, 120))
}

if (warns.length > 0) {
  console.log('BLEAK-FAILURES:')
  for (const w of warns.slice(0, 12)) console.log(' ', w)
} else {
  console.log('NO-BAKE-FAILURES')
}
await browser.close()
