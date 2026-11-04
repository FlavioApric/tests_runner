#!/usr/bin/env node
// qa-fleet MCP server (stdio, JSON-RPC 2.0, no dependencies). Generic: works for any project that has .qa-fleet/units.json.
// Register:  claude mcp add --scope user qa-fleet -- node <path>/mcp/index.mjs
// Config:    the fleet card (QA_FLEET_CARD or ~/.qa-fleet/QA-FLEET-CARD.md), or ~/.qa-fleet/fleet.json / QA_FLEET_CONFIG. Tokens are never returned by any tool.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import * as fleet from '../lib/fleet.mjs'
import { loadConfig, configPath } from '../lib/config.mjs'
import { readCard, validateCard } from '../lib/card.mjs'
import { bootstrap, findBranch } from '../lib/bootstrap.mjs'
import { viaCoordinator, pull } from '../lib/coordinator.mjs'
import { exploreBriefs } from '../lib/explore.mjs'
import { tokenReport } from '../lib/tokens.mjs'

const log = (m) => process.stderr.write(`[qa-fleet] ${m}\n`)
const runs = new Map() // runId -> promise of a background full cycle

const S = (props, required = []) => ({ type: 'object', properties: props, required })
const str = (d) => ({ type: 'string', description: d })
const arr = (d) => ({ type: 'array', items: { type: 'string' }, description: d })
const common = { project: str('Project directory containing .qa-fleet/units.json (absolute path)'), only: arr('Unit ids (or step ids) to run; empty = all'), tags: arr('Only units with one of these tags') }

const TOOLS = [
  { name: 'fleet_status', description: 'Runner repos of the fleet: reachable, public/private, busy jobs, free parallel slots, setup gaps. Never shows secret values.', inputSchema: S({}) },
  { name: 'fleet_plan', description: 'Dry plan: which units of the project would run on which runner, with the estimated wall time. Dispatches nothing.', inputSchema: S(common, ['project']) },
  { name: 'fleet_run', description: 'Start a full cycle in the background (dispatch -> watch -> collect, one retry for infrastructure failures only). Returns a runId at once; poll with fleet_watch. The runners test the PUSHED ref, not local changes.', inputSchema: S({ ...common, source: str('Source name from fleet.json sources{} or owner/repo'), ref: str('Pushed branch, tag or commit to test') }, ['project', 'source', 'ref']) },
  { name: 'fleet_watch', description: 'Progress of a run: per batch status and per unit results once collected.', inputSchema: S({ runId: str('Run id') }, ['runId']) },
  { name: 'fleet_collect', description: 'Download, decrypt (local private key) and summarise the results of a run now. Returns the summary table and the local folder of each unit (JUnit, screenshots, reports).', inputSchema: S({ runId: str('Run id') }, ['runId']) },
  { name: 'fleet_cancel', description: 'Cancel the GitHub runs of a fleet run that are still going.', inputSchema: S({ runId: str('Run id') }, ['runId']) },
  { name: 'fleet_runs', description: 'Recent fleet runs on this PC.', inputSchema: S({}) },
  { name: 'fleet_card_check', description: 'Check the fleet card (QA_FLEET_CARD): missing fields, runner states, and which source branch carries the full tests (ready / missing .qa-fleet / missing). Read-only.', inputSchema: S({}) },
  { name: 'fleet_coordinate', description: 'Start the coordinator workflow (coordinate.yml) in your tests_runner repo: it plans, dispatches and bundles SEALED results on GitHub. GitHub waits for the owner to approve the "fleet" environment. Then call fleet_pull with the returned ghRunId.', inputSchema: S({ only: common.only, tags: common.tags, source: str('Source name from the card or owner/repo'), ref: str('Pushed branch, tag or commit to test') }, ['source', 'ref']) },
  { name: 'fleet_pull', description: 'Download the bundle of a completed coordinator run and decrypt it with the local private key. Returns the summary and the local folder of each unit.', inputSchema: S({ ghRunId: str('Run id of coordinate.yml'), project: str('Optional project dir: its .qa-fleet/timings.json is updated') }, ['ghRunId']) },
  { name: 'fleet_explore', description: 'Briefs for the LOCAL Claude explorer units (agent units never run on a runner). Hand each brief to a subagent of this session.', inputSchema: S({ runId: str('Local run id (from fleet_run or fleet_pull)'), project: common.project, only: common.only, tags: common.tags }, ['runId', 'project']) },
  { name: 'fleet_tokens', description: 'What each token of the card can read and when it expires (read-only probes, no token value returned).', inputSchema: S({}) },
  { name: 'fleet_bootstrap', description: 'Set up every runner repo from the card: push the tool code to main, Actions on, variables, secrets. dry=true shows what it would do. The real run pushes to PUBLIC repos: only with confirm=true after the owner said yes.', inputSchema: S({ dry: { type: 'boolean' }, confirm: { type: 'boolean', description: 'true only after the owner approved pushing to the runner repos' }, only: arr('Runner owners to set up; empty = all') }) },
]

