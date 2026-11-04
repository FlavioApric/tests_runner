// node --test tests/  : the fix scripts against a throwaway git repo with a bare "origin".
import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planBatch, pathsOverlap } from '../scripts/fix/fix-batch.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const scripts = join(repoRoot, 'scripts', 'fix')
const env = { ...process.env, GIT_AUTHOR_NAME: 'fix-test', GIT_AUTHOR_EMAIL: 'fix-test@example.invalid', GIT_COMMITTER_NAME: 'fix-test', GIT_COMMITTER_EMAIL: 'fix-test@example.invalid' }
delete env.FIX_CONFIG // the tests use each repo's own fix.config.json

let tmp, work
const git = (cwd, ...a) => execFileSync('git', ['-c', 'core.autocrlf=false', ...a], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const run = (name, args, cwd = work) => {
  const r = spawnSync(process.execPath, [join(scripts, name), ...args], { cwd, env, encoding: 'utf8' })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}
const write = (base, rel, text) => { mkdirSync(dirname(join(base, rel)), { recursive: true }); writeFileSync(join(base, rel), text) }

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fix-test-'))
  const origin = join(tmp, 'origin.git')
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin)
  git(tmp, 'clone', '-q', origin, join(tmp, 'app'))
  work = join(tmp, 'app')
  git(work, 'checkout', '-q', '-b', 'main')
  cpSync(join(repoRoot, 'fix.config.json'), join(work, 'fix.config.json'))
  cpSync(join(repoRoot, 'fix', 'templates'), join(work, 'fix', 'templates'), { recursive: true })
  write(work, 'fix/LOG.md', '# Fix log\n\n| Date | Id | Area | Delivery | PR | Test ticket | Note |\n|---|---|---|---|---|---|---|\n')
  write(work, 'src/feed.ts', 'export const x = 1\n')
  write(work, 'package.json', JSON.stringify({ name: 'app', dependencies: { '@capacitor/core': '6.0.0', react: '18.3.1' } }, null, 2) + '\n')
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'init'); git(work, 'push', '-q', 'origin', 'main')
})

after(() => { try { rmSync(tmp, { recursive: true, force: true, maxRetries: 3 }) } catch { /* temp dir: best effort */ } })

