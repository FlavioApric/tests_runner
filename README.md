# tests_runner

Run the tests of **any** private project on **many free public GitHub runner repos** in parallel, with **one
credential**: a GitHub App owned by this repo's owner. A Claude Code session needs nothing but `gh auth login`.
Results come back **sealed** to a key that exists only on the owner's PC. The full protocol for a session
(build the tests → run them → fix the failures) is [`CLAUDE.md`](CLAUDE.md).

| Branch | Holds |
|---|---|
| `main` | the fleet: coordinator `fleet.yml`, reusable `shard-core.yml`, runner stub template, CLI + MCP, skills |
| `test-plan` | the generic pipeline that builds a test suite: code graph → research → browser-test author → refiner → Playwright / Maestro / emulator plans → fleet units |
| `fix` | the generic fix playbook: one bug = one worktree + branch, gates, delivery, many bugs in parallel |

```
PC (gh login) ── node cli/fleet.mjs run ──► home repo: fleet.yml  (environment "fleet": the App key, main only)
                                               1. App installations → runner repos (allowed accounts only)
                                               2. push the runner stub (pinned to this commit) if it changed
                                               3. 1-hour read-only source token + declared test secrets → runner secrets
                                               4. plan → dispatch → watch → retry infra once elsewhere
                                               5. artifact fleet-bundle: sealed results + public unit states
                                                   │
           runner repos (any account that installed the App; this repo too)
             shard.yml stub ─► uses: <home>/.github/workflows/shard-core.yml@<sha>
               validate → matrix of units → checkout the private source → run → seal to the owner's key
                                                   │
PC ◄── pull (automatic after run): gh run download + decrypt → ~/.qa-fleet/runs/<runId>/SUMMARY.md, JUnit, logs
```

Why several accounts: on the Free plan the limit is **20 concurrent jobs per account**, and public repos have free
unlimited minutes on standard runners (4 vCPU, 16 GB, KVM for Android emulators).

## Set up (once)

1. `gh auth login` as the owner of this repo; clone it.
2. `node cli/fleet.mjs setup-app` → the browser opens → **Create GitHub App**. The App key goes straight into the
   environment `fleet` of this repo; nothing is shown or saved elsewhere.
3. Open the printed install link: install on **this repo** and on the **app repos** you want to test.
4. `node cli/fleet.mjs keygen` → result key pair (private key in `~/.qa-fleet/identity.key`).
5. More runners, two doors ([`docs/APP.md`](docs/APP.md)): the lending account creates an empty public repo `tests_runner`, then
   either opens the install link and installs on that repo only (you run `node cli/fleet.mjs allow <their-login>`), or hands
   you one fine-grained token for that repo (you run `node cli/fleet.mjs add-runner <owner>/tests_runner`).
6. Test keys the units need (test keys only): write `~/.qa-fleet/test-secrets.json` as `{"STRIPE_TEST_KEY":"sk_test_..."}`, then `node cli/fleet.mjs test-secrets`.

`node cli/fleet.mjs runners` shows what the fleet sees.

## What belongs to the project

A project joins by committing a `.qa-fleet/` folder on its test branch (the `test-plan` branch generates it):

| File | Required | What |
|---|---|---|
| `.qa-fleet/units.json` | yes | independent units (schema `schema/units.schema.json`) |
| `.qa-fleet/unit.sh` | no | hooks `setup <unit>` / `ready <unit>` (emulator booted) / `run <unit>` |
| `.qa-fleet/charters/*.md` | for agent units | what a local Claude explorer must explore |
| `.qa-fleet/timings.json` | written by the fleet | measured minutes per unit, used by the next plan |

```json
{ "id": "web-3-of-10", "cmd": "npx playwright test --shard=3/10", "estMinutes": 6, "timeoutMinutes": 40,
  "needs": ["node:22", "browsers:chromium,webkit"], "secrets": ["STRIPE_TEST_KEY"],
  "results": ["qa-fleet-results", "test-results"], "env": { "CI": "1" }, "tags": ["web"] }
```

- `needs`: `node:N`, `pnpm:N`, `python:X`, `java:N`, `go:X`, `docker`, `kvm`, `free-disk`, `android-emulator[:api]`,
  `browsers[:list]`, `services:postgres,redis,mysql`.
- `secrets`: names from the `fleet` environment; a unit sees only the ones it declares. Claude credentials are rejected.
- `agent` instead of `cmd`: a local explorer; never dispatched (`fleet explore` writes its brief).
- Exit **75** = the environment broke: retried once on another runner. Any other failure is never retried.

## Use

```bash
node cli/fleet.mjs run --source owner/app --ref qa/fleet --project ../app [--only a,b] [--tags web]
node cli/fleet.mjs pull --gh-run <id>                 # again, later
node cli/fleet.mjs explore --run <runId> --project ../app
node cli/fleet.mjs plan --project ../app              # offline
```

MCP: `claude mcp add --scope user tests-runner -- node <dir>/mcp/index.mjs`. Tools: `fleet_runners`, `fleet_plan`,
`fleet_run`, `fleet_result`, `fleet_pull`, `fleet_explore`, `fleet_runs`.

## Security model

- Only `workflow_dispatch` starts any workflow. Inputs are validated by regex and passed through `env`.
- The App key is an environment secret usable only by `fleet.yml` on `main`. Installation tokens last 1 hour and are
  narrowed to one repository; the source token to `contents: read`.
- Installations on accounts outside the owner + `FLEET_ACCOUNTS` are ignored.
- The unit commands come from the private source at the requested ref, never from inputs.
- Everything a unit prints goes into its sealed archive (X25519 + HKDF-SHA256 + AES-256-GCM); public logs show only
  phases and exit codes. The coordinator cannot decrypt anything. Artifacts expire after 3 days.
- Per-run secrets are deleted from the runners when the run ends. All actions are pinned by commit SHA.

## Develop

`npm test`: unit tests plus end-to-end cycles against a fake GitHub and a fake App (no network).
Third-party skills: [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
