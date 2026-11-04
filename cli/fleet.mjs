#!/usr/bin/env node
// qa-fleet CLI. Local commands (your PC):
//   keygen                         create the result key pair (private key -> identity file, prints the PUBLIC recipient)
//   status                         runners, free slots, setup gaps (no secret is printed)
//   validate [--project dir]       check <project>/.qa-fleet/units.json
//   plan     [--project dir] [--only a,b] [--tags t]                  what would run where
//   run      --source name --ref branch [--project dir] [--only ..] [--tags ..] [--dry] [--json-out file] [--no-retry]
//            [--via coordinator]   start coordinate.yml in your tests_runner repo instead (you approve it on GitHub)
//   pull     --gh-run <id> [--project dir]   download + decrypt the bundle of a coordinator run
//   explore  --run <runId> [--project dir]   briefs for the LOCAL Claude explorers (agent units) of a run
//   watch|collect|summary|cancel --run <runId>
//   tokens   [--card path]         what each token of the card can read, and when it expires (no token printed)
//   init     --kind playwright|vitest|jest|pytest|go|maestro|gradle|shell [--shards N] [--project dir]
// Fleet card (one file with tokens + instructions, see card/QA-FLEET-CARD.md; --card defaults to QA_FLEET_CARD
// or ~/.qa-fleet/QA-FLEET-CARD.md):
//   card new [--out path]          write an empty card to fill (default ~/.qa-fleet/QA-FLEET-CARD.md)
//   card check [--card path]       card filled correctly? runners reachable and set up? which branch has the tests?
//   card seal [--card path]        print nothing secret: shows the sizes; bootstrap --coordinator uploads the sealed card
//   bootstrap [--card path] [--only owner,owner] [--dry] [--force-template]   set up every runner repo from the card
//   bootstrap --coordinator [--dry]   environment "fleet" + FLEET_CARD_SEALED/FLEET_CARD_KEY + FLEET_COORDINATOR in tests_runner
//   branch [--card path]           which source branch carries the full tests
//   checkout --dir path [--branch b] [--card path]   read-only local copy of the test branch
// Runner-side commands (used by the workflow):
//   matrix   --project src --units a,b       -> JSON matrix for the workflow
//   unit-env --project src --unit id         -> prints the unit command env (cmd, results) as KEY=VALUE lines
//   secrets-env --names A,B --out file       -> writes only the named secrets from $ALL_SECRETS into an env file
//   coordinate --source s --ref r [--only ..] [--tags ..] --out dir   (coordinate.yml only: env FLEET_CARD_SEALED + FLEET_CARD_KEY)
//   seal     --in file --out file --recipient qafpub1:...
//   open     --in file --out file [--identity path]
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, publicView, identityOf } from '../lib/config.mjs'
import { loadUnits, validateUnits, matrixEntry } from '../lib/units.mjs'
import * as fleet from '../lib/fleet.mjs'
import { generateKeys, sealFile, openFile } from '../lib/crypto.mjs'
import { initProject } from '../lib/init.mjs'
import { bootstrap, findBranch, checkout } from '../lib/bootstrap.mjs'
import { validateCard, readCard } from '../lib/card.mjs'
import { coordinate, viaCoordinator, pull, setupCoordinator, sealCard } from '../lib/coordinator.mjs'
import { exploreBriefs } from '../lib/explore.mjs'
import { tokenReport } from '../lib/tokens.mjs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (f) => argv.includes(f)
const val = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d)
const list = (f) => val(f)?.split(',').map((s) => s.trim()).filter(Boolean)
const project = path.resolve(val('--project', '.'))
const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 1))
const cardPath = () => path.resolve(val('--card', process.env.QA_FLEET_CARD || path.join(os.homedir(), '.qa-fleet', 'QA-FLEET-CARD.md')))
const die = (m, c = 1) => { console.error(`fleet: ${m}`); process.exit(c) }

