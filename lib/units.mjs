// The project contract: <project>/.qa-fleet/units.json (schema qa-fleet/units@1). See schema/units.schema.json.
import fs from 'node:fs'
import path from 'node:path'

export const SCHEMA = 'qa-fleet/units@1'
const NEED = /^(docker|kvm|free-disk|android-emulator(:\d+)?|browsers(:[a-z,]+)?|node:\d+|pnpm:\d+|python:[\d.]+|java:\d+|go:[\d.]+|services:(postgres|redis|mysql)(,(postgres|redis|mysql))*)$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function validateUnits(doc) {
  const errs = []
  if (doc?.schema !== SCHEMA) errs.push(`schema must be "${SCHEMA}"`)
  const d = doc?.defaults ?? {}
  const seen = new Set()
  for (const [i, u0] of (doc?.units ?? []).entries()) {
    const u = { ...d, ...u0, needs: [...new Set([...(d.needs ?? []), ...(u0.needs ?? [])])], secrets: [...new Set([...(d.secrets ?? []), ...(u0.secrets ?? [])])] }
    const at = `units[${i}]${u.id ? ` (${u.id})` : ''}`
    if (!ID.test(u.id ?? '')) errs.push(`${at}: id must match ${ID}`)
    if (seen.has(u.id)) errs.push(`${at}: duplicate id`); seen.add(u.id)
    if (!u.cmd && !u.agent) errs.push(`${at}: needs cmd or agent`)
    if (u.agent && !u.agent.charter) errs.push(`${at}: agent.charter (path in the repo) is required`)
    if ((u.secrets ?? []).some((x) => /CLAUDE|ANTHROPIC/i.test(x))) errs.push(`${at}: Claude credentials never go to a runner (agent units run locally with your own login)`)
    for (const n of u.needs) if (!NEED.test(n)) errs.push(`${at}: unknown need "${n}"`)
    for (const s of u.secrets) if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(s) || /^(GITHUB_|ACTIONS_|SOURCE_REPO_TOKEN)/.test(s)) errs.push(`${at}: bad secret name "${s}"`)
    if (u.timeoutMinutes != null && !(u.timeoutMinutes >= 1 && u.timeoutMinutes <= 360)) errs.push(`${at}: timeoutMinutes 1-360`)
  }
  if (!(doc?.units ?? []).length) errs.push('units[] is empty')
  return errs
}

export function expandUnits(doc) {
  const d = doc.defaults ?? {}
  return doc.units.map((u0) => {
    const u = { timeoutMinutes: 60, results: ['qa-fleet-results'], estMinutes: 10, ...d, ...u0 }
    u.needs = [...new Set([...(d.needs ?? []), ...(u0.needs ?? [])])]
    u.secrets = [...new Set([...(d.secrets ?? []), ...(u0.secrets ?? [])])]
    u.tags = [...new Set([...(d.tags ?? []), ...(u0.tags ?? [])])]
    u.env = { ...(d.env ?? {}), ...(u0.env ?? {}) }
    // agent units are Claude explorers: they run LOCALLY on the coordinating PC (the owner's own Claude login), never on a runner
    if (u.agent) { u.local = true; u.tags = [...new Set([...u.tags, 'agent'])] }
    return u
  })
}

export function loadUnits(projectDir) {
  const p = path.join(projectDir, '.qa-fleet', 'units.json')
  if (!fs.existsSync(p)) throw new Error(`no ${p}: run "fleet init" in the project first`)
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'))
  const errs = validateUnits(doc)
  if (errs.length) throw new Error(`invalid ${p}:\n- ${errs.join('\n- ')}`)
  return { doc, units: expandUnits(doc), path: p }
}

// select the units the RUNNERS execute: ids or step ids, tags. Agent (Claude explorer) units never go to a runner.
export function selectUnits(units, { only, tags } = {}) {
  let u = units.filter((x) => !x.agent)
  if (only?.length) u = u.filter((x) => only.includes(x.id) || (x.step && only.includes(x.step)))
  if (tags?.length) u = u.filter((x) => x.tags.some((t) => tags.includes(t)))
  return u
}

// what the runner needs to prepare, as flat fields usable in workflow `if:` expressions
export function normalizeNeeds(needs) {
  const o = { node: '', pnpm: '', python: '', java: '', go: '', kvm: false, docker: false, freeDisk: false, emulatorApi: '', browsers: '', services: '' }
  for (const n of needs) {
    const [k, v = ''] = n.split(':')
    if (k === 'android-emulator') { o.emulatorApi = v || '34'; o.kvm = true; o.freeDisk = true; o.java ||= '21' }
    else if (k === 'kvm') o.kvm = true
    else if (k === 'docker') o.docker = true
    else if (k === 'free-disk') o.freeDisk = true
    else if (k === 'browsers') o.browsers = v || 'chromium'
    else if (k === 'services') o.services = v
    else o[k] = v
  }
  return o
}

// the per-unit object the workflow matrix receives (no command text: the runner reads it from the source repo)
export function matrixEntry(u) {
  if (u.agent) throw new Error(`${u.id} is a local Claude explorer unit: it never runs on a runner`)
  return { id: u.id, timeout: u.timeoutMinutes, runsOn: u.runsOn ?? 'ubuntu-latest', secrets: u.secrets.join(','), ...normalizeNeeds(u.needs) }
}

// local Claude explorer units (run on the coordinating PC after the cloud results are in)
export function localAgents(units, { only, tags } = {}) {
  let u = units.filter((x) => x.agent)
  if (only?.length) u = u.filter((x) => only.includes(x.id) || (x.step && only.includes(x.step)))
  if (tags?.length) u = u.filter((x) => x.tags.some((t) => tags.includes(t)))
  return u
}
