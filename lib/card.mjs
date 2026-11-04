// The fleet card: ONE markdown file that holds the whole fleet setup (the first ```json block) plus the
// instructions a Claude Code session follows. Give the card to a session and it can set up the runners,
// find (or build) the test branch and run the tests. It holds tokens: keep it outside repos and synced folders.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const CARD_SCHEMA = 'qa-fleet/card@1'
const BLOCK = /```json[^\n]*\n([\s\S]*?)\n```/
const REPO = /^[\w.-]+\/[\w.-]+$/
export const DEFAULT_REPO = 'tests_runner'
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/

export const isCardText = (text) => /^\s*#/.test(text) && BLOCK.test(text) && text.includes(CARD_SCHEMA)

export function parseCard(text, where = 'card') {
  const m = BLOCK.exec(text)
  if (!m) throw new Error(`${where}: no \`\`\`json block found`)
  try { return JSON.parse(m[1]) } catch (e) { throw new Error(`${where}: the json block is not valid JSON (${e.message})`) }
}

export const readCard = (p) => parseCard(fs.readFileSync(p, 'utf8'), p)

// rewrite only the json block (keeps the instructions around it untouched)
export function updateCard(p, mutate) {
  const text = fs.readFileSync(p, 'utf8')
  const card = parseCard(text, p)
  mutate(card)
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const json = JSON.stringify(card, null, 2).replace(/\n/g, eol)
  fs.writeFileSync(p, text.replace(BLOCK, (all) => all.slice(0, all.indexOf('\n') + 1) + json + eol + '```'))
  return card
}

const filled = (v) => typeof v === 'string' && v.trim() !== '' && !/^(<|\.\.\.|PASTE|TODO)/i.test(v.trim())

export function sourcesOf(card) {
  const list = Array.isArray(card.sources) ? card.sources : card.source ? [card.source] : []
  return list.map((s) => ({ name: s.name ?? s.repo?.split('/')[1], branches: [s.testBranch, ...(s.fallbackBranches ?? [])].filter(Boolean), ...s }))
}

export function validateCard(card) {
  const errs = [], warn = []
  if (card.card !== CARD_SCHEMA) errs.push(`"card" must be "${CARD_SCHEMA}"`)
  const runners = card.runners ?? []
  if (!runners.length) errs.push('runners[] is empty')
  const seen = new Set()
  for (const [i, r] of runners.entries()) {
    if (r.enabled === false) continue
    if (!OWNER.test(r.owner ?? '')) errs.push(`runners[${i}].owner: GitHub username of the account that owns the runner repo`)
    if (!/^[\w.-]+$/.test(r.repo ?? DEFAULT_REPO)) errs.push(`runners[${i}].repo: repository name only (default ${DEFAULT_REPO})`)
    if (!filled(r.token)) errs.push(`runners[${i}].token: fine-grained PAT of ${r.owner || 'that account'}, only on its runner repo`)
    const key = `${r.owner}/${r.repo ?? DEFAULT_REPO}`.toLowerCase()
    if (r.owner && seen.has(key)) errs.push(`runners[${i}]: ${key} is listed twice`)
    seen.add(key)
  }
  const owners = new Set(runners.filter((r) => r.enabled !== false).map((r) => r.owner?.toLowerCase()))
  if (owners.size < runners.filter((r) => r.enabled !== false).length) warn.push('two runners share an owner: the 20 parallel jobs are per account, so they share them')
  const sources = sourcesOf(card)
  if (!sources.length) errs.push('source: the private repo to test is missing')
  for (const s of sources) {
    if (!REPO.test(s.repo ?? '')) errs.push(`source ${s.name}: repo must be owner/name`)
    if (!filled(s.readToken)) errs.push(`source ${s.name}: readToken (fine-grained PAT, Contents READ only, on ${s.repo || 'the source repo'})`)
    if (!s.branches.length) errs.push(`source ${s.name}: testBranch is missing`)
  }
  for (const [k, v] of Object.entries(card.secrets ?? {})) {
    if (/CLAUDE|ANTHROPIC/i.test(k)) errs.push(`secrets.${k}: Claude credentials never go to a runner (Claude runs only on your PC, with your own login): remove it`)
    else if (!filled(v)) warn.push(`secret ${k} is empty: units that need it will fail on setup`)
  }
  const co = card.coordinator
  if (co && filled(co.repo)) {
    if (!REPO.test(co.repo)) errs.push('coordinator.repo must be owner/name (your tests_runner repo)')
    else if (!runners.some((r) => r.enabled !== false && `${r.owner}/${r.repo ?? DEFAULT_REPO}`.toLowerCase() === co.repo.toLowerCase())) errs.push(`coordinator.repo ${co.repo} must also be one of the runners (its token dispatches the coordinator)`)
  } else warn.push('coordinator.repo is not set: only the local mode (fleet run from this PC) is available')
  if (filled(card.secrets?.STRIPE_TEST_KEY) && !card.secrets.STRIPE_TEST_KEY.startsWith('sk_test_')) errs.push('secrets.STRIPE_TEST_KEY must be a TEST key (sk_test_...)')
  if (card.results?.identity && !/^qafsec1:/.test(card.results.identity)) errs.push('results.identity is not a qa-fleet private key (qafsec1:...)')
  return { errors: errs, warnings: warn }
}

// card -> the config shape the rest of qa-fleet uses
export function cardToConfig(card, p) {
  const { errors } = validateCard(card)
  if (errors.length) throw new Error(`fleet card ${p}:\n- ${errors.join('\n- ')}`)
  const home = path.join(os.homedir(), '.qa-fleet')
  return {
    fromCard: p,
    runners: card.runners.map((r) => ({ name: r.name ?? r.owner, repo: `${r.owner}/${r.repo ?? DEFAULT_REPO}`, token: r.token, maxParallel: Number(r.maxParallel ?? 20), enabled: r.enabled !== false, workflow: r.workflow ?? 'shard.yml', branch: r.branch ?? 'main' })),
    sources: Object.fromEntries(sourcesOf(card).map((s) => [s.name, { repo: s.repo, readToken: s.readToken, branches: s.branches, baseBranch: s.baseBranch ?? 'main' }])),
    coordinator: coordinatorOf(card),
    identity: card.results?.identity || null,
    identityPath: path.join(home, 'identity.key'),
    outDir: card.results?.outDir || path.join(home, 'runs'),
  }
}

// the coordinator workflow lives in one runner repo (your tests_runner) and is dispatched with that runner's token
export function coordinatorOf(card) {
  const co = card.coordinator
  if (!co || !filled(co.repo)) return null
  const r = (card.runners ?? []).find((x) => x.enabled !== false && `${x.owner}/${x.repo ?? DEFAULT_REPO}`.toLowerCase() === co.repo.toLowerCase())
  return { name: 'coordinator', repo: co.repo, token: r?.token, workflow: co.workflow ?? 'coordinate.yml', branch: co.branch ?? 'main', environment: co.environment ?? 'fleet' }
}
