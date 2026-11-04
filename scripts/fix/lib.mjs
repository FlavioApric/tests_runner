// Shared helpers for the fix scripts. Every project-specific rule comes from fix.config.json (see fix/CONFIG.md).
// No dependencies beyond Node 20+.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Runs git in cwd and returns stdout. raw=true keeps leading/trailing whitespace (porcelain output needs it). */
export function gitIn(cwd, args, raw = false) {
  const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return raw ? out : out.trim()
}

/** Tiny argument parser. valueFlags take the next argument as their value. */
export function parseArgs(argv, valueFlags = []) {
  const flags = new Set(), values = {}, positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (valueFlags.includes(a)) values[a] = argv[++i]
    else if (a.startsWith('--')) flags.add(a)
    else positional.push(a)
  }
  return { flags, values, positional }
}

export const DEFAULTS = {
  baseBranch: 'main',
  remote: 'origin',
  repo: '',
  runnerRepo: '',
  branchPrefix: 'fix/',
  worktreePrefix: 'wt-',
  cardDir: 'fix/bugs',
  cardTemplate: 'fix/templates/BUG.md',
  logFiles: ['fix/LOG.md'],
  idPattern: '^BUG-[A-Za-z0-9_-]{1,36}$',
  idExample: 'BUG-1',
  slugPattern: '^[a-z0-9-]{2,40}$',
  deliveryOrder: ['none', 'web', 'native'],
  blockingTypes: [],
  deliveryRules: [],
  nativeDeps: null,
  checks: [],
  testPaths: ['^tests/'],
  resultFiles: [],
  requirementIdPattern: '',
  testsBranch: '',
  featureChecks: [],
  ownerActions: {},
  readOnlyChecks: [],
  briefDir: '.fix-batch',
}

function compile(pattern, where) {
  try { return new RegExp(pattern) } catch (e) { throw new Error(`fix.config.json: bad regex in ${where}: ${e.message}`) }
}

/**
 * Loads and validates the config. Lookup: opts.path, then $FIX_CONFIG, then <repo root>/fix.config.json.
 * Returns the config with compiled regexes and root, base (remote/baseBranch) and configPath added.
 */
