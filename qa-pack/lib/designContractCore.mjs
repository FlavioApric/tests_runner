// Design-contract checker (no test-runner dependency, so it also runs from plain node + playwright).
// Contract files: <contracts>/<screen>.json, tokens in <contracts>/tokens.json ({ light: {name: css}, dark: {...} }).
import fs from 'node:fs'
import path from 'node:path'

// Contract dir: opts.dir, else QA_CONTRACT_DIR (set by qa-pack/lib/playwright-config.mjs from qa.config.json paths.contracts).
export const contractDir = (dir) => dir ?? process.env.QA_CONTRACT_DIR ?? path.resolve('qa/design/contract')
export const loadContract = (screen, dir) => JSON.parse(fs.readFileSync(path.join(contractDir(dir), `${screen}.json`), 'utf8'))
export const loadTokens = (dir) => JSON.parse(fs.readFileSync(path.join(contractDir(dir), 'tokens.json'), 'utf8'))

const locate = (page, loc) => {
  if (typeof loc === 'string') return page.locator(loc)
  if (loc.role) return page.getByRole(loc.role, { name: loc.name, exact: loc.exact ?? true })
  if (loc.text) return page.getByText(loc.text, { exact: loc.exact ?? true })
  if (loc.label) return page.getByLabel(loc.label, { exact: true })
  if (loc.testid) return page.getByTestId(loc.testid)
  throw new Error(`unsupported locator ${JSON.stringify(loc)}`)
}

