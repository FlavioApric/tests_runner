# tests_runner: how Claude coordinates everything

This repo is a **generic** test fleet: it runs any private app's tests on many free public GitHub runner repos at once
(yours + colleagues'), brings the results back **encrypted**, and holds the playbooks to build the tests and fix what
fails. Nothing here belongs to one app: app-specific cases, data and requirements stay in the app's private repo.

| Branch | What it holds | Use it when |
|---|---|---|
| `main` (here) | the fleet tool, the runner workflow `shard.yml`, the coordinator workflow `coordinate.yml`, the card template, parallel-work skills | running tests, setting up runners |
| `test-plan` | `PIPELINE.md`: code graph → function research → browser-test author → refiner → compile → Playwright / Maestro / emulator plans → fleet units | the app has no test branch yet, or it needs more coverage |
| `fix` | the generic fix playbook: one bug = one worktree + branch, gates, delivery | the owner asks to fix the failures |

## The loop

1. **Card.** The owner gives you the fleet card (`~/.qa-fleet/QA-FLEET-CARD.md`, never in a repo). Set
   `QA_FLEET_CARD` to its path. Run `node cli/fleet.mjs card check` and `node cli/fleet.mjs tokens`. Anything
   missing in part A goes back to the owner.
2. **Test branch.** `node cli/fleet.mjs branch`.
   - `ready` → step 3.
   - missing or without `.qa-fleet/` → `git fetch origin test-plan` and follow `PIPELINE.md` there (in the
     owner's clone of the app, add-only, **ask** before the first push).
3. **Push.** The runners test the pushed ref only. Commit and push the test branch first (owner's OK for pushes).
4. **Run** (skill `fleet`):
   - coordinator: `node cli/fleet.mjs run --via coordinator --source <name> --ref <branch>`, tell the owner to approve
     the `fleet` deployment, then `node cli/fleet.mjs pull --gh-run <id> --project <checkout>`;
   - fallback from this PC: `node cli/fleet.mjs run --project <checkout> --source <name> --ref <branch>`.
5. **Local explorers.** `node cli/fleet.mjs explore --run <runId> --project <checkout>` → one brief per agent unit.
   Dispatch them as parallel subagents (skill `dispatching-parallel-agents`), each with its own MCP servers. Take the
   `resource-governor` lock `emulator` / `stack` before anything heavy on this PC.
6. **Report** pass / fail / infra, wall time, failing units with their first failing tests, explorer findings, and
   the local results folder.
7. **Fix**, only when the owner asks: `git fetch origin fix` and follow `fix/PLAYBOOK.md` (many bugs in parallel:
   one worktree each, overlap check first; skills `subagent-driven-development`, `git-worktree-isolation`,
   `systematic-debugging`, `verification-before-completion`).

## Hard rules

- **Never** retry, skip, loosen or mark-known a failing test to get green. A failure is a finding.
- Only infrastructure failures (exit **75**, setup or emulator broke, lost job) are retried, **once, on another
  runner**. The tool does it; do not do it by hand.
- **Tokens never in argv, logs, commits, issues or chat.** The tool passes them through env and stdin and redacts
  them. Never print the card.
- **Claude never runs on a runner.** No Claude credential goes into the card, a runner secret or `units.json`
  (they are rejected). Agent units run only here, on the owner's PC.
- Public repos get **only** `workflow_dispatch` workflows, no secrets in files, no app source.
- Results are decrypted only on the owner's PC (`~/.qa-fleet/runs/`). Never commit them.
- Pushing to any public runner repo or to tests_runner needs the owner's OK every time (`bootstrap` and
  `bootstrap --coordinator` say **ASK** in the card).
- Production is the owner's: never deploy, migrate or write production data.

## Parallel work on this PC

| Skill | For |
|---|---|
| `dispatching-parallel-agents` | 2+ independent investigations or explorer briefs at once |
| `subagent-driven-development` | executing a plan task by task with fresh subagents and review |
| `agent-teams-orchestration` | interactive sessions only, needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; does not work with `claude -p` |
| `git-worktree-isolation`, `using-git-worktrees` | one worktree per parallel writer (never two writers on the same files) |
| `resource-governor` | locks `stack`, `emulator`, `native-build`, `playwright-full` and a free-RAM check before heavy local jobs |
| `systematic-debugging` | root cause before any fix |
| `verification-before-completion` | evidence (command output) before saying "done" |

Heavy suites belong on the fleet, not on this PC: run locally only the small slice that proves a change.

## Develop the tool

`npm test` (no network: fake GitHub API). Keep it generic: no app names, no personal paths, no tokens in tests
(use obvious fakes). Pin every action by commit SHA. After a change: commit, owner's OK, push `main`, then
`fleet bootstrap` updates the colleagues' runners.
