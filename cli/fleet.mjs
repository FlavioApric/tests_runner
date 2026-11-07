#!/usr/bin/env node
// tests_runner CLI. On your PC the ONLY credential is your gh CLI login (gh auth status). No token is read or printed.
//   setup-app                      one time: create the fleet GitHub App (one click), store its key in the home repo
//   keygen [--force]               one time: result key pair (private -> ~/.qa-fleet/identity.key, public -> vars.FLEET_RECIPIENT)
//   test-secrets [--file f]        upload the test keys units declare (default ~/.qa-fleet/test-secrets.json: {"NAME":"value"})
//   allow  login[,login]           let these accounts' App installations act as runners (vars.FLEET_ACCOUNTS)
//   install-link                   the link to send to an account that lends a runner repo
//   runners                        what the coordinator sees: runner repos, state, free parallel jobs
//   provision                      push the current runner stub to every runner now (the run does it too)
//   run  --source owner/app --ref branch [--only a,b] [--tags t] [--project dir] [--no-wait]
//                                  start the coordinator, wait, pull and decrypt (exit 1 if a unit failed)
//   pull --gh-run <id> [--project dir]   download + decrypt the results of a coordinator run
//   cancel --gh-run <id>           cancel a coordinator run (it cancels its runner runs)
//   explore --run <runId> --project dir  briefs for the LOCAL Claude explorers (agent units)
//   plan [--project dir] [--runners N] [--only ..] [--tags ..]   what would run where (offline)
//   validate [--project dir]       check <project>/.qa-fleet/units.json
//   summary --run <runId>          the summary of a pulled run
//   init --kind playwright|vitest|jest|pytest|go|maestro|gradle|shell [--shards N] [--project dir]
// Inside the workflows:
//   coordinate --out dir           fleet.yml: env FLEET_APP_ID, FLEET_APP_PRIVATE_KEY, FLEET_RECIPIENT, FLEET_TEST_SECRETS (one JSON secret), FLEET_HOME, FLEET_SHA
//   matrix   --project src --units a,b       -> JSON matrix for shard-core.yml
//   unit-env --project src --unit id         -> unit command env as KEY=VALUE lines
//   secrets-env --names A,B --out file       -> only the named secrets from $UNIT_SECRETS (one JSON secret) into an env file
//   seal --in file --out file --recipient qafpub1:...  |  open --in file --out file [--identity path]
import fs from 'node:fs'
import path from 'node:path'
import { localConfig, identityOf, homeRepo } from '../lib/config.mjs'
import { loadUnits, validateUnits, matrixEntry } from '../lib/units.mjs'
import * as fleet from '../lib/fleet.mjs'
import * as local from '../lib/local.mjs'
import { sealFile, openFile } from '../lib/crypto.mjs'
import { initProject } from '../lib/init.mjs'
import { coordinate } from '../lib/coordinator.mjs'
import { exploreBriefs } from '../lib/explore.mjs'
import { gh } from '../lib/gh.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (f) => argv.includes(f)
const val = (f, d) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : d)
const list = (f) => val(f)?.split(',').map((s) => s.trim()).filter(Boolean)
const project = path.resolve(val('--project', '.'))
const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 1))
const die = (m, c = 1) => { console.error(`fleet: ${m}`); process.exit(c) }
const log = (m) => console.error(m)
const csv = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean)