try {
  switch (cmd) {
    case 'keygen': {
      const cfgPath = process.env.QA_FLEET_CONFIG || path.join(process.env.USERPROFILE || process.env.HOME, '.qa-fleet', 'fleet.json')
      const idPath = val('--identity', path.join(path.dirname(cfgPath), 'identity.key'))
      if (fs.existsSync(idPath) && !flag('--force')) die(`${idPath} exists (use --force to replace it: old results can no longer be opened)`)
      const k = generateKeys()
      fs.mkdirSync(path.dirname(idPath), { recursive: true })
      fs.writeFileSync(idPath, k.identity + '\n', { mode: 0o600 })
      out(`private key written to ${idPath} (keep it only on this PC)\nPUBLIC recipient (set as variable FLEET_RECIPIENT on every runner repo):\n${k.recipient}`)
      break
    }
    case 'status': out(await fleet.status()); break
    case 'validate': { const doc = JSON.parse(fs.readFileSync(path.join(project, '.qa-fleet', 'units.json'), 'utf8')); const e = validateUnits(doc); if (e.length) die(`invalid units.json:\n- ${e.join('\n- ')}`); out(`ok: ${doc.units.length} units`); break }
    case 'plan': {
      let st = null
      try { st = (await fleet.status()).runners } catch { /* plan offline with maxParallel */ }
      let cfg
      try { cfg = loadConfig() } catch (e) { if (e.code !== 'NO_CONFIG') throw e; cfg = { runners: [1, 2, 3, 4, 5].map((i) => ({ name: `runner-${i}`, maxParallel: 20 })) } }
      out(await fleet.makePlan({ cfg, projectDir: project, only: list('--only'), tags: list('--tags'), runnersState: st }))
      break
    }
    case 'run': {
      const source = val('--source'), ref = val('--ref')
      if (!source || !ref) die('run needs --source and --ref (the pushed branch the runners will test)')
      if (val('--via') === 'coordinator') { out(await viaCoordinator({ cfg: loadConfig(), source, ref, only: list('--only'), tags: list('--tags') })); break }
      const r = await fleet.runAll({ projectDir: project, source, ref, only: list('--only'), tags: list('--tags'), dry: flag('--dry'), retryInfra: !flag('--no-retry'), log: (m) => console.error(m) })
      if (val('--json-out')) fs.writeFileSync(val('--json-out'), JSON.stringify(r, null, 1))
      if (r.dry) { out(r.plan); break }
      out(r.summary.markdown)
      process.exit(r.summary.fail || r.summary.infra ? 1 : 0)
    }
    case 'pull': {
      if (!val('--gh-run')) die('pull needs --gh-run <coordinator run id>')
      const r = await pull({ cfg: loadConfig(), ghRun: val('--gh-run'), projectDir: val('--project') })
      out(r.summary.markdown)
      out(`results: ${r.summaryPath}`)
      process.exit(r.summary.fail || r.summary.infra ? 1 : 0)
    }
    case 'explore': out(exploreBriefs({ cfg: loadConfig(), runId: val('--run'), projectDir: project, only: list('--only'), tags: list('--tags') })); break
    case 'tokens': out(await tokenReport({ card: readCard(cardPath()) })); break
    case 'watch': out((await fleet.watch({ runId: val('--run') })).batches.map((b) => `${b.batch}: ${b.status} ${b.url ?? ''}`).join('\n')); break
    case 'collect': { const r = await fleet.collect({ runId: val('--run') }); out(fleet.summary(r).markdown); break }
    case 'summary': out(fleet.summary(fleet.loadRun(loadConfig(), val('--run'))).markdown); break
    case 'cancel': out(await fleet.cancel({ runId: val('--run') })); break
    case 'config': out(publicView(loadConfig())); break
    case 'card': {
      const sub = argv[1]
      if (sub === 'new') {
        const dest = path.resolve(val('--out', path.join(os.homedir(), '.qa-fleet', 'QA-FLEET-CARD.md')))
        if (fs.existsSync(dest) && !flag('--force')) die(`${dest} exists (--force to overwrite it)`)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(new URL('../card/QA-FLEET-CARD.md', import.meta.url), dest)
        if (process.platform !== 'win32') fs.chmodSync(dest, 0o600)
        out(`empty card written to ${dest}\nFill part A (tokens) and give the file to Claude Code. Keep it outside repos and synced folders (Drive, OneDrive, Dropbox).`)
        break
      }
      if (sub === 'seal') {
        const s = sealCard(readCard(cardPath()))
        out({ FLEET_CARD_SEALED: `${s.sealed.length} chars (runners + sources only: no test secrets, no result key)`, FLEET_CARD_KEY: 'qafsec1:... (fresh key)', next: 'fleet bootstrap --coordinator uploads both to the environment "fleet" (values never printed)' })
        break
      }
      if (sub !== 'check') die('card new | card check | card seal')
      const card = readCard(cardPath())
      const v = validateCard(card)
      const report = { card: cardPath(), errors: v.errors, warnings: v.warnings }
      if (!v.errors.length) {
        report.runners = (await fleet.status(loadConfig(cardPath()))).runners.map((r) => ({ repo: r.repo, state: r.state, visibility: r.visibility, freeSlots: r.freeSlots, missing: r.missing }))
        report.testBranch = await findBranch({ card })
        report.resultKey = card.results?.identity ? 'present' : 'missing (bootstrap creates it)'
      }
      out(report)
      if (v.errors.length) process.exit(1)
      break
    }
    case 'bootstrap': {
      if (flag('--coordinator')) {
        const r = await setupCoordinator({ card: readCard(cardPath()), dry: flag('--dry'), exec: (c, a, o = {}) => spawnSync(c, a, { input: o.input, encoding: 'utf8', env: { ...process.env, ...o.env } }), log: (m) => console.error(m) })
        out(r.problems.length ? `PROBLEMS: ${r.problems.join(' | ')}` : 'coordinator ready')
        if (r.problems.length) process.exit(1)
        break
      }
      const r = await bootstrap({ cardPath: cardPath(), only: list('--only'), dry: flag('--dry'), forceTemplate: flag('--force-template'), log: (m) => console.error(m) })
      out(r.report.map((x) => `${x.runner}: ${x.problems.length ? `PROBLEMS: ${x.problems.join(' | ')}` : 'ok'}`).join('\n'))
      if (!r.ok) process.exit(1)
      break
    }
    case 'branch': out(await findBranch({ cardPath: cardPath() })); break
    case 'checkout': { if (!val('--dir')) die('checkout needs --dir'); out(checkout({ cardPath: cardPath(), source: val('--source'), branch: val('--branch'), dir: val('--dir') })); break }
    case 'init': out(initProject(project, { kind: val('--kind', 'shell'), shards: Number(val('--shards', 4)), force: flag('--force') })); break

    // ---------------- runner side
    case 'matrix': {
      const { units } = loadUnits(project)
      const ids = list('--units') ?? []
      const missing = ids.filter((i) => !units.some((u) => u.id === i))
      if (missing.length) die(`units not in the source units.json: ${missing.join(', ')}`)
      out(JSON.stringify(units.filter((u) => ids.includes(u.id)).map(matrixEntry)))
      break
    }
    case 'unit-env': {
      const u = loadUnits(project).units.find((x) => x.id === val('--unit'))
      if (!u) die('unknown unit')
      const enc = (s) => Buffer.from(String(s ?? '')).toString('base64')
      out([`QAF_UNIT_ID=${u.id}`, `QAF_CMD_B64=${enc(u.cmd)}`, `QAF_RESULTS_B64=${enc((u.results ?? []).join('\n'))}`, `QAF_ENV_B64=${enc(Object.entries(u.env ?? {}).map(([k, v]) => `${k}=${v}`).join('\n'))}`, `QAF_EMULATOR_API=${matrixEntry(u).emulatorApi}`].join('\n'))
      break
    }
    case 'secrets-env': {
      const all = JSON.parse(process.env.ALL_SECRETS || '{}')
      const names = list('--names') ?? []
      const lines = []
      for (const n of names) { if (all[n] == null) { console.error(`fleet: secret ${n} is not set on this runner repo`); continue } if (/[\r\n]/.test(all[n])) { console.error(`fleet: secret ${n} has a newline and is skipped`); continue } lines.push(`${n}=${all[n]}`) }
      fs.writeFileSync(val('--out'), lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 })
      out(`${lines.length}/${names.length} secret(s) exposed to the unit`)
      break
    }
    case 'coordinate': {
      const r = await coordinate({ sealed: process.env.FLEET_CARD_SEALED, key: process.env.FLEET_CARD_KEY, source: val('--source'), ref: val('--ref'), only: list('--only'), tags: list('--tags'), outDir: path.resolve(val('--out', 'fleet-out')) })
      if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `bundle=${r.bundle}\n`)
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, r.summary.markdown + `\nDecrypt on your PC: node cli/fleet.mjs pull --gh-run ${process.env.GITHUB_RUN_ID ?? '<id>'}\n`)
      out(r.summary.markdown)
      process.exit(r.summary.fail || r.summary.infra ? 1 : 0)
    }
    case 'seal': await sealFile(val('--in'), val('--out'), val('--recipient') || process.env.FLEET_RECIPIENT); break
    case 'open': await openFile(val('--in'), val('--out'), val('--identity') ? fs.readFileSync(val('--identity'), 'utf8') : identityOf(loadConfig())); break
    default: out(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  }
} catch (e) { die(e.message) }
