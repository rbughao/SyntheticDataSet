/**
 * Persona feature tests.
 *
 * Covers the three things that can silently go wrong: pairs not being split
 * across the selected personas, the prompt not actually carrying the point of
 * view, and the cost estimate not accounting for the extra requests personas
 * cause.
 *
 *   npm run dev             # in one terminal
 *   npm run test:personas   # in another
 */
import puppeteer from 'puppeteer-core'

const APP = process.env.APP_URL || 'http://localhost:5173'
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log(`  \u2713 ${name}`) }
  else { fail++; console.log(`  \u2717 ${name}`); if (detail) console.log(`      ${detail}`) }
}

const BASE_SETTINGS = {
  pairCount: 12,
  styles: ['factual'],
  difficulty: 'intermediate',
  domainTag: '',
  temperatureHint: 'balanced',
  concurrency: 3,
  providerSlug: 'mock',
  model: 'mock',
  personaIds: [],
  customPersona: '',
}

async function main() {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new' })
  const p = await browser.newPage()
  await p.setViewport({ width: 1440, height: 950 })
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message.slice(0, 160)))
  await p.goto(APP, { waitUntil: 'networkidle0' })
  await sleep(400)

  // ── Resolution ───────────────────────────────────────────────────────────
  console.log('\nPersona resolution')
  const r = await p.evaluate(async (base) => {
    const m = await import('/src/utils/personas.js')
    return {
      none: m.resolvePersonas({ ...base }).length,
      two: m.resolvePersonas({ ...base, personaIds: ['newcomer', 'expert'] }).map((x) => x.id),
      unknownIgnored: m.resolvePersonas({ ...base, personaIds: ['newcomer', 'nope'] }).map((x) => x.id),
      customNeedsText: m.resolvePersonas({ ...base, personaIds: ['custom'], customPersona: '   ' }).length,
      customUsed: m.resolvePersonas({ ...base, personaIds: ['custom'], customPersona: 'A night-shift nurse' })
        .map((x) => ({ id: x.id, free: x.freeText })),
      presetCount: m.PRESET_PERSONAS.length,
      allHaveFields: m.PRESET_PERSONAS.every(
        (x) => x.name && x.role && x.goal && x.context && x.expertise && x.asks
      ),
    }
  }, BASE_SETTINGS)

  check('no persona selected resolves to none', r.none === 0)
  check('two presets resolve in order', JSON.stringify(r.two) === '["newcomer","expert"]', JSON.stringify(r.two))
  check('unknown ids are ignored', JSON.stringify(r.unknownIgnored) === '["newcomer"]', JSON.stringify(r.unknownIgnored))
  check('custom with blank text is dropped', r.customNeedsText === 0)
  check('custom carries the free text', r.customUsed[0]?.free === 'A night-shift nurse', JSON.stringify(r.customUsed))
  check('every preset is fully specified', r.allHaveFields, `${r.presetCount} presets`)

  // ── Prompt content ───────────────────────────────────────────────────────
  console.log('\nPrompt carries the point of view')
  const prompts = await p.evaluate(async (base) => {
    const pb = await import('/src/utils/promptBuilder.js')
    const pm = await import('/src/utils/personas.js')
    const chunk = { text: 'The rollback procedure requires draining the queue first.', index: 0, total: 1 }

    const neutral = pb.buildChunkMessages(chunk, 0, 1, 5, base, null)
    const auditor = pb.buildChunkMessages(chunk, 0, 1, 5, base, pm.PERSONA_BY_ID.auditor)
    const custom = pb.buildChunkMessages(chunk, 0, 1, 5, base,
      pm.resolvePersonas({ ...base, personaIds: ['custom'], customPersona: 'A night-shift nurse on a phone' })[0])

    const sysOf = (x) => x.messages.find((mm) => mm.role === 'system').content
    const usrOf = (x) => x.messages.find((mm) => mm.role === 'user').content

    return {
      neutralHasNoPersona: !/PERSONA/.test(sysOf(neutral)),
      auditorNamed: /PERSONA/.test(sysOf(auditor)) && /Auditor/.test(sysOf(auditor)),
      auditorTraits: /compliance|audit/i.test(sysOf(auditor)),
      auditorInUserPrompt: /point of view of: Auditor/.test(usrOf(auditor)),
      forbidsNaming: /Never name or address the persona/i.test(sysOf(auditor)),
      keepsGrounding: /never changes the facts/i.test(sysOf(auditor)),
      customFreeText: /night-shift nurse on a phone/.test(sysOf(custom)),
      // The Mock provider parses this phrase; it must survive persona injection
      countPhraseIntact: /Generate exactly 5 question-answer pairs/.test(usrOf(auditor)),
      excerptPresent: /draining the queue/.test(usrOf(auditor)),
    }
  }, BASE_SETTINGS)

  check('no persona leaves the prompt neutral', prompts.neutralHasNoPersona)
  check('persona block names the persona', prompts.auditorNamed)
  check('persona traits reach the prompt', prompts.auditorTraits)
  check('user prompt states the point of view', prompts.auditorInUserPrompt)
  check('prompt forbids naming the persona in answers', prompts.forbidsNaming)
  check('prompt keeps answers grounded in the excerpt', prompts.keepsGrounding)
  check('custom persona text is passed through verbatim', prompts.customFreeText)
  check('"Generate exactly N" phrasing survives', prompts.countPhraseIntact)
  check('excerpt still included', prompts.excerptPresent)

  // ── Cost estimate ────────────────────────────────────────────────────────
  console.log('\nEstimate accounts for personas')
  const est = await p.evaluate(async (base) => {
    const pr = await import('/src/utils/pricing.js')
    const doc = { id: 'd', name: 'd.md', kind: 'prose', text: 'x'.repeat(12000) }
    const one = pr.estimateRun([doc], { ...base, providerSlug: 'openai', model: 'gpt-4o-mini' })
    const three = pr.estimateRun([doc], {
      ...base, providerSlug: 'openai', model: 'gpt-4o-mini',
      personaIds: ['newcomer', 'expert', 'auditor'],
    })
    return {
      oneReq: one.chunkCount, threeReq: three.chunkCount,
      onePairs: one.totalPairs, threePairs: three.totalPairs,
      oneIn: one.inputTokens, threeIn: three.inputTokens,
      oneCost: one.costUSD, threeCost: three.costUSD,
    }
  }, BASE_SETTINGS)

  check('more personas means more requests', est.threeReq > est.oneReq,
    `${est.oneReq} → ${est.threeReq}`)
  check('pair count is unchanged', est.onePairs === est.threePairs,
    `${est.onePairs} vs ${est.threePairs}`)
  check('input tokens rise with personas', est.threeIn > est.oneIn,
    `${est.oneIn} → ${est.threeIn}`)
  check('estimated cost rises', est.threeCost > est.oneCost,
    `${est.oneCost} → ${est.threeCost}`)

  // ── End to end with the Mock provider ────────────────────────────────────
  console.log('\nGeneration tags pairs by persona')
  await p.evaluate(async () => {
    localStorage.clear()
    await new Promise((r) => {
      const q = indexedDB.deleteDatabase('synthgen')
      q.onsuccess = q.onerror = q.onblocked = () => r()
    })
  })
  await p.goto(APP, { waitUntil: 'networkidle0' })
  await sleep(500)

  const setVal = (sel, v) => p.$eval(sel, (el, x) => {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, x)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, v)
  // Matched against trimmed text, case-insensitively: the source tabs render
  // capitalised via CSS but their textContent is the raw lowercase value.
  const clickText = async (re) => {
    await p.evaluate((src) => {
      const rx = new RegExp(src, 'i')
      const b = [...document.querySelectorAll('button')].find((x) => rx.test(x.textContent.trim()))
      if (b) b.click()
    }, re)
    await sleep(350)
  }

  await p.select('select', 'mock')
  await sleep(300)
  await clickText('^Paste$')
  await setVal('textarea[placeholder*="Paste your document"]',
    'The rollback procedure drains the queue before redeploying the previous tag. ' +
    'Migrations run forward only. On-call is paged when the error rate exceeds two percent.')
  await clickText('Add Document')

  // Pick two personas — one click per tick. Clicking both inside a single
  // evaluate lets React batch them, so the second handler reads pre-click
  // state and silently overwrites the first selection.
  for (const label of ['Newcomer', 'Auditor']) {
    await p.evaluate((name) => {
      const b = [...document.querySelectorAll('button[aria-pressed]')].find(
        (x) => x.textContent.trim().startsWith(name))
      if (b) b.click()
    }, label)
    await sleep(250)
  }
  await sleep(300)

  const pickerState = await p.evaluate(() => ({
    pressed: [...document.querySelectorAll('button[aria-pressed="true"]')].map((b) =>
      b.textContent.trim().split(/\s{2,}|\n/)[0]),
    hint: /split across 2 personas/i.test(document.body.innerText),
  }))
  check('picker marks both personas selected', pickerState.pressed.length === 2,
    JSON.stringify(pickerState.pressed))
  check('picker explains the split', pickerState.hint)

  await setVal('input[type="range"]', '8')
  await sleep(200)
  await clickText('Generate Dataset')
  await p.waitForFunction(() => /\d+ pairs/.test(document.body.innerText), { timeout: 30000 })
    .catch(() => {})
  await sleep(1500)

  const result = await p.evaluate(() => {
    // Scope to pair cards: the persona picker's own buttons contain spans with
    // exactly these labels, which would otherwise pass this check on their own.
    const badges = [...document.querySelectorAll('span')]
      .filter((s) => !s.closest('button[aria-pressed]'))
      .map((s) => s.textContent.trim())
      .filter((t) => t === 'Newcomer' || t === 'Auditor')
    return {
      badgeCount: badges.length,
      hasBoth: badges.includes('Newcomer') && badges.includes('Auditor'),
      hasPersonaFilter: /All personas/.test(document.body.innerText),
    }
  })
  check('pairs are badged with their persona', result.badgeCount > 0, `${result.badgeCount} badges`)
  check('both personas appear in the results', result.hasBoth)
  check('persona filter appears once personas are used', result.hasPersonaFilter)

  // Filtering by persona narrows the set
  const filtered = await p.evaluate(async () => {
    const sel = [...document.querySelectorAll('select')]
      .find((s) => /All personas/.test(s.textContent))
    if (!sel) return null
    const before = (document.body.innerText.match(/(\d+) pairs/) || [])[1]
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(sel, 'auditor')
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 500))
    return { before, after: document.body.innerText.match(/(\d+) of (\d+) pairs/)?.[0] ?? null }
  })
  check('filtering by persona narrows results', !!filtered?.after, JSON.stringify(filtered))

  console.log('\nPage errors:', errs.length ? errs : 'none')
  if (errs.length) fail += errs.length
  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