export function loadConfig(opts = {}) {
  const cwd = opts.cwd ?? process.cwd()
  const root = gitIn(cwd, ['rev-parse', '--show-toplevel'])
  let p = opts.path ?? process.env.FIX_CONFIG ?? join(root, 'fix.config.json')
  if (!isAbsolute(p)) p = resolve(cwd, p)
  if (!existsSync(p)) throw new Error(`no config at ${p}: copy fix.config.json from the tests runner fix branch and edit it (fix/CONFIG.md)`)
  let raw
  try { raw = JSON.parse(readFileSync(p, 'utf8')) } catch (e) { throw new Error(`${p}: not valid JSON: ${e.message}`) }
  const cfg = { ...DEFAULTS, ...raw, ownerActions: { ...DEFAULTS.ownerActions, ...(raw.ownerActions ?? {}) } }

  if (!Array.isArray(cfg.deliveryOrder) || cfg.deliveryOrder[0] !== 'none') throw new Error('fix.config.json: deliveryOrder must be an array that starts with "none"')
  const known = new Set(cfg.deliveryOrder)
  cfg.rules = cfg.deliveryRules.map((r, i) => {
    if (!known.has(r.type)) throw new Error(`fix.config.json: deliveryRules[${i}].type "${r.type}" is not in deliveryOrder`)
    return { type: r.type, re: compile(r.path, `deliveryRules[${i}].path`) }
  })
  for (const t of cfg.blockingTypes) if (!known.has(t)) throw new Error(`fix.config.json: blockingTypes "${t}" is not in deliveryOrder`)
  if (cfg.nativeDeps) {
    if (!cfg.nativeDeps.manifest || !cfg.nativeDeps.pattern) throw new Error('fix.config.json: nativeDeps needs manifest and pattern')
    cfg.nativeDeps = { type: cfg.deliveryOrder.at(-1), ...cfg.nativeDeps, re: compile(cfg.nativeDeps.pattern, 'nativeDeps.pattern') }
    if (!known.has(cfg.nativeDeps.type)) throw new Error(`fix.config.json: nativeDeps.type "${cfg.nativeDeps.type}" is not in deliveryOrder`)
  }
  cfg.checks = cfg.checks.map((c, i) => {
    if (!c.name || !c.cmd) throw new Error(`fix.config.json: checks[${i}] needs name and cmd`)
    return { cwd: '.', full: true, stack: false, kinds: [], ...c, res: (c.paths ?? []).map((s, j) => compile(s, `checks[${i}].paths[${j}]`)) }
  })
  cfg.idRe = compile(cfg.idPattern, 'idPattern')
  cfg.slugRe = compile(cfg.slugPattern, 'slugPattern')
  cfg.testRes = cfg.testPaths.map((s, i) => compile(s, `testPaths[${i}]`))
  cfg.resultRes = cfg.resultFiles.map((s, i) => compile(s, `resultFiles[${i}]`))
  cfg.reqRe = cfg.requirementIdPattern ? compile(cfg.requirementIdPattern, 'requirementIdPattern') : null
  cfg.featureRes = cfg.featureChecks.map((f, i) => ({ label: f.label, re: compile(f.path, `featureChecks[${i}].path`) }))
  return { ...cfg, root, configPath: p, base: `${cfg.remote}/${cfg.baseBranch}` }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Regex for a fix branch name: <branchPrefix><id>-<slug>, using the id and slug patterns without their anchors. */
export function branchRe(cfg) {
  const strip = (s) => s.replace(/^\^/, '').replace(/\$$/, '')
  return new RegExp(`^${escapeRe(cfg.branchPrefix)}(?:${strip(cfg.idPattern)})-(?:${strip(cfg.slugPattern)})$`)
}

export const normalizePath = (f) => f.replaceAll('\\', '/').replace(/^\.\//, '')

/** Delivery dependencies of a manifest (package.json text) that match nativeDeps.pattern, sorted, as JSON text. */
export function nativeDepsOf(cfg, manifestText) {
  const p = JSON.parse(manifestText)
  const all = { ...p.dependencies, ...p.devDependencies, ...p.peerDependencies }
  return JSON.stringify(Object.fromEntries(Object.entries(all).filter(([k]) => cfg.nativeDeps.re.test(k)).sort()))
}

/**
 * What the changed files mean for delivery. First matching rule wins per file; the highest type in deliveryOrder wins overall.
 * @param {object} cfg  loaded config
 * @param {string[]} files
 * @param {{baseManifest?: string, nowManifest?: string}} manifests  nativeDeps manifest text before and after
 */
export function classify(cfg, files, manifests = {}) {
  const kinds = new Set(), reasons = [], perFile = {}
  for (const f of files.map(normalizePath)) {
    const hit = cfg.rules.find((r) => r.re.test(f))
    perFile[f] = hit ? hit.type : 'none'
    if (hit) { kinds.add(hit.type); if (cfg.blockingTypes.includes(hit.type)) reasons.push(f) }
  }
  const nd = cfg.nativeDeps
  if (nd && manifests.baseManifest && manifests.nowManifest && files.map(normalizePath).includes(nd.manifest)) {
    if (nativeDepsOf(cfg, manifests.baseManifest) !== nativeDepsOf(cfg, manifests.nowManifest)) {
      kinds.add(nd.type)
      reasons.push(`${nd.manifest}: dependencies matching ${nd.pattern} changed`)
    }
  }
  const order = cfg.deliveryOrder
  const list = [...kinds].sort((a, b) => order.indexOf(a) - order.indexOf(b))
  const top = list.at(-1) ?? 'none'
  return { kinds: list, top, perFile, blocking: list.some((k) => cfg.blockingTypes.includes(k)), reasons }
}

/** The checks for these files: path match or kind match; --full adds every check with full !== false; stack checks need --stack or --full. */
export function pickChecks(cfg, files, kinds, { full = false, stack = false } = {}) {
  const fs = files.map(normalizePath)
  return cfg.checks.filter((c) => {
    if (c.stack && !stack && !full) return false
    if (full && c.full !== false) return true
    return c.res.some((re) => fs.some((f) => re.test(f))) || c.kinds.some((k) => kinds.includes(k))
  })
}

export function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : `<${k}>`))
}