// resolve a colour/length token to what the browser computes for it (handles color-mix, rgba, etc.)
async function computedToken(page, name, dark, prop, dir) {
  const tokens = loadTokens(dir); const raw = (dark ? tokens.dark : tokens.light)[name]
  if (raw === undefined) throw new Error(`unknown token ${name}`)
  const r = await page.evaluate(([v, p]) => { const d = document.createElement('div'); d.style[p] = v; document.body.append(d); const r = getComputedStyle(d)[p]; d.remove(); return r }, [raw, prop])
  return /color|background/i.test(prop) ? toRgba(page, r) : r
}
// any CSS colour (rgb, rgba, color(), color-mix, oklch...) to sRGB through a canvas, as the user's screen would draw it
const toRgba = (page, css) => page.evaluate((c) => { const k = document.createElement('canvas'); k.width = k.height = 1; const x = k.getContext('2d', { willReadFrequently: true }); x.clearRect(0, 0, 1, 1); x.fillStyle = '#000'; x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${+(d[3] / 255).toFixed(3)})` }, css)
const rgbaOf = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 } }
// a pill radius (9999px) computes to a huge number: anything >= 9999px is the same full-round shape
const sameLength = (a, b) => { const x = parseFloat(a), y = parseFloat(b); return (x >= 9999 && y >= 9999) || Math.abs(x - y) < 0.5 }
const sameColour = (a, b, tol = 1) => { const x = rgbaOf(a), y = rgbaOf(b); return !!x && !!y && Math.abs(x.r - y.r) <= tol && Math.abs(x.g - y.g) <= tol && Math.abs(x.b - y.b) <= tol && Math.abs(x.a - y.a) <= 0.02 }
const lum = ({ r, g, b }) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

export async function checkKey(page, key, spec, { dark = false, dir } = {}) {
  const fails = []
  const fail = (m) => fails.push(`${key}: ${m}`)
  const vw = page.viewportSize().width
  if ((spec.viewport === 'desktop' && vw < 768) || (spec.viewport === 'mobile' && vw >= 768)) return fails
  const all = locate(page, spec.locator)
  const checks = { ...(spec.checks ?? {}), ...(dark ? spec.darkChecks ?? {} : {}) }
  const n = await all.count()
  if (checks.count !== undefined) { if (n !== checks.count) fail(`count ${n}, expected ${checks.count}`) }
  else if (checks.visible !== false && n === 0) { fail(`element not found (${JSON.stringify(spec.locator)})`); return fails }
  if (checks.visible === false) { if (n && await all.first().isVisible()) fail('must not be visible'); return fails }
  if (n === 0) return fails
  const el = all.first()
  if (!(await el.isVisible())) { fail('not visible'); return fails }
  const box = await el.boundingBox(); const vp = page.viewportSize()
  const st = await el.evaluate((e) => { const c = getComputedStyle(e); return { color: c.color, bg: c.backgroundColor, fs: c.fontSize, fw: c.fontWeight, br: c.borderTopLeftRadius, ff: c.fontFamily, clamp: c.webkitLineClamp, text: (e.innerText ?? '').replace(/\s+/g, ' ').trim(), href: e.getAttribute('href') ?? e.closest('a')?.getAttribute('href') ?? null, nw: e.naturalWidth ?? null, nh: e.naturalHeight ?? null, ok: e.complete ?? null } })
  st.color = await toRgba(page, st.color); st.bg = await toRgba(page, st.bg)
  if (checks.minFontPx !== undefined && parseFloat(st.fs) < checks.minFontPx) fail(`font-size ${st.fs} below ${checks.minFontPx}px`)
  if (checks.text !== undefined && st.text !== checks.text) fail(`text "${st.text.slice(0, 80)}" != "${checks.text}"`)
  if (checks.textMatches && !new RegExp(checks.textMatches).test(st.text)) fail(`text "${st.text.slice(0, 80)}" does not match /${checks.textMatches}/`)
  if (checks.href !== undefined && st.href !== checks.href) fail(`href ${st.href} != ${checks.href}`)
  if (checks.hrefMatches && !new RegExp(checks.hrefMatches).test(st.href ?? '')) fail(`href ${st.href} does not match /${checks.hrefMatches}/`)
  if (checks.minSize && (box.width < checks.minSize[0] || box.height < checks.minSize[1])) fail(`size ${Math.round(box.width)}x${Math.round(box.height)} < ${checks.minSize.join('x')}`)
  if (checks.minTouch && (box.width < checks.minTouch || box.height < checks.minTouch)) fail(`touch target ${Math.round(box.width)}x${Math.round(box.height)} < ${checks.minTouch}`)
  if (checks.width) { const [w, tol = 1] = checks.width; if (Math.abs(box.width - w) > tol) fail(`width ${box.width} != ${w}+-${tol}`) }
  if (checks.height) { const [h, tol = 1] = checks.height; if (Math.abs(box.height - h) > tol) fail(`height ${box.height} != ${h}+-${tol}`) }
  if (checks.heightVh) { const [v, tol = 1] = checks.heightVh; const exp = vp.height * v / 100; if (Math.abs(box.height - exp) > tol + 1) fail(`height ${box.height} != ${v}vh (${exp})`) }
  if (checks.fontSizePx !== undefined && Math.abs(parseFloat(st.fs) - checks.fontSizePx) > 0.5) fail(`font-size ${st.fs} != ${checks.fontSizePx}px`)
  if (checks.fontSizeToken) { const e = await computedToken(page, checks.fontSizeToken, dark, 'fontSize', dir); if (e !== st.fs) fail(`font-size ${st.fs} != ${checks.fontSizeToken} (${e})`) }
  if (checks.fontWeight !== undefined && Number(st.fw) !== checks.fontWeight) fail(`font-weight ${st.fw} != ${checks.fontWeight}`)
  if (checks.fontFamilyIncludes && !st.ff.toLowerCase().includes(checks.fontFamilyIncludes.toLowerCase())) fail(`font-family ${st.ff} lacks ${checks.fontFamilyIncludes}`)
  if (checks.colorToken) { const e = await computedToken(page, checks.colorToken, dark, 'color', dir); if (!sameColour(st.color, e)) fail(`color ${st.color} != ${checks.colorToken} (${e})`) }
  if (checks.backgroundToken) { const e = await computedToken(page, checks.backgroundToken, dark, 'backgroundColor', dir); if (!sameColour(st.bg, e)) fail(`background ${st.bg} != ${checks.backgroundToken} (${e})`) }
  if (checks.backgroundRgba && !sameColour(st.bg, await toRgba(page, checks.backgroundRgba))) fail(`background ${st.bg} != ${checks.backgroundRgba}`)
  if (checks.radiusToken) { const e = await computedToken(page, checks.radiusToken, dark, 'borderRadius', dir); if (!sameLength(st.br, e)) fail(`radius ${st.br} != ${checks.radiusToken} (${e})`) }
  if (checks.radiusPx !== undefined && parseFloat(st.br) !== checks.radiusPx) fail(`radius ${st.br} != ${checks.radiusPx}px`)
  if (checks.lineClamp !== undefined && Number(st.clamp) !== checks.lineClamp) fail(`line-clamp ${st.clamp} != ${checks.lineClamp}`)
  if (checks.contrastMin) { // nearest non-transparent background up the tree, normalised like the colours above
    const fg = rgbaOf(st.color)
    const bgCss = await el.evaluate((e) => { let n = e; while (n) { const c = getComputedStyle(n).backgroundColor; if (!/rgba\(.*, 0\)|transparent/.test(c)) return c; n = n.parentElement } return 'rgb(255,255,255)' })
    const bg = rgbaOf(await toRgba(page, bgCss))
    if (!fg || !bg) fail('contrast not computable (unparsable colour)')
    else { const r = ratio(fg, bg); if (r < checks.contrastMin) fail(`contrast ${r.toFixed(2)} < ${checks.contrastMin}`) }
  }
  if (checks.image) { // real pixels the user gets: loaded, enough resolution for the slot at this dpr, right aspect
    const dpr = await page.evaluate(() => window.devicePixelRatio)
    if (!st.ok || !st.nw) fail('image not loaded')
    else {
      const minW = checks.image.minNaturalWidth ?? 0, need = Math.ceil(box.width * dpr * (checks.image.dprFactor ?? 1))
      if (st.nw < Math.max(minW, need)) fail(`image ${st.nw}x${st.nh} too small for ${Math.round(box.width)}px css at dpr ${dpr} (need ${Math.max(minW, need)})`)
      if (checks.image.aspect) { const [a, tol = 0.02] = checks.image.aspect; if (Math.abs(st.nw / st.nh - a) > tol * a) fail(`aspect ${(st.nw / st.nh).toFixed(3)} != ${a}`) }
    }
  }
  return fails
}

// contract-level preparation before checking: [{ click: <locator> }, { fill: [<locator>, 'text'] }, { goto: '/path' }]
export async function prepare(page, steps = []) {
  for (const st of steps) {
    if (st.click) await locate(page, st.click).first().click()
    else if (st.fill) await locate(page, st.fill[0]).first().fill(st.fill[1])
    else if (st.goto) await page.goto(new URL(st.goto, page.url()).toString(), { waitUntil: 'networkidle' })
    else if (st.wait) await page.waitForTimeout(st.wait)
  }
}
// run every key (or a subset) of a screen contract; returns the list of failures (empty = design matches)
export async function verifyContract(page, screen, { keys, dark = false, dir } = {}) {
  const c = loadContract(screen, dir), fails = []
  await prepare(page, c.prepare)
  for (const [k, spec] of Object.entries(c.keys)) { if (keys && !keys.includes(k)) continue; fails.push(...(await checkKey(page, k, spec, { dark, dir }))) }
  return fails
}