try {
  switch (cmd) {
    case 'setup-app': {
      const i = await local.setupApp({ log })
      out(`App ${i.slug} (id ${i.id}) created; key stored in ${i.home} (environment "fleet").\nNext:\n  1. install it on YOUR runner + source repos: ${i.install}\n  2. send that same link to every account that lends a runner repo, then: node cli/fleet.mjs allow <their-login>`)
      break
    }
    case 'keygen': out(local.keygen({ force: flag('--force') })); break
    case 'test-secrets': out(local.testSecrets({ file: val('--file') })); break
    case 'allow': { const logins = csv(argv[1]); if (!logins.length) die('allow login[,login]'); out(local.allow({ logins })); break }
    case 'install-link': { const i = local.appInfo(); out(i ? i.install : 'unknown on this PC: open the App page (github.com/settings/apps) → Public page → Install'); break }
    case 'runners': out(await local.runners({ log })); break
    case 'provision': { const r = local.startRemote({ mode: 'provision' }); const s = await local.waitRemote(r.ghRunId, { log }); out(`${s.conclusion}: ${r.url}`); break }
    case 'run': {
      const r = local.startRemote({ source: val('--source'), ref: val('--ref'), only: list('--only') ?? [], tags: list('--tags') ?? [] })
      log(`coordinator started: ${r.url}`)
      if (flag('--no-wait')) { out(r); break }
      const s = await local.waitRemote(r.ghRunId, { log })
      const p = await local.pull({ ghRun: r.ghRunId, projectDir: val('--project') ? project : null, log })
      out(p.summary.markdown)
      out(`results: ${p.summaryPath} (coordinator ${s.conclusion}: ${r.url})`)
      process.exit(p.summary.fail || p.summary.infra ? 1 : 0)
    }
    case 'pull': {
      if (!val('--gh-run')) die('pull needs --gh-run <coordinator run id>')
      const r = await local.pull({ ghRun: val('--gh-run'), projectDir: val('--project') ? project : null, log })
      out(r.summary.markdown); out(`results: ${r.summaryPath}`)
      process.exit(r.summary.fail || r.summary.infra ? 1 : 0)
    }
    case 'cancel': { if (!val('--gh-run')) die('cancel needs --gh-run'); out(gh(['run', 'cancel', val('--gh-run'), '--repo', homeRepo()])); break }
    case 'explore': out(exploreBriefs({ cfg: localConfig(), runId: val('--run'), projectDir: project, only: list('--only'), tags: list('--tags') })); break
    case 'plan': {
      const n = Number(val('--runners', 3))
      out(await fleet.makePlan({ cfg: { runners: Array.from({ length: n }, (_, i) => ({ name: `runner-${i + 1}`, maxParallel: 20 })) }, projectDir: project, only: list('--only'), tags: list('--tags') }))
      break
    }
    case 'validate': { const doc = JSON.parse(fs.readFileSync(path.join(project, '.qa-fleet', 'units.json'), 'utf8')); const e = validateUnits(doc); if (e.length) die(`invalid units.json:\n- ${e.join('\n- ')}`); out(`ok: ${doc.units.length} units`); break }
    case 'summary': out(fleet.summary(fleet.loadRun(localConfig(), val('--run'))).markdown); break
    case 'init': out(initProject(project, { kind: val('--kind', 'shell'), shards: Number(val('--shards', 4)), force: flag('--force') })); break

    // ---------------- inside the workflows
    case 'coordinate': {
      const e = process.env
      const outDir = path.resolve(val('--out', 'fleet-out'))
      const r = await coordinate({ mode: e.IN_MODE || 'run', appId: e.FLEET_APP_ID, pem: e.FLEET_APP_PRIVATE_KEY, home: e.FLEET_HOME, sha: e.FLEET_SHA, accounts: csv(e.FLEET_ACCOUNTS), source: e.IN_SOURCE, ref: e.IN_REF, only: csv(e.IN_ONLY), tags: csv(e.IN_TAGS), recipient: e.FLEET_RECIPIENT, testSecrets: JSON.parse(e.FLEET_TEST_SECRETS || '{}'), outDir, log })
      const md = r.summary ? r.summary.markdown + `\nDecrypt on your PC: node cli/fleet.mjs pull --gh-run ${e.GITHUB_RUN_ID ?? '<id>'}\n` : ['| Runner | State | Free jobs | Note |', '|---|---|---|---|', ...r.status.runners.map((x) => `| ${x.repo} | ${x.state} | ${x.freeSlots ?? ''} | ${x.note ?? ''} |`)].join('\n') + '\n'
      if (e.GITHUB_STEP_SUMMARY) fs.appendFileSync(e.GITHUB_STEP_SUMMARY, md)
      out(md)
      process.exit(r.summary && (r.summary.fail || r.summary.infra) ? 1 : 0)
    }
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
      const all = JSON.parse(process.env.UNIT_SECRETS || '{}')
      const names = list('--names') ?? []
      const lines = []
      for (const n of names) { if (all[n] == null) { console.error(`fleet: secret ${n} is not set for this run`); continue } if (/[\r\n]/.test(all[n])) { console.error(`fleet: secret ${n} has a newline and is skipped`); continue } lines.push(`${n}=${all[n]}`) }
      fs.writeFileSync(val('--out'), lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 })
      out(`${lines.length}/${names.length} secret(s) exposed to the unit`)
      break
    }
    case 'seal': await sealFile(val('--in'), val('--out'), val('--recipient') || process.env.FLEET_RECIPIENT); break
    case 'open': await openFile(val('--in'), val('--out'), val('--identity') ? fs.readFileSync(val('--identity'), 'utf8') : identityOf(localConfig())); break
    default: out(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
  }
} catch (e) { die(e.message) }
