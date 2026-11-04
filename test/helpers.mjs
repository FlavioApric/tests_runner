// Test helpers: run pack scripts as a user would (child process, --project) on a throw-away copy of the example.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const REPO = path.resolve(import.meta.dirname, '..')
export const PACK = path.join(REPO, 'qa-pack')
export const EXAMPLE = path.join(REPO, 'examples', 'tiny-app')
const SKIP = new Set(['node_modules', 'test-results', 'blob-report', '.qa-pack', 'graphify-out', 'html-report'])

// copy of the example in a fresh temp dir (generated and run-time folders left out); removed by the caller's after()
export function copyExample() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-pack-test-'))
  fs.cpSync(EXAMPLE, dir, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) })
  return dir
}
export const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true })

// node <qa-pack/rel> ...args --project <dir>; returns { status, out } with stdout+stderr
export function pack(rel, args, project) {
  const r = spawnSync(process.execPath, [path.join(PACK, rel), ...args, '--project', project], { cwd: project, encoding: 'utf8', timeout: 120000, env: { ...process.env, QA_PROJECT: '' } })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))

// every file a commit would carry: git's tracked + untracked-not-ignored files, or a walk when git is absent
export function repoFiles(dir = REPO) {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: dir, encoding: 'utf8' })
  if (r.status === 0) return r.stdout.split('\0').filter(Boolean).map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f))
  return walkFiles(dir)
}
function walkFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || SKIP.has(e.name) || e.name === 'cases') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}
