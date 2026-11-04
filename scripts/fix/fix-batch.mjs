// Several bugs at once: one branch + worktree per bug, a file-overlap check, and one brief file per fix agent.
// Bugs whose files overlap go in the same lane and are done in order; lanes run in parallel (skill: dispatching-parallel-agents),
// each agent in its own worktree (skill: git-worktree-isolation). Never two writers on the same file.
//   node scripts/fix/fix-batch.mjs <bugs.json> [--dry] [--no-fetch] [--out <dir>] [--config <path>]
// bugs.json: { "batch": "<name>", "bugs": [ { "id", "slug", "files": ["src/a.ts", "src/feed/"], "title"?, "report"? } ] } or a bare array.
// "files" are the files each fix is expected to touch (from the locate step). A path ending in "/" means the whole folder.
//   --dry   print the plan, create nothing, write nothing
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertFree, fail, fixPaths, loadConfig, normalizePath, parseArgs, startFix, validateIdSlug } from './lib.mjs'

/** True when two paths can be touched by the same edit: equal, or one is a folder ("x/") that holds the other. */
export function pathsOverlap(a, b) {
  a = normalizePath(a); b = normalizePath(b)
  return a === b || (a.endsWith('/') && b.startsWith(a)) || (b.endsWith('/') && a.startsWith(b))
}

/**
 * Groups bugs into lanes (connected by shared files; order inside a lane = input order) and waves (wave n = the n-th bug of every lane).
 * @param {{id: string, files: string[]}[]} bugs
 */
export function planBatch(bugs) {
  const ids = new Set()
  for (const b of bugs) {
    if (!b.id) throw new Error('every bug needs an id')
    if (ids.has(b.id)) throw new Error(`duplicate id ${b.id}`)
    ids.add(b.id)
    if (!Array.isArray(b.files) || b.files.length === 0) throw new Error(`${b.id}: "files" is empty; run the locate step first so the overlap check means something`)
  }
  const parent = bugs.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const conflicts = bugs.map(() => [])
  for (let i = 0; i < bugs.length; i++) {
    for (let j = i + 1; j < bugs.length; j++) {
      const shared = []
      for (const a of bugs[i].files.map(normalizePath)) for (const b of bugs[j].files.map(normalizePath)) if (pathsOverlap(a, b)) shared.push(a === b ? a : `${a} ~ ${b}`)
      if (shared.length) {
        conflicts[i].push({ with: bugs[j].id, files: shared }); conflicts[j].push({ with: bugs[i].id, files: shared })
        parent[find(j)] = find(i)
      }
    }
  }
  const laneOf = new Map(), lanes = []
  bugs.forEach((b, i) => {
    const r = find(i)
    if (!laneOf.has(r)) { laneOf.set(r, lanes.length); lanes.push([]) }
    lanes[laneOf.get(r)].push(b.id)
  })
  const items = bugs.map((b, i) => {
    const lane = laneOf.get(find(i)), pos = lanes[lane].indexOf(b.id)
    return { ...b, files: b.files.map(normalizePath), lane: lane + 1, wave: pos + 1, after: pos ? lanes[lane][pos - 1] : null, conflicts: conflicts[i] }
  })
  const waves = []
  for (const it of items) (waves[it.wave - 1] ??= []).push(it.id)
  return { lanes, waves, items }
}

export function renderBrief(cfg, it, p, prev, total) {
  const rel = (x) => relative(cfg.root, x).replaceAll('\\', '/') || '.'
  const start = it.after
    ? `after **${it.after}** is committed on \`${prev.branch}\`. Then, in your worktree: \`git rebase ${prev.branch}\` so you build on its change, and say in your report that your branch depends on it.`
    : 'now.'
  return `# Brief: ${it.id}${it.title ? ` ${it.title}` : ''}

You are one of ${total} fix agents in a batch (skill \`dispatching-parallel-agents\`). Work only inside your worktree (skill \`git-worktree-isolation\`); never edit the main checkout or another agent's worktree.

- Worktree: \`${p.wt}\`
- Branch: \`${p.branch}\` (from \`${cfg.base}\`)
- Card: \`${p.cardRel}\` (in the worktree)
- Lane ${it.lane}, wave ${it.wave}. Start ${start}

## Files this fix may change
${it.files.map((f) => `- \`${f}\``).join('\n')}

If the fix needs a file that is not in this list, stop and report it: another agent may own that file.${it.conflicts.length ? `\nShared with: ${it.conflicts.map((c) => `${c.with} (${c.files.join(', ')})`).join('; ')}. That is why this lane is sequential.` : ''}

