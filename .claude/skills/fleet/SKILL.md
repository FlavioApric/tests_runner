---
name: fleet
description: Use when running an app's tests on the tests_runner fleet (many public GitHub runner repos in parallel), checking the fleet card or tokens, setting up runners or the coordinator, pulling and decrypting results, or briefing local Claude explorers. Covers the coordinator workflow, the local fallback and the honesty rules.
---

# Fleet

All commands run from the tests_runner checkout with `QA_FLEET_CARD=<card path>`. MCP equivalents in brackets.

## Check
- `node cli/fleet.mjs card check` [`fleet_card_check`]: missing fields, runner states, test branch.
- `node cli/fleet.mjs tokens` [`fleet_tokens`]: what each token can read, expiry.
- `node cli/fleet.mjs plan --project <checkout>` [`fleet_plan`]: which units go where, estimated wall time.

## Set up (ASK the owner before each real run: they push to public repos)
- `node cli/fleet.mjs bootstrap --dry`, then `bootstrap` [`fleet_bootstrap` with `confirm=true`].
- `node cli/fleet.mjs bootstrap --coordinator --dry`, then without `--dry`.

## Run
1. Push the test branch (the runners never see local changes).
2. Coordinator: `node cli/fleet.mjs run --via coordinator --source <name> --ref <branch>` [`fleet_coordinate`].
   The owner approves the `fleet` deployment on the printed link. The job masks every token, plans, dispatches,
   retries infra once elsewhere and uploads `fleet-bundle` (sealed archives + unit states).
3. When it completes: `node cli/fleet.mjs pull --gh-run <id> --project <checkout>` [`fleet_pull`]. Results:
   `~/.qa-fleet/runs/<runId>/` (`SUMMARY.md`, `units/<id>/qa-fleet-meta/unit.log`, JUnit, screenshots).
4. Fallback from this PC: `node cli/fleet.mjs run --project <checkout> --source <name> --ref <branch>`
   [`fleet_run` → `fleet_watch` → `fleet_collect`].

## Explorers (local only)
`node cli/fleet.mjs explore --run <runId> --project <checkout>` [`fleet_explore`] → `explore/<unit>.brief.md`.
Dispatch one subagent per brief (skill `dispatching-parallel-agents`); take `resource-governor` locks for the
emulator and the stack. Each writes `explore/<unit>/report.md` starting with `FINDINGS: <n>`.

## Read results honestly
- `fail` = the tests found something. Report it; never rerun or skip it to get green.
- `infra` = exit 75 / setup / emulator / lost job; already retried once on another runner. Twice infra is a finding
  about the test setup: read the decrypted `unit.log`.
- The public coordinator log shows only unit ids and states; details exist only after `pull`.

## Never
- print the card or a token; put the card in a repo or a synced folder;
- put Claude credentials anywhere on GitHub;
- cancel other people's runs or change runner repos except through `bootstrap`.
