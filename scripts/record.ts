/**
 * Records the demo loop: landing → controls tour → SE list → last posting → back home.
 * Usage: npx tsx scripts/record.ts [baseUrl=http://localhost:3000] [out=jobseek-demo.mp4]
 * Needs the SE profile with LLM verdicts, system Chrome and ffmpeg.
 *
 * Playwright video draws neither the mouse nor native <select> popups, so the page gets a fake
 * cursor and each select a drawn list whose click sets the real value (v-model listens to `change`).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type Locator, type Page } from 'playwright'

const [base = 'http://localhost:3000', out = 'jobseek-demo.mp4'] = process.argv.slice(2)
const size = { width: 1440, height: 900 }

const CURSOR = `
const style = document.createElement('style')
style.textContent = \`
  #rec-cursor { position: fixed; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px;
    left: -50px; top: -50px; transition: transform 80ms; transform-origin: 0 0; }
  #rec-cursor.down { transform: scale(0.8); }
  #nuxt-devtools-container { display: none !important; }
  #rec-list { position: fixed; z-index: 2147483646; background: var(--color-surface);
    border: 1px solid var(--color-control); border-radius: 4px; padding: 2px 0; }
  #rec-list div { padding: 4px 8px; color: var(--color-ink); }
  #rec-list div:hover { background: var(--color-accent); color: var(--color-bg); }
\`
const cursor = document.createElement('div')
cursor.id = 'rec-cursor'
cursor.innerHTML = '<svg viewBox="0 0 22 22" width="22" height="22"><path d="M2 2 L2 18 L6.5 13.5 L10 21 L13 19.7 L9.5 12.5 L16 12.5 Z" fill="white" stroke="black" stroke-width="1.2"/></svg>'
addEventListener('mousemove', e => { cursor.style.left = e.clientX + 'px'; cursor.style.top = e.clientY + 'px' }, true)
addEventListener('mousedown', () => cursor.classList.add('down'), true)
addEventListener('mouseup', () => cursor.classList.remove('down'), true)
addEventListener('DOMContentLoaded', () => document.body.append(style, cursor))
`

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function moveTo(page: Page, target: Locator) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 30 })
  await wait(400)
}

async function click(page: Page, target: Locator) {
  await moveTo(page, target)
  await page.mouse.down()
  await wait(80)
  await page.mouse.up()
}

/** Steps 3/6/8: open a drawn list under the select, move to the option, click it. */
async function pick(page: Page, select: Locator, label: string) {
  await moveTo(page, select)
  await select.evaluate((sel: HTMLSelectElement) => {
    const r = sel.getBoundingClientRect()
    const list = document.createElement('div')
    list.id = 'rec-list'
    Object.assign(list.style, { left: `${r.left}px`, top: `${r.bottom + 2}px`, width: `${r.width}px` })
    list.style.font = getComputedStyle(sel).font
    for (const o of sel.options) {
      const item = document.createElement('div')
      item.textContent = o.text
      item.onclick = () => {
        sel.value = o.value
        sel.dispatchEvent(new Event('change', { bubbles: true }))
        list.remove()
      }
      list.append(item)
    }
    document.body.append(list)
  })
  await wait(700)
  await click(page, page.locator('#rec-list').getByText(label, { exact: true }))
  await wait(800)
}

/** Wheel-scrolls `px` over `ms`, so the motion is in the video rather than a jump. */
async function scroll(page: Page, px: number, ms: number) {
  const steps = Math.max(1, Math.round(ms / 16))
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, px / steps)
    await wait(16)
  }
}

const remaining = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - innerHeight - scrollY)

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({
  viewport: size,
  colorScheme: 'dark',
  recordVideo: { dir: mkdtempSync(join(tmpdir(), 'jobseek-rec-')), size },
})
await context.addInitScript(CURSOR)
const page = await context.newPage()
const t0 = Date.now()

// 1. Landing page
await page.goto(base, { waitUntil: 'networkidle' })
await page.mouse.move(size.width / 2, size.height / 2)
const start = (Date.now() - t0) / 1000
await wait(1500)

// 2. Seek Jobs, hover only
await moveTo(page, page.getByRole('button', { name: 'Seek Jobs' }))
await wait(800)

// 3. Profile → SE
await pick(page, page.getByLabel('Profile'), 'SE')
await page.waitForLoadState('networkidle')

// 4. Board picker open, 2 s, closed
const boards = page.locator('summary', { hasText: /^\s*Search on/ })
await click(page, boards)
await wait(2000)
await click(page, boards)
await wait(500)

// 5–9. Scoring controls
await moveTo(page, page.getByRole('button', { name: 'Pre-Score' }))
await wait(800)
await pick(page, page.getByLabel('Fast model'), 'Gemma4:26')
await moveTo(page, page.getByRole('button', { name: 'Deep-Score' }))
await wait(800)
await pick(page, page.getByLabel('Deep model'), 'Gemma4:31')
await click(page, page.getByLabel('Thinking'))
await wait(800)

// 10. Filters open, 2 s, closed
const filters = page.locator('summary', { hasText: /^\s*Filter/ })
await click(page, filters)
await wait(2000)
await click(page, filters)
await wait(500)

// 11. To the bottom in 4 s
await scroll(page, await remaining(page), 4000)
await wait(500)

// 12. One chosen posting; scrolled to the middle first if the bottom of the page hides it
const job = page
  .locator('tr', { hasText: 'Exeon Analytics' })
  .getByRole('link', { name: 'Senior Frontend Developer', exact: true })
const offset = await job.evaluate(el => {
  const r = el.getBoundingClientRect()
  return r.top < 80 || r.bottom > innerHeight ? r.top - innerHeight / 2 : 0
})
if (offset) await scroll(page, offset, 800)
await click(page, job)
await page.getByRole('heading', { name: 'Match' }).waitFor()
await page.waitForLoadState('networkidle')

// 13. Bring the whole Match card into view, then read down slowly
await wait(1000)
const matchBottom = await page
  .locator('section.card')
  .first()
  .evaluate(el => el.getBoundingClientRect().bottom - innerHeight + 24)
if (matchBottom > 0) await scroll(page, matchBottom, 800)
await wait(2000)
const rest = await remaining(page)
await scroll(page, rest, Math.min(3000, rest * 2)) // ~500 px/s, 3 s at most
await wait(800)

// 14. Home, which is frame one again
await click(page, page.getByRole('link', { name: 'Job Seek', exact: true }))
await page.waitForLoadState('networkidle')
await page.mouse.move(size.width / 2, size.height / 2, { steps: 30 })
await wait(1500)

const video = page.video()!
await context.close()
await browser.close()
const encode = '-c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart'.split(' ')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-i', await video.path(), ...encode, out])
console.log(`wrote ${out}`)
