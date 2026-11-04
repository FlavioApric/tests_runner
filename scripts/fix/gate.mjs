// Picks and runs the checks a fix needs from the files changed against the base, and prints the delivery type.
// The path->type rules and the path->check map come from fix.config.json (deliveryRules, checks).
//   node scripts/fix/gate.mjs                 changed files vs <remote>/<baseBranch> (committed + working tree), run the checks
//   node scripts/fix/gate.mjs --list          print the checks and the delivery type, run nothing
//   node scripts/fix/gate.mjs --full          every check with full !== false
//   node scripts/fix/gate.mjs --stack         also the checks marked "stack" (need a local stack)
//   node scripts/fix/gate.mjs --base <ref>    compare with another ref
//   node scripts/fix/gate.mjs --files a,b     classify these files instead of asking git
//   node scripts/fix/gate.mjs --json          machine-readable summary (implies --list)
// Exit 1: a check failed, or the change has a blocking type (blockingTypes, for example native).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { changedFiles, classify, fail, gitIn, loadConfig, normalizePath, ownerAction, parseArgs, pickChecks } from './lib.mjs'

const { flags, values } = parseArgs(process.argv.slice(2), ['--base', '--files', '--config'])
let cfg
try { cfg = loadConfig({ path: values['--config'] }) } catch (e) { fail(e.message) }
const base = values['--base'] ?? cfg.base
const full = flags.has('--full'), stack = flags.has('--stack'), json = flags.has('--json')
const listOnly = flags.has('--list') || json

let files
if (values['--files'] !== undefined) files = values['--files'].split(',').filter(Boolean).map(normalizePath)
else {
  try { files = changedFiles(cfg.root, base) } catch (e) { fail(`cannot diff against ${base}: ${e.message.split('\n')[0]}`) }
}

let manifests = {}
if (cfg.nativeDeps && files.includes(cfg.nativeDeps.manifest)) {
  try {
    const now = join(cfg.root, cfg.nativeDeps.manifest)
    manifests = { baseManifest: gitIn(cfg.root, ['show', `${base}:${cfg.nativeDeps.manifest}`]), nowManifest: existsSync(now) ? readFileSync(now, 'utf8') : undefined }
  } catch { /* no manifest at base: nothing to compare */ }
}
const c = classify(cfg, files, manifests)
const checks = pickChecks(cfg, files, c.kinds, { full, stack })

if (json) {
  console.log(JSON.stringify({ files, delivery: c.top, kinds: c.kinds, blocking: c.blocking, reasons: c.reasons, perFile: c.perFile, checks: checks.map(({ name, cmd, cwd }) => ({ name, cmd, cwd })) }, null, 2))
  process.exit(c.blocking ? 1 : 0)
}

console.log(`changed files: ${files.length}`)
console.log(`delivery: ${c.top}${c.kinds.length > 1 ? `  (parts: ${c.kinds.join(', ')})` : ''}`)
console.log(`next: ${ownerAction(cfg, c.top)}`)
for (const r of c.reasons) console.log(`  blocking: ${r}`)
console.log(checks.length ? `checks:\n${checks.map((k) => `  - ${k.name}: ${k.cmd}${k.cwd === '.' ? '' : `   (in ${k.cwd})`}`).join('\n')}` : 'checks: none for these files')
const skippedStack = cfg.checks.filter((k) => k.stack && !stack && !full && !checks.includes(k) && pickChecks(cfg, files, c.kinds, { stack: true }).includes(k))
if (skippedStack.length) console.log(`note: not run without --stack: ${skippedStack.map((k) => k.name).join(', ')}`)

let failed = c.blocking
if (!listOnly) {
  for (const k of checks) {
    process.stdout.write(`\n== ${k.name}\n`)
    const r = spawnSync(k.cmd, { cwd: join(cfg.root, k.cwd), stdio: 'inherit', shell: true })
    if (r.status !== 0) { failed = true; console.log(`FAILED: ${k.name} (exit ${r.status})`) } else console.log(`ok: ${k.name}`)
  }
}
if (c.blocking) console.log(`\nFAILED: blocking delivery type (${c.kinds.filter((k) => cfg.blockingTypes.includes(k)).join(', ')}): no fast path.`)
process.exit(failed ? 1 : 0)
