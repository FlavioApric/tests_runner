#!/usr/bin/env node
// S1 knowledge graph (optional): wraps graphify, used BY REFERENCE (not vendored). Pinned: pip install graphifyy==0.9.91
// Builds or updates graphify-out/ for every qa.config app.src root; the researchers in S2 query it
// (graphify query / path / explain) next to the inventory. Exit 3 (deferred) when graphify is not installed.
//   node qa-pack/scripts/graph.mjs [--project <dir>] [--check]
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { args, has, isMain } from '../lib/util.mjs'

export const GRAPHIFY_PIN = 'graphifyy==0.9.91'

if (isMain(import.meta.url)) {
  const a = args(), cfg = loadConfig(projectDirFrom())
  if (!has('graphify', ['--help'])) { console.log(`graphify is not installed: pip install ${GRAPHIFY_PIN} (step deferred, the flow goes on without the graph)`); process.exit(3) }
  const out = cfg.abs('graph')
  if (a.flag('--check')) { const ok = fs.existsSync(out); console.log(ok ? `graph present: ${cfg.paths.graph}` : `no ${cfg.paths.graph}: run graph.mjs`); process.exit(ok ? 0 : 1) }
  // graphify writes <root>/graphify-out/graph.json per root (a root without code files, e.g. HTML only, has
  // none and is skipped); the per-root graphs are then merged into paths.graph for the S2 researchers
  const run = (argv) => spawnSync('graphify', argv, { cwd: cfg.dir, stdio: 'inherit', shell: process.platform === 'win32' }).status
  const graphs = [], skipped = []
  for (const src of cfg.app.src) {
    console.log(`graphify update ${src}`)
    run(['update', src])
    const g = path.join(src, 'graphify-out', 'graph.json')
    if (fs.existsSync(path.join(cfg.dir, g))) graphs.push(g); else skipped.push(src)
  }
  if (skipped.length) console.log(`no graph for ${skipped.join(', ')} (no code files graphify reads)`)
  if (!graphs.length) { console.log('graphify produced no graph'); process.exit(1) }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  if (graphs.length === 1) fs.copyFileSync(path.join(cfg.dir, graphs[0]), out)
  else if (run(['merge-graphs', ...graphs, '--out', path.relative(cfg.dir, out)]) !== 0) { console.log('graphify merge-graphs failed'); process.exit(1) }
  const ok = fs.existsSync(out)
  console.log(ok ? `graph updated: ${path.relative(cfg.dir, out)} from ${graphs.length} root(s)` : `no ${cfg.paths.graph} after the merge`)
  process.exit(ok ? 0 : 1)
}
