#!/usr/bin/env node
// qa-pack backend runner (S6 backend layers). Dispatches to qa-pack/adapters/backend/<qa.config backend.adapter>.mjs.
//   node qa-pack/runners/backend.mjs [--project <dir>] [--layer all|<name>,...] [--dry] [--json]
// Every adapter exports `layers(cfg)` -> [{ name, what, requires: [capability], files: [..], run(cfg) -> exit code }].
// A file that still carries backend.scaffoldMarker (default QA-SCAFFOLD) is a PENDING scaffold: red, never green.
// Exit codes: 0 green, 1 red (a failing layer or a scaffold), 2 usage, 3 deferred (a capability is missing here).
// Red wins over deferred. Local stack only: an adapter never writes to production.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { probeCaps } from '../lib/flow.mjs'
import { PACK_DIR, args, read, isMain } from '../lib/util.mjs'

export async function loadAdapter(cfg) {
  if (cfg.backend.adapter === 'none') return null
  const p = path.join(PACK_DIR, 'adapters', 'backend', `${cfg.backend.adapter}.mjs`)
  if (!fs.existsSync(p)) throw Object.assign(new Error(`unknown backend adapter ${cfg.backend.adapter}`), { code: 2 })
  return import(pathToFileURL(p).href)
}

export const scaffolds = (cfg, files) => files.filter((f) => { const p = path.join(cfg.dir, f); return fs.existsSync(p) && fs.statSync(p).isFile() && read(p).includes(cfg.backend.scaffoldMarker) })

export async function runBackend(cfg, { layer = 'all', dry = false } = {}) {
  const ad = await loadAdapter(cfg)
  if (!ad) return { code: 0, results: [], note: 'backend.adapter is none: G3 not applicable' }
  const all = ad.layers(cfg), want = layer === 'all' ? all.map((l) => l.name) : layer.split(',')
  for (const w of want) if (!all.some((l) => l.name === w)) throw Object.assign(new Error(`unknown layer ${w} (adapter ${cfg.backend.adapter}: ${all.map((l) => l.name).join(', ')})`), { code: 2 })
  const caps = await probeCaps(cfg, [...new Set(all.flatMap((l) => l.requires))])
  const results = []
  for (const l of all.filter((x) => want.includes(x.name))) {
    const sc = scaffolds(cfg, l.files)
    const missing = l.requires.filter((r) => !caps[r]?.ok)
    let status
    if (sc.length) status = 'red'
    else if (!l.files.length) status = 'empty'
    else if (missing.length) status = 'deferred'
    else if (dry) status = 'would-run'
    else status = (await l.run(cfg)) === 0 ? 'green' : 'red'
    results.push({ layer: l.name, what: l.what, files: l.files.length, scaffolds: sc, missing, status })
  }
  const code = results.some((r) => r.status === 'red') ? 1 : results.some((r) => r.status === 'deferred') ? 3 : 0
  return { code, results }
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  try {
    const r = await runBackend(cfg, { layer: a.opt('--layer', 'all'), dry: a.flag('--dry') })
    if (a.flag('--json')) console.log(JSON.stringify(r, null, 1))
    else {
      if (r.note) console.log(r.note)
      for (const x of r.results) {
        console.log(`${x.status.padEnd(9)} ${x.layer.padEnd(10)} ${x.what} (${x.files} file(s))`)
        x.scaffolds.forEach((s) => console.log(`          PENDING scaffold: ${s}`))
        if (x.missing.length) console.log(`          missing: ${x.missing.join(', ')} (pack capabilities)`)
      }
    }
    process.exit(r.code)
  } catch (e) { console.error(e.message); process.exit(typeof e.code === 'number' ? e.code : 1) }
}
