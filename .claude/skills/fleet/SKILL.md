---
name: fleet
description: Use when running an app's tests on the tests_runner fleet (many public GitHub runner repos in parallel, driven by one GitHub App), listing runners, pulling and decrypting results, or briefing local Claude explorers. The full runbook (build tests → run → fix) is CLAUDE.md of the tests_runner repo.
---

# Fleet

The only credential is the gh CLI login (`gh auth status`). Commands run from the tests_runner checkout; MCP tools in brackets.
The whole protocol, including building the tests (branch `test-plan`) and fixing (branch `fix`), is `CLAUDE.md`.

## Check
- `node cli/fleet.mjs runners` [`fleet_runners`]: runner repos the App reaches, state, free jobs.
- `node cli/fleet.mjs plan --project <app>` [`fleet_plan`]: which units go where, estimated wall time (offline).
- `node cli/fleet.mjs validate --project <app>`: the app's `.qa-fleet/units.json`.

## Run
1. Push the test branch (the runners never see local changes).
2. `node cli/fleet.mjs run --source <owner/app> --ref <branch> --project <app> [--only a,b] [--tags t]`
   [`fleet_run` → poll `fleet_result`]. It starts `fleet.yml`, waits, pulls and decrypts.
3. Results: `~/.qa-fleet/runs/<runId>/SUMMARY.md`, `units/<id>/qa-fleet-meta/unit.log`, JUnit, screenshots.
4. Re-pull a finished run: `node cli/fleet.mjs pull --gh-run <id>` [`fleet_pull`]. Cancel: `cancel --gh-run <id>`.

## Explorers (local only)
`node cli/fleet.mjs explore --run <runId> --project <app>` [`fleet_explore`] → `explore/<unit>.brief.md`.
One subagent per brief (`dispatching-parallel-agents`); `resource-governor` locks for the emulator and the stack.

## Read results honestly
- `fail` = the tests found something. Report it; never rerun or skip it to get green.
- `infra` = exit 75 / setup / emulator / lost job; already retried once on another runner. Twice infra is a finding
  about the test setup: read the decrypted `unit.log`.
- The public coordinator log shows only unit ids and states; details exist only after the pull.

## Never
- ask for, print or store a token; the App and the gh login are the only credentials;
- put Claude credentials or live keys in the `fleet` environment;
- push this repo's `main` without the owner's OK.
