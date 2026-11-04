// Checks a fix before the owner delivers it and prints the exact owner action. Writes nothing.
//   node scripts/fix/ship.mjs <PR> [--repo <owner/name>]   a GitHub PR (needs gh)
//   node scripts/fix/ship.mjs --local                      the committed diff of HEAD against <remote>/<baseBranch>
//   add --feature for the feature checklist (featureChecks in fix.config.json), --base <ref> to compare with another ref
import { spawnSync } from 'node:child_process'
import { branchRe, classify, fail, fill, gitIn, hasTest, loadConfig, normalizePath, ownerAction, parseArgs, resultFilesIn } from './lib.mjs'

const { flags, values, positional } = parseArgs(process.argv.slice(2), ['--repo', '--config', '--base'])
const local = flags.has('--local'), feature = flags.has('--feature')
const pr = positional.find((a) => /^\d+$/.test(a))
if (!local && !pr) fail('usage: node scripts/fix/ship.mjs <PR> [--repo <owner/name>] | --local  [--feature]')
let cfg
try { cfg = loadConfig({ path: values['--config'] }) } catch (e) { fail(e.message) }
const repo = values['--repo'] ?? cfg.repo
const base = values['--base'] ?? cfg.base

let files, branch, state = 'local', body = ''
if (local) {
  files = gitIn(cfg.root, ['diff', '--name-only', `${base}...HEAD`]).split('\n').filter(Boolean).map(normalizePath)
  branch = gitIn(cfg.root, ['rev-parse', '--abbrev-ref', 'HEAD'])
} else {
  if (!repo) fail('no repo: pass --repo <owner/name> or set "repo" in fix.config.json')
  const r = spawnSync('gh', ['pr', 'view', pr, '--repo', repo, '--json', 'headRefName,state,files,body'], { encoding: 'utf8' })
  if (r.status !== 0) fail(r.stderr || 'gh failed')
  const j = JSON.parse(r.stdout)
  files = j.files.map((f) => normalizePath(f.path)); branch = j.headRefName; state = j.state; body = j.body ?? ''
}

const problems = []
const note = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); if (!ok) problems.push(text) }
const cardRe = new RegExp(`^${cfg.cardDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.+\\.md$`)

note(branchRe(cfg).test(branch), `branch name ${cfg.branchPrefix}<id>-<slug> (${branch})`)
note(state === 'local' || state === 'OPEN', `PR is open (${state})`)
note(files.some((f) => cardRe.test(f) && !f.endsWith('/README.md')), `bug card in ${cfg.cardDir}/`)
const c = classify(cfg, files)
note(c.top === 'none' || hasTest(cfg, files), 'a regression test is part of the change (testPaths)')
if (cfg.logFiles.length) note(files.some((f) => cfg.logFiles.includes(f)), `row in ${cfg.logFiles.join(' or ')}`)
if (cfg.testsBranch) {
  if (local) console.log(`manual: test ticket on ${cfg.testsBranch} (PLAYBOOK step 8)${cfg.reqRe ? ': requirement id, case, update-log row' : ''}.`)
  else note((!cfg.reqRe || cfg.reqRe.test(body)) && body.includes(cfg.testsBranch), `PR text names ${cfg.reqRe ? 'a requirement id and ' : ''}the ${cfg.testsBranch} ticket (PLAYBOOK step 8)`)
}
const results = resultFilesIn(cfg, files)
note(results.length === 0, `no result files in the diff${results.length ? `: ${results.slice(0, 3).join(', ')}` : ''}`)
note(!c.blocking, `no blocking delivery type (${cfg.blockingTypes.join(', ') || 'none configured'})`)

console.log(`\ndelivery: ${c.top}${c.kinds.length > 1 ? ` (parts: ${c.kinds.join(', ')})` : ''}`)
console.log(ownerAction(cfg, c.top, { pr, branch }))
if (!local) for (const t of cfg.readOnlyChecks) console.log(`Read-only check Claude may start: ${fill(t, { repo, runnerRepo: cfg.runnerRepo, branch, pr })}`)
if (feature) {
  console.log('\nfeature checklist (fix/FEATURES.md):')
  for (const f of cfg.featureRes) note(files.some((x) => f.re.test(x)), f.label)
  if (cfg.testsBranch) console.log(`manual: a new test module, requirement rows and tests exist on ${cfg.testsBranch}, and the PR text names them.`)
}
process.exit(problems.length ? 1 : 0)
