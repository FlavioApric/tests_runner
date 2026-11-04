// Starts a fix: branch <branchPrefix><id>-<slug> from <remote>/<baseBranch> in its own worktree beside the repo, with the bug card.
//   node scripts/fix/start.mjs <id> <slug> [--title "<text>"] [--dry] [--no-fetch] [--config <path>]
// Example: node scripts/fix/start.mjs BUG-F20260101-1 feed-date-filter
import { fail, fixPaths, loadConfig, parseArgs, startFix, validateIdSlug, assertFree } from './lib.mjs'

const { flags, values, positional } = parseArgs(process.argv.slice(2), ['--title', '--config'])
const [id, slug] = positional
if (!id || !slug) fail('usage: node scripts/fix/start.mjs <id> <slug> [--title "<text>"] [--dry] [--no-fetch] [--config <path>]')

let cfg
try { cfg = loadConfig({ path: values['--config'] }) } catch (e) { fail(e.message) }
const bad = validateIdSlug(cfg, id, slug)
if (bad) fail(bad)

const p = fixPaths(cfg, id, slug)
console.log(`branch:   ${p.branch}\nbase:     ${cfg.base}\nworktree: ${p.wt}\ncard:     ${p.cardRel}`)
if (flags.has('--dry')) {
  try { assertFree(cfg, p) } catch (e) { fail(e.message, 1) }
  console.log('dry run: nothing created')
  process.exit(0)
}
try { startFix(cfg, { id, slug, title: values['--title'], fetch: !flags.has('--no-fetch') }) } catch (e) { fail(e.message, 1) }
console.log(`
Next (fix/PLAYBOOK.md):
  cd ${p.wt}
  1 classify and fill the card   2 locate; write the cause   3 red test
  4 minimal fix                  5 node scripts/fix/gate.mjs  6 commit, PR, node scripts/fix/ship.mjs <PR>`)
