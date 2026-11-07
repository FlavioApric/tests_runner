# tests_runner: the runbook

You are a Claude Code session connected to this repo. This file tells you **everything** you need to test an app,
run the tests on the fleet and fix what fails, **without asking the owner** except for the few things listed in
"Ask the owner only for". Follow the steps in order. Every step says the command, where the detailed instructions
live, and what "done" means.

## What this repo is

| Branch | Holds | You read it at |
|---|---|---|
| `main` (here) | the fleet: coordinator `fleet.yml`, reusable `shard-core.yml`, CLI `cli/fleet.mjs`, MCP server, skills | always |
| `test-plan` | the pipeline that BUILDS an app's tests: `PIPELINE.md`, `qa-pack/`, skills `/qa*` | step 2 |
| `fix` | the protocol that FIXES what the tests find: `fix/PLAYBOOK.md`, `scripts/fix/*`, skills `/fix`, `/fix-ship`, `/qa-fix` | step 6 |

Read a branch without switching: `git fetch origin test-plan fix`, then `git show origin/test-plan:PIPELINE.md`.
Work on the app in **its own clone** (never inside this repo), and copy the pack/playbook into the app's test branch.

How the fleet works (you never manage tokens):
- your **only credential** is the gh CLI login on this PC (`gh auth status` → logged in as the owner);
- `node cli/fleet.mjs run` starts `fleet.yml` in the home repo; that workflow holds the **fleet GitHub App** key and does
  everything else by itself: finds the runner repos (every account that installed the App), pushes the runner stub,
  sets a 1-hour read-only source token and the test secrets, dispatches, retries infra failures once on another
  runner, and bundles the results **sealed** to this PC's public key;
- `node cli/fleet.mjs pull` (done by `run` automatically) decrypts them into `~/.qa-fleet/runs/<runId>/`.

## Step 0: check (2 minutes)

```bash
gh auth status                       # must show the home repo's owner
node cli/fleet.mjs runners           # runner repos, state, free jobs (runs the coordinator in status mode)
```
- `runners` fails with "FLEET_APP_ID / FLEET_APP_PRIVATE_KEY are not set" → first-time setup, see `docs/APP.md`
  (this one needs the owner: one click). Same for "no result public key" → `node cli/fleet.mjs keygen` (you do it).
- A runner in state `error` or missing: report it and continue with the others. Never stop for one runner.
- Done: at least one runner `ready`.

## Step 1: know the app

- The app = the private source repo the owner named (`owner/name`). Clone it next to this repo if it is not on disk.
- The **test branch** is the app branch that holds `.qa-fleet/units.json` (look for it: `git ls-remote --heads origin`,
  then `git show origin/<branch>:.qa-fleet/units.json`; the usual name is `qa/fleet`).
- Found and fresh (its base is the current default branch, or close) → go to step 3.
- Missing, or it misses areas of the app → step 2.

## Step 2: build the tests (branch `test-plan`, add-only)

Instructions: `git show origin/test-plan:PIPELINE.md` and `git show origin/test-plan:README.md`. In short:

1. In the app clone, create or update the test branch from the default branch (`git switch -c qa/fleet`).
2. Copy `qa-pack/` and `.claude/skills/qa*` from `test-plan`; fill `qa.config.json` from
   `qa-pack/templates/qa.config.json` (read the app to fill it: stack, ports, start command, personas, areas).
3. Install what the pipeline uses (once per PC, no question needed):
   ```bash
   node qa-pack/install-skills.mjs --project .
   claude plugin marketplace add https://github.com/Autodesk/claude-browser-test-skills.git
   claude plugin install browser-test@browser-test-skills
   pip install graphifyy==0.9.91          # optional: the graph step defers without it
   ```
   Maestro and the Android emulator are installed **on the runners** by the fleet units: do not install them here.
4. Run the stages in order, each one to green before the next:
   - **S1 graph**: `node qa-pack/scripts/inventory.mjs` (+ `graph.mjs` with graphify).
   - **S2 research all functions**: `research-brief.mjs`, then **one researcher subagent per area in parallel**
     (skill `dispatching-parallel-agents`), then `consolidate.mjs`.
   - **S3 author**: one case per journey with **`browser-test:author`** + `/qa-author`, authors in parallel per area.
   - **S4 refine**: **`browser-test:refiner`** + `/qa-refiner` on every case (the 7 oracles of `qa-pack/conventions.md`).
   - **S5 compile**: `browser-test:compiler` + `/qa-compiler` → Playwright specs; `coverage-link.mjs --check`.
   - **S6 plans**: Playwright (projects, shards), backend adapter, access matrix, **Maestro + emulator** plan when
     the app has a mobile build.
   - **S7 fleet units**: `node qa-pack/runners/pack.mjs fleet-units` → `.qa-fleet/units.json`, `unit.sh`, charters.
   `node qa-pack/runners/pack.mjs flow --project . --resume` runs what can run and lists the rest in `DEFERRED.md`.
5. Done: `pack.mjs validate --strict` green, `node <this repo>/cli/fleet.mjs validate --project .` ok,
   committed on the test branch.

Run locally only small slices (one spec, one flow) to prove a step. Full suites go to the fleet (step 3).

## Step 3: run everything on the fleet

```bash
git -C <app> push -u origin qa/fleet            # the runners test the PUSHED ref
node cli/fleet.mjs run --source <owner/app> --ref qa/fleet --project <app>
```
- One command does all of it: Playwright (web, sharded), backend and unit tests, **Maestro on the Android
  emulator** (units with `needs: android-emulator`), on every runner in parallel. It waits, pulls and decrypts.
