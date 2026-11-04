#!/usr/bin/env node
// S5 static check of the design contracts (<paths.contracts>/<screen>.json + tokens.json), the format read by
// qa-pack/lib/designContractCore.mjs. Unknown checks, missing locators and unknown tokens are errors.
//   node qa-pack/scripts/validate-contract.mjs [--project <dir>] [--strict]
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { args, read, readJson, walk, isMain } from '../lib/util.mjs'

export const CHECKS = new Set(['count', 'visible', 'minFontPx', 'text', 'textMatches', 'href', 'hrefMatches', 'minSize', 'minTouch', 'width', 'height', 'heightVh', 'fontSizePx', 'fontSizeToken', 'fontWeight', 'fontFamilyIncludes', 'colorToken', 'backgroundToken', 'backgroundRgba', 'radiusToken', 'radiusPx', 'lineClamp', 'contrastMin', 'image'])
const LOCATORS = ['role', 'text', 'label', 'testid']
const TOKEN_CHECKS = ['fontSizeToken', 'colorToken', 'backgroundToken', 'radiusToken']

export function validateContracts(cfg, { strict = false } = {}) {
  const dir = cfg.abs('contracts'), errors = [], screens = []
  const tp = path.join(dir, 'tokens.json')
  const tokens = fs.existsSync(tp) ? readJson(tp) : null
  for (const f of walk(dir, (p) => p.endsWith('.json') && path.basename(p) !== 'tokens.json')) {
    const rel = cfg.rel(f), screen = path.basename(f, '.json')
    let c; try { c = readJson(f) } catch (e) { errors.push(`${rel}: invalid JSON (${e.message})`); continue }
    if (c.screen !== screen) errors.push(`${rel}: "screen" must be "${screen}" (the file name)`)
    if (!c.keys || !Object.keys(c.keys).length) errors.push(`${rel}: no keys`)
    for (const [k, spec] of Object.entries(c.keys ?? {})) {
      const at = `${rel} ${k}`, loc = spec.locator
      if (!loc || (typeof loc !== 'string' && !LOCATORS.some((x) => loc[x]))) errors.push(`${at}: locator must be a CSS string or { ${LOCATORS.join(' | ')} }`)
      for (const ck of Object.keys({ ...(spec.checks ?? {}), ...(spec.darkChecks ?? {}) })) if (!CHECKS.has(ck)) errors.push(`${at}: unknown check "${ck}"`)
      if (spec.viewport && !['mobile', 'desktop'].includes(spec.viewport)) errors.push(`${at}: viewport must be mobile or desktop`)
      for (const t of TOKEN_CHECKS) {
        const name = spec.checks?.[t] ?? spec.darkChecks?.[t]; if (!name) continue
        if (!tokens) errors.push(`${at}: ${t} ${name} but no tokens.json`)
        else if (tokens.light?.[name] === undefined) errors.push(`${at}: unknown token ${name}`)
      }
    }
    if (strict && /TODO\(qa-pack\)/.test(read(f))) errors.push(`${rel}: TODO(qa-pack) left (strict)`)
    screens.push(screen)
  }
  return { screens, errors }
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  const { screens, errors } = validateContracts(cfg, { strict: a.flag('--strict') })
  errors.forEach((e) => console.log(`error: ${e}`))
  console.log(`${screens.length} contract(s), ${errors.length} error(s)`)
  process.exit(errors.length ? 1 : 0)
}