describe('start', () => {
  test('rejects an id that does not match idPattern', () => {
    const r = run('start.mjs', ['nope', 'some-slug'])
    assert.equal(r.code, 2); assert.match(r.out, /idPattern/)
  })
  test('--dry creates nothing', () => {
    const r = run('start.mjs', ['BUG-T0', 'dry-run', '--dry'])
    assert.equal(r.code, 0, r.out)
    assert.equal(git(work, 'branch', '--list', 'fix/BUG-T0-dry-run'), '')
    assert.ok(!existsSync(join(tmp, 'wt-bug-t0-dry-run')))
  })
  test('creates branch, worktree and card', () => {
    const r = run('start.mjs', ['BUG-T1', 'date-filter', '--title', 'Feed date filter'])
    assert.equal(r.code, 0, r.out)
    assert.match(git(work, 'branch', '--list', 'fix/BUG-T1-date-filter'), /fix\/BUG-T1-date-filter/)
    const wt = join(tmp, 'wt-bug-t1-date-filter')
    assert.ok(existsSync(join(wt, 'src', 'feed.ts')), 'worktree checked out from origin/main')
    const card = readFileSync(join(wt, 'fix', 'bugs', 'BUG-T1.md'), 'utf8')
    assert.match(card, /^# BUG-T1: Feed date filter/)
    assert.match(card, /fix\/BUG-T1-date-filter/)
    assert.doesNotMatch(card, /\{\{\w+\}\}/)
    assert.equal(run('start.mjs', ['BUG-T1', 'date-filter']).code, 1, 'second start refuses: already exists')
  })
})

describe('gate', () => {
  const gate = (files, extra = []) => { const r = run('gate.mjs', ['--files', files, '--json', ...extra]); return { ...r, j: JSON.parse(r.out.slice(r.out.indexOf('{'))) } }
  test('classifies files from deliveryRules; highest type wins', () => {
    const { code, j } = gate('src/feed.ts,functions/notify/index.ts,README.md')
    assert.equal(code, 0)
    assert.equal(j.delivery, 'function')
    assert.deepEqual(j.kinds, ['web', 'function'])
    assert.equal(j.perFile['README.md'], 'none')
    assert.deepEqual(j.checks.map((c) => c.name), ['lint', 'build', 'unit tests'])
  })
  test('stack checks only with --stack', () => {
    assert.ok(!gate('db/migrations/001_add.sql').j.checks.some((c) => c.name.startsWith('migration')))
    const s = gate('db/migrations/001_add.sql', ['--stack'])
    assert.equal(s.j.delivery, 'migration')
    assert.ok(s.j.checks.some((c) => c.name.startsWith('migration')))
  })
  test('a blocking type (native) exits 1', () => {
    const { code, j } = gate('android/app/build.gradle,src/feed.ts')
    assert.equal(code, 1); assert.equal(j.delivery, 'native'); assert.equal(j.blocking, true)
  })
  test('nativeDeps: a changed plugin dependency in the manifest is native', () => {
    const wt = join(tmp, 'wt-bug-t1-date-filter')
    const pkg = JSON.parse(readFileSync(join(wt, 'package.json'), 'utf8'))
    pkg.dependencies['@capacitor/camera'] = '6.0.0'
    writeFileSync(join(wt, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
    const r = run('gate.mjs', ['--json'], wt)
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
    assert.equal(j.delivery, 'native', r.out); assert.match(j.reasons.join(), /@capacitor/)
    git(wt, 'checkout', '-q', '--', 'package.json')
    const plain = JSON.parse(readFileSync(join(wt, 'package.json'), 'utf8'))
    plain.dependencies.react = '18.3.2'
    writeFileSync(join(wt, 'package.json'), JSON.stringify(plain, null, 2) + '\n')
    const r2 = run('gate.mjs', ['--json'], wt)
    assert.equal(JSON.parse(r2.out.slice(r2.out.indexOf('{'))).delivery, 'web', r2.out)
    git(wt, 'checkout', '-q', '--', 'package.json')
  })
  test('runs the chosen checks and fails when one fails', () => {
    const cfg = JSON.parse(readFileSync(join(work, 'fix.config.json'), 'utf8'))
    cfg.checks = [{ name: 'passes', cmd: 'node -e "process.exit(0)"', paths: ['^src/'] }, { name: 'fails', cmd: 'node -e "process.exit(3)"', paths: ['^functions/'] }]
    const p = join(tmp, 'checks.config.json'); writeFileSync(p, JSON.stringify(cfg))
    const ok = run('gate.mjs', ['--files', 'src/feed.ts', '--config', p])
    assert.equal(ok.code, 0, ok.out); assert.match(ok.out, /ok: passes/)
    const bad = run('gate.mjs', ['--files', 'src/feed.ts,functions/a.ts', '--config', p])
    assert.equal(bad.code, 1); assert.match(bad.out, /FAILED: fails \(exit 3\)/)
  })
  test('the fuller example config loads and classifies a monorepo layout', () => {
    const p = join(repoRoot, 'fix', 'examples', 'supabase-capacitor.json')
    const r = run('gate.mjs', ['--files', 'app/src/a.tsx,supabase/functions/x/index.ts,supabase/migrations/20260101000000_a.sql', '--json', '--config', p])
    const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
    assert.equal(r.code, 0, r.out); assert.equal(j.delivery, 'migration'); assert.deepEqual(j.kinds, ['web', 'edge', 'migration'])
    assert.equal(run('gate.mjs', ['--files', 'app/ios/App/Info.plist', '--json', '--config', p]).code, 1)
  })
  test('a bad regex in the config is reported with its key', () => {
    const p = join(tmp, 'bad.config.json'); writeFileSync(p, JSON.stringify({ deliveryOrder: ['none', 'web'], deliveryRules: [{ type: 'web', path: '(' }] }))
    const r = run('gate.mjs', ['--files', 'x', '--config', p])
    assert.equal(r.code, 2); assert.match(r.out, /deliveryRules\[0\]\.path/)
  })
})

describe('ship --local', () => {
  test('passes with card, regression test and log row; prints the owner action', () => {
    const wt = join(tmp, 'wt-bug-t1-date-filter')
    write(wt, 'src/feed.ts', 'export const x = 2\n')
    write(wt, 'tests/unit/feed.test.js', 'test("x", () => {})\n')
    appendFileSync(join(wt, 'fix/LOG.md'), '| 2026-01-01 | BUG-T1 | feed | web | - | none | test |\n')
    git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'fix(feed): date filter (BUG-T1)')
    const r = run('ship.mjs', ['--local'], wt)
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /delivery: web/)
    assert.match(r.out, /deploy-web/)
    assert.doesNotMatch(r.out, /FAIL /)
  })
  test('fails without a regression test, and on result files', () => {
    const wt = join(tmp, 'wt-bug-t1-date-filter')
    git(wt, 'checkout', '-q', '-b', 'fix/BUG-T2-no-test', 'origin/main')
    write(wt, 'fix/bugs/BUG-T2.md', '# BUG-T2\n'); write(wt, 'src/feed.ts', 'export const x = 3\n'); write(wt, 'test-results/run.json', '{}\n')
    appendFileSync(join(wt, 'fix/LOG.md'), '| row |\n')
    git(wt, 'add', '-A'); git(wt, 'commit', '-q', '-m', 'no test')
    const r = run('ship.mjs', ['--local'], wt)
    assert.equal(r.code, 1)
    assert.match(r.out, /FAIL a regression test/)
    assert.match(r.out, /FAIL no result files in the diff: test-results\/run\.json/)
  })
  test('fails on a branch name that is not a fix branch', () => {
    const wt = join(tmp, 'wt-bug-t1-date-filter')
    git(wt, 'checkout', '-q', '-b', 'random-branch')
    const r = run('ship.mjs', ['--local'], wt)
    assert.equal(r.code, 1); assert.match(r.out, /FAIL branch name/)
  })
})

describe('fix-batch', () => {
  const bugs = [
    { id: 'BUG-A', slug: 'aa', files: ['src/a.ts'] },
    { id: 'BUG-B', slug: 'bb', files: ['src/b.ts'] },
    { id: 'BUG-C', slug: 'cc', files: ['src/c.ts', './src/a.ts'] },
    { id: 'BUG-D', slug: 'dd', files: ['src/feed/'] },
    { id: 'BUG-E', slug: 'ee', files: ['src\\feed\\list.ts'] },
  ]
  test('pathsOverlap: same file and folder prefix', () => {
    assert.ok(pathsOverlap('src/a.ts', './src/a.ts'))
    assert.ok(pathsOverlap('src/feed/', 'src/feed/list.ts'))
    assert.ok(!pathsOverlap('src/feed', 'src/feed.ts'))
    assert.ok(!pathsOverlap('src/a.ts', 'src/b.ts'))
  })
  test('overlapping bugs share a lane and are sequenced; the rest run in parallel', () => {
    const p = planBatch(bugs)
    assert.deepEqual(p.lanes, [['BUG-A', 'BUG-C'], ['BUG-B'], ['BUG-D', 'BUG-E']])
    assert.deepEqual(p.waves, [['BUG-A', 'BUG-B', 'BUG-D'], ['BUG-C', 'BUG-E']])
    const c = p.items.find((i) => i.id === 'BUG-C')
    assert.equal(c.after, 'BUG-A'); assert.deepEqual(c.conflicts, [{ with: 'BUG-A', files: ['src/a.ts'] }])
  })
  test('transitive overlap joins lanes', () => {
    const p = planBatch([{ id: 'X', files: ['a'] }, { id: 'Y', files: ['a', 'b'] }, { id: 'Z', files: ['b'] }])
    assert.deepEqual(p.lanes, [['X', 'Y', 'Z']])
  })
  test('refuses empty files and duplicate ids', () => {
    assert.throws(() => planBatch([{ id: 'X', files: [] }]), /files/)
    assert.throws(() => planBatch([{ id: 'X', files: ['a'] }, { id: 'X', files: ['b'] }]), /duplicate/)
  })
  test('CLI creates one worktree + branch per bug and a brief each', () => {
    const input = join(tmp, 'bugs.json')
    writeFileSync(input, JSON.stringify({ batch: 'b1', bugs: bugs.slice(0, 3).map((b) => ({ ...b, report: `report of ${b.id}` })) }))
    const dry = run('fix-batch.mjs', [input, '--dry'])
    assert.equal(dry.code, 0, dry.out); assert.match(dry.out, /3 bugs, 2 lanes, 2 waves/)
    assert.equal(git(work, 'branch', '--list', 'fix/BUG-A-aa'), '')
    const r = run('fix-batch.mjs', [input, '--no-fetch'])
    assert.equal(r.code, 0, r.out)
    for (const id of ['A', 'B', 'C']) {
      assert.match(git(work, 'branch', '--list', `fix/BUG-${id}-${id.toLowerCase().repeat(2)}`), /fix\//)
      assert.ok(existsSync(join(tmp, `wt-bug-${id.toLowerCase()}-${id.toLowerCase().repeat(2)}`, 'fix', 'bugs', `BUG-${id}.md`)))
    }
    const out = join(work, '.fix-batch', 'b1')
    const brief = readFileSync(join(out, 'BUG-C.brief.md'), 'utf8')
    assert.match(brief, /after \*\*BUG-A\*\*/)
    assert.match(brief, /git rebase fix\/BUG-A-aa/)
    assert.match(brief, /dispatching-parallel-agents/); assert.match(brief, /git-worktree-isolation/)
    assert.match(brief, /report of BUG-C/)
    assert.match(readFileSync(join(out, 'BUG-B.brief.md'), 'utf8'), /Start now\./)
    assert.equal(JSON.parse(readFileSync(join(out, 'plan.json'), 'utf8')).waves.length, 2)
    assert.equal(run('fix-batch.mjs', [input, '--no-fetch']).code, 1, 'rerun refuses: branches exist')
  })
})
