// The flow (qa-pack/pack.json + qa.config flow.extra) and the capability probes that decide if a step can run here.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PACK_DIR, readJson, relTo, has, sh, render } from './util.mjs'
import { loadPersonaEnv, signedInPersonas } from './personas.mjs'

export const STATUSES = ['done', 'failed', 'deferred', 'gate-open', 'known-baseline', 'n/a']

export function packVars(cfg) {
  return { PACK: relTo(cfg.dir, PACK_DIR), PW_CONFIG: cfg.playwright.config, PROJECT: cfg.project }
}

const renderArgv = (argv, vars) => (Array.isArray(argv) ? argv : ['bash', '-lc', String(argv)]).map((x) => render(String(x), vars))

// `when` switches of pack.json steps
export function whenOk(cfg, when) {
  if (!when) return true
  if (when === 'router') return !!cfg.router?.adapter
  if (when === 'backend') return cfg.backend.adapter !== 'none'
  if (when === 'mobile') return !!cfg.mobile.enabled
  if (when === 'graph') return true
  if (when.startsWith('stack:')) return cfg.stack.kind === when.slice(6)
  return false
}

export function loadFlow(cfg) {
  const base = readJson(path.join(PACK_DIR, 'pack.json')).steps
  const skip = new Set(cfg.flow?.skip ?? [])
  const vars = packVars(cfg)
  const steps = [...base, ...(cfg.flow?.extra ?? [])].filter((s) => !skip.has(s.id)).map((s) => {
    const tags = new Set(s.tags ?? [])
    if (s.fleet?.kind === 'static') tags.add('static')
    return { ...s, tags: [...tags], argv: renderArgv(s.cmd, vars), applies: whenOk(cfg, s.when) }
  })
  const ids = new Set()
  for (const s of steps) { if (ids.has(s.id)) throw new Error(`flow: duplicate step id ${s.id} (qa.config flow.extra clashes with pack.json)`); ids.add(s.id) }
  return steps
}

// ---------------------------------------------------------------- capabilities
const androidHome = () => process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk') : path.join(os.homedir(), 'Android', 'Sdk'))
export const adbPath = () => { const p = path.join(androidHome(), 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'); return fs.existsSync(p) ? p : 'adb' }
const emulatorPath = () => { const p = path.join(androidHome(), 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator'); return fs.existsSync(p) ? p : 'emulator' }

async function playwrightBrowser(cfg) {
  try {
    const { createRequire } = await import('node:module')
    const req = createRequire(path.join(cfg.dir, 'package.json'))
    const pw = req(req.resolve('@playwright/test', { paths: [cfg.dir, PACK_DIR] }))
    return (cfg.playwright.browsers ?? 'chromium').split(',').every((b) => { try { return fs.existsSync(pw[b].executablePath()) } catch { return false } })
  } catch { return false }
}

export const CAPS = {
  node: { why: 'node >= 20.11', probe: () => Number(process.versions.node.split('.')[0]) >= 20 },
  docker: { why: 'docker engine running', probe: () => has('docker', ['info'], 20000) },
  stack: { why: 'the project stack can start (stack.kind none/node need nothing; docker-compose/supabase need docker)', probe: (cfg) => ['none', 'node'].includes(cfg.stack.kind) || CAPS.docker.probe(cfg) },
  preview: { why: 'preview.start or a reachable preview.url', probe: (cfg) => !!cfg.preview?.start },
  personas: { why: 'every signed-in persona has <PREFIX><KEY>_USER / _PASSWORD in the env or personas file', probe: (cfg) => { loadPersonaEnv(cfg); return signedInPersonas(cfg).every((p) => process.env[cfg.personaVar(p.key, 'USER')] && process.env[cfg.personaVar(p.key, 'PASSWORD')]) } },
  'playwright-browser': { why: 'Playwright browsers installed (npx playwright install)', probe: playwrightBrowser },
  adb: { why: 'Android platform-tools (adb)', probe: () => has(adbPath(), ['version']) },
  emulator: { why: 'an Android emulator binary and an AVD', probe: (cfg) => { const r = sh(emulatorPath(), ['-list-avds']); return r.status === 0 && (!cfg.mobile.avd || r.stdout.split(/\r?\n/).includes(cfg.mobile.avd)) } },
  maestro: { why: 'maestro CLI on PATH (or MAESTRO_BIN)', probe: () => has(process.env.MAESTRO_BIN || 'maestro', ['--version'], 30000) },
  ffmpeg: { why: 'ffmpeg on PATH', probe: () => has('ffmpeg', ['-version']) },
  graphify: { why: 'graphify CLI (pip install graphifyy==0.9.91)', probe: () => has('graphify', ['--help']) },
  python: { why: 'python 3 on PATH', probe: () => has('python', ['--version']) || has('python3', ['--version']) },
  macos: { why: 'a macOS host (iOS builds)', probe: () => process.platform === 'darwin' },
  secrets: { why: 'every name in qa.config env.secrets is set in the environment (values never printed)', probe: (cfg) => (cfg.env?.secrets ?? []).every((n) => !!process.env[n]) },
}

export async function probeCaps(cfg, names = Object.keys(CAPS)) {
  const out = {}
  for (const n of names) {
    const c = CAPS[n]
    if (!c) { out[n] = { ok: false, why: `unknown capability "${n}"` }; continue }
    let ok = false
    try { ok = !!(await c.probe(cfg)) } catch { ok = false }
    out[n] = { ok, why: c.why }
  }
  return out
}