export function ownerAction(cfg, top, vars = {}) {
  const t = cfg.ownerActions[top] ?? cfg.ownerActions.default ?? `Delivery type "${top}": no ownerActions entry in fix.config.json.`
  return fill(t, { repo: cfg.repo, runnerRepo: cfg.runnerRepo, ...vars })
}

export const resultFilesIn = (cfg, files) => files.map(normalizePath).filter((f) => cfg.resultRes.some((re) => re.test(f)))
export const hasTest = (cfg, files) => files.map(normalizePath).some((f) => cfg.testRes.some((re) => re.test(f)))

/** Files changed against base: committed (base...HEAD) plus the working tree (staged, unstaged, untracked). */
export function changedFiles(cwd, base) {
  const committed = gitIn(cwd, ['diff', '--name-only', `${base}...HEAD`]).split('\n')
  const working = gitIn(cwd, ['status', '--porcelain', '--untracked-files=all'], true).split('\n')
    .filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''))
  return [...new Set([...committed, ...working].filter(Boolean).map(normalizePath))]
}

/** Paths a fix for <id>/<slug> would use. Worktrees go beside the repo root. */
export function fixPaths(cfg, id, slug) {
  const branch = `${cfg.branchPrefix}${id}-${slug}`
  const wt = resolve(dirname(cfg.root), `${cfg.worktreePrefix}${`${id}-${slug}`.toLowerCase()}`.slice(0, 60))
  const cardRel = `${cfg.cardDir}/${id}.md`
  return { branch, wt, cardRel, cardPath: join(wt, cardRel) }
}

export function validateIdSlug(cfg, id, slug) {
  if (!id || !cfg.idRe.test(id)) return `id "${id ?? ''}" does not match idPattern ${cfg.idPattern} (for example ${cfg.idExample})`
  if (!slug || !cfg.slugRe.test(slug)) return `slug "${slug ?? ''}" does not match slugPattern ${cfg.slugPattern}`
  return null
}

/** Throws if the branch or worktree for this fix already exists. */
export function assertFree(cfg, p) {
  if (existsSync(p.wt)) throw new Error(`worktree already exists: ${p.wt}`)
  if (gitIn(cfg.root, ['branch', '--list', p.branch])) throw new Error(`branch already exists: ${p.branch}`)
}

export function renderCard(cfg, { id, slug, title }) {
  const tplPath = join(cfg.root, cfg.cardTemplate)
  if (!existsSync(tplPath)) throw new Error(`card template missing: ${cfg.cardTemplate}`)
  const date = new Date().toISOString().slice(0, 10)
  const vars = { ID: id, SLUG: slug, DATE: date, TITLE: title || slug.replaceAll('-', ' '), BRANCH: `${cfg.branchPrefix}${id}-${slug}`, TESTS_BRANCH: cfg.testsBranch || 'none' }
  return readFileSync(tplPath, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => vars[k] ?? m)
}

/** Creates branch + worktree from base and writes the card into the worktree. fetch=false skips `git fetch`. */
export function startFix(cfg, { id, slug, title, fetch = true }) {
  const err = validateIdSlug(cfg, id, slug)
  if (err) throw new Error(err)
  const p = fixPaths(cfg, id, slug)
  assertFree(cfg, p)
  const card = renderCard(cfg, { id, slug, title })
  if (fetch) gitIn(cfg.root, ['fetch', cfg.remote, cfg.baseBranch])
  gitIn(cfg.root, ['worktree', 'add', '-b', p.branch, p.wt, cfg.base])
  mkdirSync(dirname(p.cardPath), { recursive: true })
  if (!existsSync(p.cardPath)) writeFileSync(p.cardPath, card)
  return p
}

export function fail(msg, code = 2) { console.error(msg); process.exit(code) }
