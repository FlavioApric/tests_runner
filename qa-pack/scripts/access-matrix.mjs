#!/usr/bin/env node
// S6 access matrix: every route x every persona -> the expected outcome, extracted from the router by an adapter
// (qa-pack/adapters/router/<adapter>.mjs: express | react-router | json). The compiled access spec replays it.
//   allow = 'all' | 'session' | [roles]. A refused cell expects qa.config router.deny.guest (no session) or
//   router.deny.session (signed in, wrong role): 'status:401', 'status:403' or 'redirect:/login'.
//   node qa-pack/scripts/access-matrix.mjs [--project <dir>] [--check]
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { PACK_DIR, args, read, write, isMain } from '../lib/util.mjs'

export function expectation(cfg, persona, allow) {
  const signedIn = persona.session !== false
  const ok = allow === 'all' || (allow === 'session' && signedIn) || (Array.isArray(allow) && signedIn && allow.includes(persona.role))
  if (ok) return 'allow'
  return signedIn ? cfg.router?.deny?.session ?? 'status:403' : cfg.router?.deny?.guest ?? 'status:401'
}

export async function buildMatrix(cfg) {
  const adapter = cfg.router?.adapter
  if (!adapter) return { doc: null, errors: ['qa.config router.adapter is not set'] }
  const mod = await import(new URL(`file:///${path.join(PACK_DIR, 'adapters', 'router', `${adapter}.mjs`).replace(/\\/g, '/')}`))
  const errors = [], routes = []
  const files = adapter === 'json' ? [null] : cfg.router.files ?? []
  for (const f of files) {
    if (f && !fs.existsSync(path.join(cfg.dir, f))) { errors.push(`router file ${f} not found`); continue }
    routes.push(...mod.extract(f ? read(path.join(cfg.dir, f)) : '', f, cfg))
  }
  if (!routes.length) errors.push(`adapter ${adapter} found no route in ${files.join(', ') || 'router.routes'}`)
  const seen = new Set()
  const uniq = routes.filter((r) => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  const cells = []
  for (const r of uniq) for (const p of cfg.personas) cells.push({ method: r.method, path: r.path, persona: p.key, expect: expectation(cfg, p, r.allow) })
  return { doc: { schema: 'qa-pack/access@1', adapter, personas: cfg.personas.map((p) => ({ key: p.key, role: p.role, session: p.session !== false })), routes: uniq, cells }, errors }
}

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  const { doc, errors } = await buildMatrix(cfg)
  errors.forEach((e) => console.log(`error: ${e}`))
  if (!doc || errors.length) process.exit(1)
  const text = JSON.stringify(doc, null, 1) + '\n', out = cfg.abs('access')
  if (a.flag('--check')) {
    const stale = !fs.existsSync(out) || read(out).replace(/\r/g, '') !== text
    console.log(stale ? `stale: ${cfg.paths.access} (run access-matrix.mjs)` : `access matrix up to date: ${doc.routes.length} routes x ${doc.personas.length} personas`)
    process.exit(stale ? 1 : 0)
  }
  write(out, text)
  console.log(`access matrix: ${doc.routes.length} routes x ${doc.personas.length} personas = ${doc.cells.length} cells -> ${cfg.paths.access}`)
}
