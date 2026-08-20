/**
 * Regenerate the README screenshots.
 *
 * Drives the running dev server with headless Chrome and the Mock provider, so
 * no API key is needed and the output is deterministic.
 *
 *   npm run dev          # in one terminal
 *   node scripts/screenshots.mjs
 *
 * Override the Chrome path with CHROME_PATH if it is not in the default
 * Windows location.
 */
import puppeteer from 'puppeteer-core'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const URL = process.env.APP_URL || 'http://localhost:5173'
const OUT = path.resolve('docs/screenshots')
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 2 }

// A document with plenty of distinct sentences so the Mock provider produces
// varied pairs rather than obvious repeats.
const DOC = [
  'The transformer architecture replaced recurrent networks as the dominant approach for sequence modeling in 2017.',
  'Self-attention allows every token to attend to every other token in the sequence, producing a weighted representation of context.',
  'Multi-head attention runs several attention operations in parallel, letting the model capture different relationship types simultaneously.',
  'Positional encodings inject order information, because attention alone is permutation invariant and cannot distinguish token positions.',
  'Layer normalization stabilizes training by rescaling activations to zero mean and unit variance within each layer.',
  'Residual connections let gradients flow directly through the network, which makes very deep stacks trainable.',
  'The feed-forward sublayer applies two linear transformations with a nonlinearity between them, independently at each position.',
  'Supervised fine-tuning adapts a pretrained model to a narrow task using labeled instruction and response pairs.',
  'Low-rank adaptation freezes the base weights and trains small rank-decomposition matrices, cutting memory cost dramatically.',
  'Quantization reduces the numeric precision of weights, trading a small amount of accuracy for large gains in speed and footprint.',
  'A validation split held out from training data is essential for detecting overfitting before the model reaches production.',
  'Duplicate training examples cause the model to overweight repeated patterns, degrading generalization to unseen inputs.',
  'Learning rate warmup gradually increases the step size at the start of training to avoid destabilizing pretrained weights.',
  'Gradient accumulation simulates a larger batch size on limited hardware by summing gradients across several forward passes.',
  'Early stopping halts training when validation loss stops improving, preserving the best checkpoint seen so far.',
  'Tokenization splits raw text into subword units, balancing vocabulary size against sequence length.',
].join(' ')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Set a React-controlled input/textarea value and fire the input event. */
async function setReactValue(page, selector, value) {
  await page.$eval(
    selector,
    (el, val) => {
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    },
    value
  )
}

/** Click the first button whose text matches. */
async function clickByText(page, pattern) {
  const clicked = await page.evaluate((src) => {
    const re = new RegExp(src)
    const btn = [...document.querySelectorAll('button')].find((b) => re.test(b.textContent))
    if (!btn) return false
    btn.click()
    return true
  }, pattern)
  if (!clicked) throw new Error(`No button matching /${pattern}/`)
  await sleep(400)
}

async function shot(page, name, opts = {}) {
  await page.screenshot({ path: path.join(OUT, name), ...opts })
  console.log('  ✓', name)
}

