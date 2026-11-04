---
name: qa
description: Entry point of the qa-pack test-plan pipeline for any app that has a qa.config.json. Use when asked to run the tests, check the test status, see what is blocked or deferred, run one new module, fix a failing case, or "what is left before we can ship". Runs everything this machine can run and defers the rest.
---

# /qa

One runner: `node qa-pack/runners/pack.mjs <command> --project <dir>` (the dir holding `qa.config.json`; or set
`QA_PROJECT`). The pipeline is described in `PIPELINE.md`; every constant of the app is in `qa.config.json`.

## Arguments
- `/qa` or `/qa status`: `pack.mjs status`, then read `<paths.state>/FLOW_REPORT.md` and `DEFERRED.md` when they
  exist. Reply with: modules by status, what is blocked and by what, and the single next action.
- `/qa run` or `/qa resume`: FIRST ask with AskUserQuestion where to run (one question, header "Where"):
  1. **Local** (this machine): `pack.mjs flow` (or `flow --resume`). Steps whose capabilities are missing
     (`pack.mjs capabilities`) are written to `DEFERRED.md`, never passed.
  2. **Cloud fleet** (the `fleet` skill on the tests_runner main branch: the same units spread over public runner
     repos). Check the fleet card and the runner states with that skill first. The runners test the PUSHED branch:
     if local HEAD differs from `origin/<branch>`, ask the owner before any push. Run
     `pack.mjs flow --target cloud --dry` to show the plan, then without `--dry` in the background, and read
     `<paths.state>/CLOUD_REPORT.md` and `FLOW_REPORT.md` when it ends. A `deferred` step with `cloud-infra:` is a
     runner problem (already retried once), not a test result. Explorer reports are leads: reproduce a finding
     locally before calling it a defect.
  If the fleet is not set up, say what is missing and fall back to Local.
- `/qa run J03`: `pack.mjs flow --only <step ids>`; the verdict of `status` is always over all modules.
- `/qa deferred`: show `DEFERRED.md`; for each item say who can resolve it. Human-only items are asked once, at the end.
- `/qa new <feature>`: `/qa-new-module`. `/qa fix <id>`: `/qa-fix`. `/qa gate`: `/qa-gate`.

## Rules
- Local stacks only for writes. Production is never a test target.
- Add-only: never move or delete existing QA files. Never skip, disable, quarantine or retry a test to get green.
- A failing `@known-divergence` step is expected until the app or the decision changes; any other failure is a
  defect for `/qa-fix`.
- Never print, log or commit a credential value.