## Report
${it.report ? it.report.trim() : '(see the card)'}

## Steps
Follow \`fix/PLAYBOOK.md\` (or the \`/fix\` skill) from step 1; step 0 is done (branch, worktree and card exist).
1. Classify and fill the card. 2. Locate; write the cause before any code change. 3. Red test. 4. Minimal fix.
5. \`node scripts/fix/gate.mjs\` in the worktree; read the output.
6. Commit on your branch: \`fix(<area>): <what> (${it.id})\`. Do not push and do not open the PR: the dispatcher does that.

## Return to the dispatcher
Branch, commit sha, gate result (delivery type and checks passed), the card path, and any file you had to touch outside the list.
`
}

export function renderPlan(cfg, plan, paths, batch) {
  const lines = [`# Fix batch ${batch}`, '', `Base: \`${cfg.base}\`. ${plan.items.length} bugs, ${plan.lanes.length} lanes, ${plan.waves.length} waves.`, '',
    'Dispatch one agent per bug of a wave at the same time (skill `dispatching-parallel-agents`), each with its brief as the whole prompt; start the next wave when the bugs it waits for are committed.', '',
    '| Wave | Bug | Lane | After | Branch | Brief |', '|---|---|---|---|---|---|']
  for (const it of [...plan.items].sort((a, b) => a.wave - b.wave || a.lane - b.lane)) {
    lines.push(`| ${it.wave} | ${it.id} | ${it.lane} | ${it.after ?? '-'} | \`${paths[it.id].branch}\` | \`${it.id}.brief.md\` |`)
  }
  const shared = plan.items.filter((it) => it.conflicts.length)
  if (shared.length) {
    lines.push('', '## Overlaps (sequenced)')
    for (const it of shared) for (const c of it.conflicts) if (it.id < c.with) lines.push(`- ${it.id} and ${c.with}: ${c.files.join(', ')}`)
  }
  return lines.join('\n') + '\n'
}

function main() {
  const { flags, values, positional } = parseArgs(process.argv.slice(2), ['--out', '--config'])
  if (!positional[0]) fail('usage: node scripts/fix/fix-batch.mjs <bugs.json> [--dry] [--no-fetch] [--out <dir>] [--config <path>]')
  let cfg
  try { cfg = loadConfig({ path: values['--config'] }) } catch (e) { fail(e.message) }
  let input
  try { input = JSON.parse(readFileSync(resolve(positional[0]), 'utf8')) } catch (e) { fail(`${positional[0]}: ${e.message}`) }
  const bugs = Array.isArray(input) ? input : input.bugs
  const batch = (Array.isArray(input) ? null : input.batch) || new Date().toISOString().slice(0, 10)
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(batch)) fail(`batch name "${batch}": letters, digits, . _ - only`)
  if (!Array.isArray(bugs) || !bugs.length) fail('no bugs in the input')

  let plan
  try { plan = planBatch(bugs) } catch (e) { fail(e.message) }
  const paths = {}
  for (const it of plan.items) {
    const bad = validateIdSlug(cfg, it.id, it.slug)
    if (bad) fail(`${it.id}: ${bad}`)
    paths[it.id] = fixPaths(cfg, it.id, it.slug)
    try { assertFree(cfg, paths[it.id]) } catch (e) { fail(`${it.id}: ${e.message}`, 1) }
  }
  const planText = renderPlan(cfg, plan, paths, batch)
  console.log(planText)
  if (flags.has('--dry')) { console.log('dry run: nothing created'); return }

  const out = resolve(cfg.root, values['--out'] ?? join(cfg.briefDir, batch))
  mkdirSync(out, { recursive: true })
  let fetched = flags.has('--no-fetch')
  for (const it of plan.items) {
    startFix(cfg, { id: it.id, slug: it.slug, title: it.title, fetch: !fetched })
    fetched = true
    const prev = it.after ? paths[it.after] : null
    writeFileSync(join(out, `${it.id}.brief.md`), renderBrief(cfg, it, paths[it.id], prev, plan.items.length))
    console.log(`created ${paths[it.id].branch}  ->  ${paths[it.id].wt}`)
  }
  writeFileSync(join(out, 'plan.md'), planText)
  writeFileSync(join(out, 'plan.json'), JSON.stringify({ batch, base: cfg.base, ...plan, paths }, null, 2) + '\n')
  console.log(`briefs and plan: ${out}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
