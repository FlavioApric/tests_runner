# tests_runner

Run the tests of **any** private project on **many free public GitHub runner repos** in parallel: your own
`tests_runner` plus one runner repo per colleague. Results come back **encrypted**: the public repos only ever see a
public key. Claude Code coordinates it from your PC ([`CLAUDE.md`](CLAUDE.md)); Claude itself never runs on a runner.

| Branch | Holds |
|---|---|
| `main` | the fleet tool (CLI + MCP), runner workflow `shard.yml`, coordinator workflow `coordinate.yml`, card template, parallel-work skills |
| `test-plan` | the generic pipeline to build a test suite: code graph → function research → browser-test author → refiner → Playwright / Maestro / emulator plans → fleet units |
| `fix` | the generic fix playbook: one bug = one worktree + branch, gates, delivery, many bugs in parallel |

```
your PC (Claude Code + card) ──┬─ run --via coordinator ─► tests_runner/coordinate.yml  (Environment "fleet", you approve)
                               │                              opens the sealed card in memory, masks every token,
                               │                              plans → dispatches → watches → bundles sealed archives
                               └─ run (local fallback) ───────┐
                                                              ▼
                        runner repos (public, workflow_dispatch only) × N   ← tests_runner is one of them
                          shard.yml: validate → matrix of units → checkout private source (read-only PAT)
                                     → run unit → seal results to your public key → artifact
your PC ◄── pull --gh-run <id> / collect: download + decrypt → SUMMARY.md, JUnit merge, timings.json
        └── explore --run <id>: briefs for local Claude explorer subagents
```

Why several owners: on the Free plan the limit is **20 concurrent jobs per account**, and public repos have free
unlimited minutes on standard runners (4 vCPU, 16 GB, KVM for Android emulators). GitHub allows one free personal
account per person, so 5 colleagues = 5 accounts ≈ 100 parallel jobs. macOS runners: 5 concurrent per account.

## What belongs to the project

The runner repos contain no app logic. A project joins the fleet by committing a `.qa-fleet/` folder on its test branch:

| File | Required | What |
|---|---|---|
| `.qa-fleet/units.json` | yes | the list of independent units (schema `schema/units.schema.json`) |
| `.qa-fleet/unit.sh` | no | hook `setup <unit>` (install, build, start services; the emulator boots meanwhile), `ready <unit>` (device booted: install the app) and `run <unit>`; without it `cmd` runs as is |
| `.qa-fleet/charters/*.md` | for agent units | what a local Claude explorer must explore |
| `.qa-fleet/timings.json` | written by the fleet | measured minutes per unit, used by the next plan |

A unit:

```json
{ "id": "web-3-of-10", "cmd": "npx playwright test --shard=3/10", "estMinutes": 6, "timeoutMinutes": 40,
  "needs": ["node:22", "browsers:chromium,webkit"], "secrets": ["STRIPE_TEST_KEY"],
  "results": ["qa-fleet-results", "test-results"], "env": { "CI": "1" }, "tags": ["web"] }
```

- `needs` (the runner prepares them): `node:N`, `pnpm:N`, `python:X`, `java:N`, `go:X`, `docker`, `kvm`, `free-disk`,
  `android-emulator[:api]` (boots a headless emulator in parallel with setup), `browsers[:list]`,
  `services:postgres,redis,mysql`.
- `secrets`: names of secrets of the runner repo. A unit sees **only** the ones it declares. Claude credentials are
  rejected.
- `results`: paths copied into the sealed archive. Any JUnit XML inside is summarised.
- `agent` instead of `cmd`: `{ "charter": ".qa-fleet/charters/x.md", "mcp": ["mobile","playwright"] }`. Agent units
  are **never dispatched**: after a run, `fleet explore --run <id>` writes one brief per charter for a local Claude
  subagent that works on the decrypted results with your own login.
- Exit code **75** from setup or cmd means "the environment broke, not the tests": the unit is retried **once on another
  runner**. Every other non-zero exit is a test failure and is **never** retried.

Scaffold: `fleet init --kind playwright|vitest|jest|pytest|go|maestro|gradle|shell --shards N`.
`examples/py-js` is a minimal mixed project (pytest + node:test) that runs on the same fleet unchanged.