- Smaller run: `--only <unit,unit>` or `--tags web|mobile|backend`. Plan without running: `node cli/fleet.mjs plan --project <app>`.
- In Claude Code you can use the MCP tools instead (`fleet_run` → `fleet_result`), see `.claude/skills/fleet/SKILL.md`.
- Done: `~/.qa-fleet/runs/<runId>/SUMMARY.md` exists. Exit 1 means some unit failed or broke: that is a result, not
  an error of yours.

## Step 4: local explorers

```bash
node cli/fleet.mjs explore --run <runId> --project <app>
```
One brief per charter (agent units never run on a runner). Dispatch them as **parallel subagents**
(`dispatching-parallel-agents`), each with the MCP servers its brief names. Take the `resource-governor` lock
(`emulator`, `stack`) before anything heavy on this PC. Done: every `explore/<unit>/report.md` starts with `FINDINGS: <n>`.

## Step 5: report

To the owner, short: pass / fail / infra counts, wall time, each failing unit with its first failing tests and the
folder with logs and screenshots, explorer findings. Then go straight on to step 6 for the failures: do not wait.

## Step 6: fix (branch `fix`)

Instructions: `git show origin/fix:fix/PLAYBOOK.md`. Copy `scripts/fix`, `fix/`, the skills `fix`, `fix-ship`,
`qa-fix` and `fix.config.json` into the app (once), fill the config from the app. Then, per failure:

0. **Receive**: one bug = one id, one branch, one worktree: `node scripts/fix/start.mjs <id> <slug>`.
   Many failures: `node scripts/fix/fix-batch.mjs` (one worktree each; bugs touching the same files go in one lane,
   in order) and one subagent per lane (`subagent-driven-development`, `git-worktree-isolation`).
1. **Classify**: app defect / test defect / spec decision / environment. Only app and test defects are fixed here;
   spec decisions and environment issues go into the report for the owner.
2. **Locate**: root cause written in the card before any change (`systematic-debugging`).
3. **Red**: the failing test at the lowest layer that shows the bug.
4. **Fix, minimal**: no unrelated changes.
5. **Prove**: `node scripts/fix/gate.mjs`, then rerun **only that unit** on the fleet:
   `node cli/fleet.mjs run --source <owner/app> --ref <fix-branch> --only <unit>`
   (`verification-before-completion`: paste the green output, do not claim from memory).
6. **Deliver**: commit `fix(<area>): <what> (<id>)`, push the fix branch, open the PR from `fix/templates/PR.md`,
   `node scripts/fix/ship.mjs <PR>`.
7. **Test ticket**: add the missing requirement/case/test to the test branch (`PLAYBOOK.md` step 8).

## Decide alone (never ask)

- which units to run, how to split, which runner; re-running a single unit to prove a fix;
- creating and pushing the app's **test branch** and **fix branches**, opening PRs on the app repo;
- installing the tools listed above; filling `qa.config.json` and `fix.config.json` from the code;
- the order of the fixes; running subagents in parallel (one worktree per writer);
- `node cli/fleet.mjs keygen` if no key exists yet; `allow <login>` when the owner said that account installed the App; `add-runner <owner>/tests_runner` when the owner hands over a runner token (it prompts for it: never put a token in a command or in chat);
  `node cli/fleet.mjs test-secrets` to upload `~/.qa-fleet/test-secrets.json` (test keys the units declare).

## Ask the owner only for

- **merging** into the app's default branch, releases, deploys, anything that writes **production** data;
- spending money or turning on paid features;
- a **spec or product decision** (the app does what the spec says, but the test says otherwise);
- the one-time App setup (`setup-app`, one click) and the App install on a new account (their click);
- test persona passwords when the app has no personas file yet (`/qa-run` asks once, never prints them);
- signing gate evidence that needs a person (design approval G4, device checklist G5);
- pushing to **this** repo's `main`.

## Hard rules

- **Never** retry, skip, loosen or mark-known a failing test to get green. A failure is a finding.
- Only infrastructure failures (exit **75**, setup or emulator broke, lost job) are retried, **once, on another
  runner**: the coordinator does it, not you.
- **No token anywhere**: never print, store, commit or paste one; never ask the owner for one. The gh login and the
  App are the only credentials. Claude never runs on a runner (no Claude credential in any secret or unit).
- Decrypted results stay in `~/.qa-fleet/runs/` on this PC: never commit or upload them.
- Public repos (this one, the runners) hold only `workflow_dispatch` workflows and no app source.
- Close what you start (local stacks, emulators, dev servers) when you are done.

## Parallel work on this PC

| Skill | For |
|---|---|
| `dispatching-parallel-agents` | researchers (S2), authors (S3), explorer briefs, independent fixes |
| `subagent-driven-development` | executing a plan task by task with fresh subagents and review |
| `agent-teams-orchestration` | interactive sessions only, needs `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| `git-worktree-isolation`, `using-git-worktrees` | one worktree per parallel writer |
| `resource-governor` | locks `stack`, `emulator`, `native-build`, `playwright-full` + free-RAM check |
| `systematic-debugging` | root cause before any fix |
| `verification-before-completion` | evidence before saying "done" |

## Develop this repo

`npm test` (no network: fake GitHub + fake App). Keep it generic: no app names, no personal paths, no real tokens in
tests. Pin every action by commit SHA. A change to `shard-core.yml` reaches every runner on the next run (the stub is
re-pinned to the new commit automatically). Pushing `main` needs the owner's OK.
