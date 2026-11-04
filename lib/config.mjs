// Local fleet configuration. Two forms, both hold tokens: never inside a repo or a synced folder.
//   - a fleet card (markdown with a json block, see card/QA-FLEET-CARD.md): QA_FLEET_CARD, or QA_FLEET_CONFIG pointing at it,
//     or ~/.qa-fleet/QA-FLEET-CARD.md
//   - the older ~/.qa-fleet/fleet.json (or QA_FLEET_CONFIG)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isCardText, parseCard, cardToConfig } from './card.mjs'

export function configPath() {
  if (process.env.QA_FLEET_CARD) return process.env.QA_FLEET_CARD
  if (process.env.QA_FLEET_CONFIG) return process.env.QA_FLEET_CONFIG
  const home = path.join(os.homedir(), '.qa-fleet')
  const card = path.join(home, 'QA-FLEET-CARD.md')
  return fs.existsSync(card) ? card : path.join(home, 'fleet.json')
}

export function loadConfig(p = configPath()) {
  if (!fs.existsSync(p)) throw Object.assign(new Error(`fleet config not found: ${p} (fill a fleet card: node cli/fleet.mjs card new)`), { code: 'NO_CONFIG' })
  const text = fs.readFileSync(p, 'utf8')
  if (isCardText(text)) { const c = cardToConfig(parseCard(text, p), p); c._path = p; return c }
  const c = JSON.parse(text)
  const errs = []
  if (!Array.isArray(c.runners) || !c.runners.length) errs.push('runners[] is empty')
  for (const [i, r] of (c.runners ?? []).entries()) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(r.repo ?? '')) errs.push(`runners[${i}].repo must be owner/name`)
    if (!r.token && !r.tokenEnv) errs.push(`runners[${i}] needs token or tokenEnv`)
    r.name ??= r.repo
    r.maxParallel = Number(r.maxParallel ?? 20)
    r.workflow ??= c.workflow ?? 'shard.yml'
    r.branch ??= 'main'
  }
  for (const [k, s] of Object.entries(c.sources ?? {})) if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo ?? '')) errs.push(`sources.${k}.repo must be owner/name`)
  if (errs.length) throw new Error(`fleet config ${p}: ${errs.join('; ')}`)
  c.identityPath ??= path.join(path.dirname(p), 'identity.key')
  c.outDir ??= path.join(path.dirname(p), 'runs')
  c._path = p
  return c
}

export const tokenOf = (r) => r.token || process.env[r.tokenEnv] || ''

// private result key: inline in the card, else the identity file
export function identityOf(c) {
  if (c.identity) return c.identity.trim()
  if (fs.existsSync(c.identityPath)) return fs.readFileSync(c.identityPath, 'utf8').trim()
  throw new Error(`private result key not found (card results.identity or ${c.identityPath}): run  fleet bootstrap  or  fleet keygen`)
}
export const hasIdentity = (c) => !!c.identity || fs.existsSync(c.identityPath)

export function resolveSource(c, name) {
  if (c.sources?.[name]) return c.sources[name].repo
  if (/^[\w.-]+\/[\w.-]+$/.test(name ?? '')) return name
  throw new Error(`unknown source "${name}" (add it to the card or to sources{} in ${c._path})`)
}

// redacted view for logs and MCP answers
export const publicView = (c) => ({ config: c._path, runners: c.runners.map((r) => ({ name: r.name, repo: r.repo, maxParallel: r.maxParallel, enabled: r.enabled !== false, token: tokenOf(r) ? 'set' : 'MISSING' })), sources: Object.fromEntries(Object.entries(c.sources ?? {}).map(([k, v]) => [k, v.repo])), identity: hasIdentity(c) ? 'present' : 'MISSING', outDir: c.outDir })