## Security model

- Only `workflow_dispatch` triggers the workflows. Inputs are validated by regex and passed through `env`, never
  inlined; the source repo must be in `vars.ALLOWED_SOURCES`.
- The **commands come from the private source at the requested ref**, never from dispatch inputs.
- `SOURCE_REPO_TOKEN` is a fine-grained PAT with **read-only Contents** on the source repo; checkouts use
  `persist-credentials: false`.
- Everything a unit prints goes to `unit.log` inside the sealed archive. The public log shows only phases and exit
  codes.
- Results are sealed with X25519 + HKDF-SHA256 + AES-256-GCM (Node built-ins) to `vars.FLEET_RECIPIENT`. The private
  key stays in the card on your PC. Artifacts expire after 3 days.
- The **coordinator** runs only in the Environment `fleet` (you as required reviewer, `main` only). Its card is stored
  sealed (`FLEET_CARD_SEALED`) with a separate key (`FLEET_CARD_KEY`); it holds runner tokens and sources only, never
  test secrets or the result key. Every token is masked. The coordinator never decrypts results: its bundle holds only
  sealed archives and public unit states.
- No tool, log or MCP answer ever returns a token. All actions are pinned to commit SHAs.

Token permissions: [`docs/PERMISSIONS.md`](docs/PERMISSIONS.md).

## Set up with a fleet card

One markdown file holds the whole fleet (runners and tokens, source and read token, test secrets, result key, the
instructions for Claude). Template: [`card/QA-FLEET-CARD.md`](card/QA-FLEET-CARD.md).

1. `node cli/fleet.mjs card new` → empty card in `~/.qa-fleet/QA-FLEET-CARD.md` (outside repos and synced folders).
2. Each colleague creates an empty public repo (default name `tests_runner`) and a fine-grained token on that repo
   only ([permissions](docs/PERMISSIONS.md)), and sends you the repo name and token privately.
3. `node cli/fleet.mjs card check` and `node cli/fleet.mjs tokens` → what is missing, token reach and expiry.
4. `node cli/fleet.mjs bootstrap --dry`, then `bootstrap`: pushes this code to every colleague's runner (not to your
   own `tests_runner`: push `main` yourself), turns Actions on, sets the variables and secrets, writes the result key
   into the card.
5. Coordinator (optional): `node cli/fleet.mjs bootstrap --coordinator --dry`, then without `--dry`: creates the
   Environment `fleet`, uploads the sealed card and its key, sets `FLEET_COORDINATOR=true`.

Every command reads the card from `--card`, `QA_FLEET_CARD` or `~/.qa-fleet/QA-FLEET-CARD.md`.

## Use

```bash
node cli/fleet.mjs plan --project ../my-app
node cli/fleet.mjs run --via coordinator --source app --ref my-tests [--only a,b] [--tags web]
node cli/fleet.mjs pull --gh-run <id> --project ../my-app
node cli/fleet.mjs run --project ../my-app --source app --ref my-tests      # local fallback
node cli/fleet.mjs watch|collect|summary|cancel --run <runId>
node cli/fleet.mjs explore --run <runId> --project ../my-app
```

The runners test the **pushed** ref: push your branch first. Results land in `~/.qa-fleet/runs/<runId>/`
(`SUMMARY.md`, `units/<id>/` with `qa-fleet-meta/unit.log`, `result.json` and the declared results).

MCP: `claude mcp add --scope user qa-fleet -e QA_FLEET_CARD=<card> -- node <dir>/mcp/index.mjs`. Tools:
`fleet_status`, `fleet_plan`, `fleet_run`, `fleet_watch`, `fleet_collect`, `fleet_cancel`, `fleet_runs`,
`fleet_card_check`, `fleet_bootstrap` (real run only with `confirm=true`), `fleet_coordinate`, `fleet_pull`,
`fleet_explore`, `fleet_tokens`.

## Develop

`npm test` runs the unit tests and end-to-end cycles against a fake GitHub API (dispatch, decrypt, infra retry,
coordinator, MCP protocol). No network needed. Third-party skills: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
