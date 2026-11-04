// Small shared helpers (no dependencies).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const PACK_DIR = path.resolve(import.meta.dirname, '..')
export const REPO_DIR = path.resolve(PACK_DIR, '..')

export const read = (p) => fs.readFileSync(p, 'utf8')
export const readJson = (p) => JSON.parse(read(p))
export const exists = (p) => fs.existsSync(p)
export const write = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t) }
export const writeJson = (p, o) => write(p, JSON.stringify(o, null, 1) + '\n')
export const posix = (p) => p.split(path.sep).join('/')
export const relTo = (base, p) => posix(path.relative(base, p)) || '.'

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', 'test-results', 'playwright-report', 'blob-report', 'graphify-out', '__pycache__', '.venv', 'venv'])
export function walk(dir, test = () => true, out = []) {
  if (!fs.existsSync(dir)) return out
  const st = fs.statSync(dir)
  if (st.isFile()) { if (test(dir)) out.push(dir); return out }
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.isDirectory())) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, test, out)
    else if (test(p)) out.push(p)
  }
  return out
}

// argv helpers: flag('--dry'), opt('--project', '.')
export const args = (argv = process.argv.slice(2)) => ({
  argv,
  cmd: argv[0],
  flag: (f) => argv.includes(f),
  opt: (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d },
})

export const sh = (cmd, a, { cwd, timeout = 15000, env } = {}) => {
  try { return spawnSync(cmd, a, { cwd, encoding: 'utf8', timeout, env: { ...process.env, ...(env ?? {}) }, shell: false }) } catch (e) { return { status: null, error: e, stdout: '', stderr: String(e) } }
}
export const has = (cmd, a = ['--version'], timeout = 15000) => { const r = sh(cmd, a, { timeout }); return r.status === 0 }

// tiny template renderer: {{KEY}} -> vars.KEY (unknown keys stay visible so they fail validation)
export const render = (text, vars) => text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m))

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

import { pathToFileURL } from 'node:url'
export const isMain = (metaUrl) => !!process.argv[1] && metaUrl === pathToFileURL(path.resolve(process.argv[1])).href
