// qa.config.json loader: the ONE place where project constants live (stack, ports, preview, personas, env prefix,
// ids, areas, mobile, router, backend). Every script takes --project <dir> (or QA_PROJECT, default: cwd).
import fs from 'node:fs'
import path from 'node:path'
import { PACK_DIR, readJson, posix } from './util.mjs'
import { validate } from './jsonschema.mjs'

export const CONFIG_FILE = 'qa.config.json'
const SCHEMA = path.join(PACK_DIR, 'schema', 'qa.config.schema.json')

export const DEFAULT_PATHS = {
 research: 'qa/research',
 briefs: 'qa/research/briefs',
 requirements: 'qa/research/requirements.json',
 testRequirements: 'qa/research/TEST_REQUIREMENTS.md',
 coverage: 'qa/research/coverage.json',
 cases: 'qa/browser-tests',
 modules: 'qa/modules',
 contracts: 'qa/design/contract',
 golden: 'qa/design/golden',
 candidates: 'qa/design/candidates',
 evidence: 'qa/evidence',
 compiled: 'tests/compiled',
 inventory: 'qa/inventory.json',
 inventoryMd: 'qa/INVENTORY.md',
 graph: 'graphify-out/graph.json',
 plans: 'qa/plans',
 access: 'qa/access/matrix.json',
 decisions: 'qa/decisions.md',
 gateEvidence: 'qa/evidence/gates',
 state: '.qa-pack',
 fleet: '.qa-fleet',
}

export function projectDirFrom(argv = process.argv.slice(2)) {
 const i = argv.indexOf('--project')
 const p = i >= 0 ? argv[i + 1] : process.env.QA_PROJECT || process.cwd()
 return path.resolve(p)
}

export function validateConfig(cfg) {
 const errs = validate(readJson(SCHEMA), cfg)
 const keys = new Set()
 for (const p of cfg.personas ?? []) { if (keys.has(p.key)) errs.push(`personas: duplicate key ${p.key}`); keys.add(p.key) }
 const areas = new Set()
 for (const a of cfg.areas ?? []) { if (areas.has(a.id)) errs.push(`areas: duplicate id ${a.id}`); areas.add(a.id) }
 for (const k of ['requirement', 'module']) { try { new RegExp(cfg.ids?.[k] ?? '') } catch (e) { errs.push(`ids.${k}: bad regex (${e.message})`) } }
 if (cfg.mobile?.enabled) for (const k of ['appId', 'apiLevel']) if (!cfg.mobile[k]) errs.push(`mobile.${k} is required when mobile.enabled`)
 return errs
}

export function loadConfig(projectDir = projectDirFrom()) {
 const file = path.join(projectDir, CONFIG_FILE)
 if (!fs.existsSync(file)) throw Object.assign(new Error(`no ${CONFIG_FILE} in ${projectDir} (copy qa-pack/templates/qa.config.json and fill it)`), { code: 'NO_CONFIG' })
 const cfg = readJson(file)
 const errs = validateConfig(cfg)
 if (errs.length) throw Object.assign(new Error(`invalid ${file}:\n- ${errs.join('\n- ')}`), { code: 'BAD_CONFIG' })
 return withHelpers(cfg, projectDir)
}

function withHelpers(cfg, dir) {
 const paths = { ...DEFAULT_PATHS, ...(cfg.paths ?? {}) }
 const prefix = cfg.env?.prefix ?? 'QA_'
 const reqSrc = cfg.ids.requirement, modSrc = cfg.ids.module
 return {
  ...cfg,
  dir,
  paths,
  prefix,
  stack: { kind: 'none', ...(cfg.stack ?? {}) },
  backend: { adapter: 'none', scaffoldMarker: 'QA-SCAFFOLD', ...(cfg.backend ?? {}) },
  mobile: { enabled: false, ...(cfg.mobile ?? {}), maestro: { flows: 'maestro/flows', out: 'qa/evidence/maestro', runs: 5, ...(cfg.mobile?.maestro ?? {}) } },
  playwright: { config: 'playwright.config.mjs', shards: 1, workers: 1, browsers: 'chromium', projects: [{ name: 'desktop', device: 'Desktop Chrome' }], ...(cfg.playwright ?? {}) },
  gates: { profiles: ['core'], ...(cfg.gates ?? {}) },
  fleet: { node: '22', results: ['qa-fleet-results'], explore: false, setup: {}, ...(cfg.fleet ?? {}) },
  /** absolute path of a configured path key or a project-relative path */
  abs: (keyOrRel) => path.resolve(dir, paths[keyOrRel] ?? keyOrRel),
  rel: (p) => posix(path.relative(dir, p)),
  reqRe: (flags = 'g') => new RegExp(`\\b(?:${reqSrc})\\b`, flags),
  isReq: (s) => new RegExp(`^(?:${reqSrc})$`).test(s),
  modRe: (flags = 'g') => new RegExp(`\\b(?:${modSrc})\\b`, flags),
  isMod: (s) => new RegExp(`^(?:${modSrc})$`).test(s),
  personaVar: (persona, field) => `${prefix}${persona}_${field}`,
 }
}