async function call(name, a) {
  if (name === 'fleet_card_check') {
    const card = readCard(configPath()), v = validateCard(card)
    if (v.errors.length) return { card: configPath(), errors: v.errors, warnings: v.warnings }
    const st = await fleet.status(loadConfig())
    return { card: configPath(), warnings: v.warnings, runners: st.runners.map((r) => ({ repo: r.repo, state: r.state, freeSlots: r.freeSlots, missing: r.missing })), testBranch: await findBranch({ card }), resultKey: card.results?.identity ? 'present' : 'missing (bootstrap creates it)' }
  }
  if (name === 'fleet_bootstrap') {
    if (!a.dry && a.confirm !== true) throw new Error('the real bootstrap pushes to public repos: ask the owner, then call again with confirm=true (or dry=true to preview)')
    const lines = []
    const r = await bootstrap({ cardPath: configPath(), dry: !!a.dry, only: a.only, log: (m) => lines.push(m) })
    return { ok: r.ok, report: r.report, log: lines }
  }
  const cfg = loadConfig()
  switch (name) {
    case 'fleet_status': return fleet.status(cfg)
    case 'fleet_plan': { const st = await fleet.status(cfg).catch(() => null); return fleet.makePlan({ cfg, projectDir: a.project, only: a.only, tags: a.tags, runnersState: st?.runners }) }
    case 'fleet_coordinate': return viaCoordinator({ cfg, source: a.source, ref: a.ref, only: a.only, tags: a.tags })
    case 'fleet_pull': { const r = await pull({ cfg, ghRun: a.ghRunId, projectDir: a.project, log }); return { runId: r.runId, ...r.summary, summaryPath: r.summaryPath, units: Object.fromEntries(Object.entries(r.results).map(([u, x]) => [u, { status: x.status, reason: x.reason, dir: x.dir, junit: x.junit }])) } }
    case 'fleet_explore': return exploreBriefs({ cfg, runId: a.runId, projectDir: a.project, only: a.only, tags: a.tags })
    case 'fleet_tokens': return tokenReport({ card: readCard(configPath()) })
    case 'fleet_run': {
      const quiet = []
      const first = await fleet.dispatch({ cfg, projectDir: a.project, source: a.source, ref: a.ref, only: a.only, tags: a.tags, log: (m) => quiet.push(m) })
      const p = (async () => {
        let r = await fleet.watch({ cfg, runId: first.runId, log })
        r = await fleet.collect({ cfg, runId: first.runId, log })
        return r
      })().catch((e) => { log(`run ${first.runId}: ${e.message}`); throw e })
      runs.set(first.runId, p)
      return { runId: first.runId, dispatched: first.batches.map((b) => ({ runner: b.runner, units: b.units.length, url: b.url })), estWallMinutes: first.plan.estWallMinutes, next: 'call fleet_watch with this runId; when every batch is completed call fleet_collect' }
    }
    case 'fleet_watch': {
      const r = fleet.loadRun(cfg, a.runId)
      return { runId: r.runId, batches: r.batches.map((b) => ({ batch: b.batch, runner: b.runner, status: b.status, url: b.url, units: Object.fromEntries(b.units.map((u) => [u, b.jobs?.[u]?.conclusion ?? b.jobs?.[u]?.status ?? 'queued'])) })), collected: Object.keys(r.results).length, background: runs.has(a.runId) ? 'watching' : 'not watching (call fleet_collect when batches are completed)' }
    }
    case 'fleet_collect': { const r = await fleet.collect({ cfg, runId: a.runId, log }); const s = fleet.summary(r); return { ...s, units: Object.fromEntries(Object.entries(r.results).map(([u, x]) => [u, { status: x.status, reason: x.reason, dir: x.dir, junit: x.junit }])) } }
    case 'fleet_cancel': return { cancelled: await fleet.cancel({ cfg, runId: a.runId }) }
    case 'fleet_runs': { if (!fs.existsSync(cfg.outDir)) return []; return fs.readdirSync(cfg.outDir).sort().reverse().slice(0, 20).map((id) => { try { const r = fleet.loadRun(cfg, id); return { runId: id, source: r.source, ref: r.ref, created: r.created, units: r.plan?.units, collected: Object.keys(r.results).length } } catch { return { runId: id } } }) }
    default: throw new Error(`unknown tool ${name}`)
  }
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', async (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  const { id, method, params } = msg
  if (id === undefined) return // notification
  try {
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'qa-fleet', version: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version } } })
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    if (method === 'tools/call') {
      try { const r = await call(params.name, params.arguments ?? {}); return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) }] } }) }
      catch (e) { return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e.message }] } }) }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }) }
})