async function main() {
  await mkdir(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  })

  const page = await browser.newPage()
  await page.setViewport(VIEWPORT)

  // Start from a clean slate so no restore banner appears in the hero shot
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise((res) => {
      const req = indexedDB.deleteDatabase('synthgen')
      req.onsuccess = req.onerror = req.onblocked = () => res()
    })
  })
  await page.goto(URL, { waitUntil: 'networkidle0' })
  await sleep(500)

  console.log('Capturing screenshots →', OUT)

  // ── Setup: Mock provider + pasted document ───────────────────────────────
  await page.select('select', 'mock')
  await sleep(300)
  await clickByText(page, '^Paste$')
  await setReactValue(page, 'textarea[placeholder*="Paste your document"]', DOC)
  await clickByText(page, 'Add Document')
  await sleep(500)

  // 01 — empty workspace with the document loaded and the estimate visible
  await shot(page, '01-workspace-ready.png')

  // 02 — pre-flight estimate panel on its own.
  // The label renders uppercase via CSS but textContent is "Estimate",
  // so match case-insensitively.
  const estimate = await page.evaluateHandle(() => {
    return (
      [...document.querySelectorAll('div')].find(
        (d) =>
          /^estimate/i.test(d.textContent.trim()) &&
          d.querySelector('.grid') &&
          d.getBoundingClientRect().width > 0
      ) || null
    )
  })
  if (estimate.asElement()) {
    await estimate.asElement().scrollIntoView()
    await sleep(300)
    await estimate.asElement().screenshot({ path: path.join(OUT, '02-preflight-estimate.png') })
    console.log('  ✓ 02-preflight-estimate.png')
  } else {
    console.warn('  ! 02-preflight-estimate.png — panel not found')
  }

  // ── Generate a small, clean dataset ──────────────────────────────────────
  await setReactValue(page, 'input[type="range"]', '12')
  await sleep(200)
  await clickByText(page, 'Generate Dataset')
  await page.waitForFunction(() => /\d+ pairs/.test(document.body.innerText), { timeout: 30000 })
  await sleep(1200)

  // 03 — populated review workspace
  await shot(page, '03-review-workspace.png')

  // 03b — the same screen in dark mode
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await sleep(500)
  await shot(page, '03b-review-workspace-dark.png')
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await sleep(400)

  // 04 — export modal with the ChatML schema and a 90/10 split selected
  await clickByText(page, '^Export$')
  await sleep(400)
  await clickByText(page, 'ChatML')
  await clickByText(page, '90 / 10')
  await sleep(400)
  await shot(page, '04-export-schemas.png')
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    const backdrop = document.querySelector('.fixed.inset-0.z-50')
    if (backdrop) backdrop.click()
  })
  await sleep(400)

  // ── Large run: duplicates, quality flags, virtualization ─────────────────
  await setReactValue(page, 'input[type="range"]', '300')
  await sleep(200)
  await clickByText(page, 'Generate Dataset')
  await page.waitForFunction(() => /300 pairs/.test(document.body.innerText), { timeout: 60000 })
  await sleep(1500)

  // 05 — duplicate + quality banners over a virtualized list
  await shot(page, '05-duplicates-and-quality.png')

  // 06 — search filtering the set down
  const search = await page.$('input[type="search"]')
  if (search) {
    await setReactValue(page, 'input[type="search"]', 'attention')
    await sleep(700)
    await shot(page, '06-search-filter.png')
    await setReactValue(page, 'input[type="search"]', '')
    await sleep(300)
  }

  // 07 — quality validation. Swap in a document whose sentences reference the
  // source, which the Mock provider echoes verbatim into outputs and the
  // validator then flags as a source leak.
  await sleep(200)

  const MESSY = [
    'According to the document, retrieval augmented generation combines a search index with a generative model.',
    'As stated in the text, the retriever selects passages that are most relevant to the incoming query.',
    'The document states that grounding responses in retrieved passages reduces hallucination rates substantially.',
    'Reranking models score candidate passages a second time to improve the precision of the final context window.',
  ].join(' ')

  // Clear every loaded document so only the messy one remains. The remove
  // buttons carry an aria-label, which is stable across restyling.
  await page.evaluate(() => {
    document.querySelectorAll('button[aria-label^="Remove "]').forEach((b) => b.click())
  })
  await sleep(500)

  await setReactValue(page, 'textarea[placeholder*="Paste your document"]', MESSY)
  await clickByText(page, 'Add Document')
  await sleep(400)
  await setReactValue(page, 'input[type="range"]', '8')
  await sleep(200)
  await clickByText(page, 'Generate Dataset')
  await page.waitForFunction(() => /flagged by quality checks|\d+ pairs/.test(document.body.innerText), { timeout: 30000 })
  await sleep(1500)
  await shot(page, '07-quality-validation.png')

  // 08 — large output mode modal (pairCount > 1000)
  await setReactValue(page, 'input[type="range"]', '5000')
  await sleep(300)
  await clickByText(page, 'Generate Dataset')
  await sleep(700)
  await shot(page, '08-large-output-mode.png')

  await browser.close()
  console.log('Done.')
}

main().catch((err) => {
  console.error('Screenshot run failed:', err.message)
  process.exit(1)
})
