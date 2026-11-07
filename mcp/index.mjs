#!/usr/bin/env node
// tests_runner MCP server (stdio, JSON-RPC 2.0, no dependencies). Uses only the gh CLI login of this PC.
// Register:  claude mcp add --scope user tests-runner -- node <path>/mcp/index.mjs
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import * as fleet from '../lib/fleet.mjs'
import * as local from '../lib/local.mjs'
import { localConfig } from '../lib/config.mjs'
import { exploreBriefs } from '../lib/explore.mjs'

const log = (m) => process.stderr.write(`[tests_runner] ${m}\n`)
const bg = new Map() // coordinator run id -> state of the background wait + pull

const S = (props, required = []) => ({ type: 'object', properties: props, required })
const str = (d) => ({ type: 'string', description: d })
const arr = (d) => ({ type: 'array', items: { type: 'string' }, description: d })
const sel = { only: arr('Unit ids (or step ids); empty = all'), tags: arr('Only units with one of these tags') }

const TOOLS = [
  { name: 'fleet_runners', description: 'Runner repos the coordinator sees (App installations), their state and free parallel jobs. Takes ~1 minute (it runs the coordinator in status mode).', inputSchema: S({}) },
  { name: 'fleet_plan', description: 'Offline plan: which units of the project would run where, with the estimated wall time. Dispatches nothing.', inputSchema: S({ project: str('Project directory with .qa-fleet/units.json'), runners: { type: 'number', description: 'How many runners to assume (default 3)' }, ...sel }, ['project']) },
  { name: 'fleet_run', description: 'Start the coordinator for a PUSHED ref of the source repo. Returns the coordinator run id at once; it then waits and pulls in the background: poll fleet_result.', inputSchema: S({ source: str('Private source repo owner/name'), ref: str('Pushed branch, tag or sha'), project: str('Optional checkout: its .qa-fleet/timings.json is updated'), ...sel }, ['source', 'ref']) },
  { name: 'fleet_result', description: 'State of a coordinator run started with fleet_run; once pulled: the summary and the local folder of each unit (JUnit, logs, screenshots).', inputSchema: S({ ghRunId: str('Coordinator run id') }, ['ghRunId']) },
  { name: 'fleet_pull', description: 'Download and decrypt the results of a completed coordinator run (with the private key of this PC).', inputSchema: S({ ghRunId: str('Coordinator run id'), project: str('Optional checkout for timings.json') }, ['ghRunId']) },
  { name: 'fleet_explore', description: 'Briefs for the LOCAL Claude explorer units of a pulled run. Hand each brief to a subagent of this session.', inputSchema: S({ runId: str('Local run id (from fleet_pull)'), project: str('Project checkout'), ...sel }, ['runId', 'project']) },
  { name: 'fleet_runs', description: 'Recent pulled runs on this PC.', inputSchema: S({}) },
]

const brief = (r) => ({ runId: r.runId, ...r.summary, summaryPath: r.summaryPath, units: Object.fromEntries(Object.entries(r.results).map(([u, x]) => [u, { status: x.status, reason: x.reason, dir: x.dir, junit: x.junit }])) })

async function call(name, a) {
  const cfg = localConfig()
  switch (name) {
    case 'fleet_runners': return local.runners({ log })
    case 'fleet_plan': { const n = a.runners ?? 3; return fleet.makePlan({ cfg: { runners: Array.from({ length: n }, (_, i) => ({ name: `runner-${i + 1}`, maxParallel: 20 })) }, projectDir: a.project, only: a.only, tags: a.tags }) }
    case 'fleet_run': {
      const r = local.startRemote({ source: a.source, ref: a.ref, only: a.only ?? [], tags: a.tags ?? [] })
      const st = { state: 'running', url: r.url }
      bg.set(r.ghRunId, st)
      local.waitRemote(r.ghRunId, { log }).then(() => local.pull({ ghRun: r.ghRunId, projectDir: a.project, log })).then((p) => { st.state = 'pulled'; st.result = brief(p) }).catch((e) => { st.state = 'error'; st.error = e.message })
      return { ...r, next: 'poll fleet_result with this ghRunId (a full run takes as long as its slowest unit)' }
    }
    case 'fleet_result': { const st = bg.get(String(a.ghRunId)); if (st) return st; const s = local.runState(a.ghRunId); return { state: s.status, conclusion: s.conclusion, url: s.url, next: s.status === 'completed' ? 'call fleet_pull' : 'wait' } }
    case 'fleet_pull': return brief(await local.pull({ ghRun: a.ghRunId, projectDir: a.project, log }))
    case 'fleet_explore': return exploreBriefs({ cfg, runId: a.runId, projectDir: a.project, only: a.only, tags: a.tags })
    case 'fleet_runs': { if (!fs.existsSync(cfg.outDir)) return []; return fs.readdirSync(cfg.outDir).sort().reverse().slice(0, 20).map((id) => { try { const r = fleet.loadRun(cfg, id); return { runId: id, source: r.source, ref: r.ref, created: r.created, ghRun: r.ghCoordinatorRun, collected: Object.keys(r.results).length } } catch { return { runId: id } } }) }
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
    if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'tests-runner', version: JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version } } })
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} })
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    if (method === 'tools/call') {
      try { const r = await call(params.name, params.arguments ?? {}); return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: typeof r === 'string' ? r : JSON.stringify(r, null, 1) }] } }) }
      catch (e) { return send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: e.message }] } }) }
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } })
  } catch (e) { send({ jsonrpc: '2.0', id, error: { code: -32603, message: e.message } }) }
})
