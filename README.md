# tests_runner: `fix` branch

A generic, config-driven bug-fix playbook for Claude Code sessions: from a bug report to a verified fix and an owner-approved delivery. Nothing here is tied to one app: every project value lives in [`fix.config.json`](fix.config.json).

Other branches of this repository: `main` (fleet coordinator) and `test-plan` (generic test pipeline, the usual `testsBranch` target for the test tickets).

## What is here
| Path | What it is |
|---|---|
| [`fix/`](fix/README.md) | the playbook: [`PLAYBOOK.md`](fix/PLAYBOOK.md), [`CONFIG.md`](fix/CONFIG.md), [`DELIVERY.md`](fix/DELIVERY.md), [`FEATURES.md`](fix/FEATURES.md), [`SKILLS.md`](fix/SKILLS.md), the card and PR templates, the log |
| [`fix.config.json`](fix.config.json) | working example config; [`fix/examples/`](fix/examples/) has a fuller one |
| `scripts/fix/start.mjs` | branch + worktree + bug card for one bug |
| `scripts/fix/gate.mjs` | delivery type of the changed files and the checks they need (`deliveryRules`, `checks`) |
| `scripts/fix/ship.mjs` | pre-delivery checks of a PR or the local branch, and the owner action |
| `scripts/fix/fix-batch.mjs` | many bugs: one worktree each, file-overlap lanes, one brief per sub-agent |
| `scripts/fix/lib.mjs` | config loading and the shared rules engine |
| `.claude/skills/` | `/fix`, `/fix-ship`, `/qa-fix` |
| [`fix/runner-templates/`](fix/runner-templates/README.md) | GitHub Actions: read-only verify, approval-gated deploy adapters |
| `tests/` | `node:test` suite against a throwaway git repo |

## Quick start in a project
```
cp -r <this branch>/scripts/fix scripts/
cp -r <this branch>/fix fix
cp -r <this branch>/.claude/skills/fix <this branch>/.claude/skills/fix-ship <this branch>/.claude/skills/qa-fix .claude/skills/
cp <this branch>/fix.config.json .
node scripts/fix/gate.mjs --files src/a.ts,android/app/build.gradle --list
```
Then edit `fix.config.json` until `gate.mjs --files ... --json` classifies your paths the way you deliver them.

## Requirements
Node 20 or newer and git; `gh` for `ship.mjs <PR>`. No npm dependencies.

## Tests
```
npm test
```
