// Local Claude explorers. Agent units (units.json "agent": {charter, mcp, maxTurns, model}) never run on a runner:
// after a fleet run is pulled, `fleet explore --run <id>` writes one brief per charter. The Claude Code session on
// YOUR PC hands each brief to a subagent (skill dispatching-parallel-agents), with your own Claude login.
import fs from 'node:fs'
import path from 'node:path'
import { loadUnits, localAgents } from './units.mjs'
import { loadRun, runDir } from './fleet.mjs'

export function exploreBriefs({ cfg, runId, projectDir, only, tags }) {
  const run = loadRun(cfg, runId)
  const agents = localAgents(loadUnits(projectDir).units, { only, tags })
  const failing = Object.entries(run.results).filter(([, r]) => r.status !== 'pass').map(([u, r]) => `- ${u}: ${r.status}${r.reason ? ` (${r.reason})` : ''}${r.dir ? ` -> ${r.dir}` : ''}`)
  const dir = path.join(runDir(cfg, runId), 'explore')
  fs.mkdirSync(dir, { recursive: true })
  return agents.map((u) => {
    const charter = path.join(projectDir, u.agent.charter)
    const brief = [
      `# Explorer brief: ${u.id}`, '',
      `Run ${run.runId} of ${run.source}@${run.ref}. You run LOCALLY with the owner's Claude login: never copy a token or a result into a public place.`, '',
      `Charter: ${charter}${fs.existsSync(charter) ? '' : ' (MISSING in the project checkout)'}`,
      `MCP servers to use: ${(u.agent.mcp ?? []).join(', ') || 'none'} | max turns ${u.agent.maxTurns ?? 60} | model ${u.agent.model ?? 'session default'}`, '',
      'Cloud results that did not pass:', ...(failing.length ? failing : ['- none']), '',
      `Write ${path.join(dir, u.id, 'report.md')}: first line "FINDINGS: <n>", then one section per finding (steps, expected, actual, evidence path).`,
      'Draft tests go next to the report as drafts: a human or the test-plan pipeline (stage S4 refine) promotes them.',
    ].join('\n') + '\n'
    const p = path.join(dir, `${u.id}.brief.md`)
    fs.writeFileSync(p, brief)
    return { unit: u.id, brief: p, charter, mcp: u.agent.mcp ?? [] }
  })
}
