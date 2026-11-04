# The test-plan pipeline

From an app's code and spec to a test plan that runs locally or on the cloud fleet. Generic: every app constant
(paths, ports, personas, id patterns, areas, adapters) lives in the project's `qa.config.json`
(schema `qa-pack/schema/qa.config.schema.json`, starter `qa-pack/templates/qa.config.json`). Every script takes
`--project <dir>` (or `QA_PROJECT`, default the current directory) and runs with cwd = that dir.

Exit codes everywhere: `0` green, `1` red, `2` usage or config error, `3` deferred (a capability is missing on this
machine: the step did NOT pass, it is listed in `DEFERRED.md`).

```
S1 graph      inventory.mjs (JS/TS + Python) [+ graph.mjs: graphify, optional]
S2 research   research-brief.mjs -> one researcher subagent per area (BRIEF.md) -> consolidate.mjs
              -> requirements.json + TEST_REQUIREMENTS.md
S3 author     cases in markdown (/qa-author, from browser-test:author) -> validate-cases.mjs
S4 refine     the 7 correctness oracles on every Verify (/qa-refiner)
S5 compile    Playwright specs with requirement ids in the titles + expectDesign() (/qa-compiler)
              -> coverage-link.mjs
S6 plans      browser (projects, --shard, merge-reports), backend adapter, access matrix (router adapter),
              mobile (Maestro series, emulator recipe, GitHub workflow template) -> plans.mjs
S7 fleet      fleet-units.mjs -> .qa-fleet/units.json (+ unit.sh, explorer charters), valid against the fleet schema
Gates         G0-G6 core, G5 mobile, G7-G9 store/legal (optional profiles)
```

## S1 Graph

- `node qa-pack/scripts/inventory.mjs` walks `app.src` (minus `app.exclude`) and writes `paths.inventory`
  (JSON: files, exports, routes, components, Python defs) and `paths.inventoryMd`.
- Optional: `pip install graphifyy==0.9.91`, then `node qa-pack/scripts/graph.mjs` (graphify by reference, never
  vendored). Missing graphify defers the step; the flow goes on.

## S2 Research

- `node qa-pack/scripts/research-brief.mjs` renders `qa-pack/research/BRIEF.md` once per area of `areas` into
  `paths.briefs/R?.md`.
- One researcher subagent per area, in parallel. Each reads its brief, the spec sections and the code, and writes
  `paths.research/R?-<slug>.md`: one table row per requirement with an id (`ids.requirement`), the requirement text
  with exact values, the source, the code location, a verdict (IMPLEMENTED, PARTIAL, MISSING, DIVERGENT,
  NOT-TESTABLE-LOCALLY), the coverage layers, scenarios, journey (`J01` or `NEW:<name>`) and priority.
- `node qa-pack/scripts/consolidate.mjs` merges the area files into `paths.requirements` (schema
  `qa-pack/requirements@1`) and `paths.testRequirements`; `NEW:<name>` journeys get stable ids kept in
  `<paths.research>/journeys.json`. `--check` fails when the outputs are stale.

## S3 Author, S4 Refine

- `pack.mjs new-module <slug> --name ... --area R1` creates a module from `qa-pack/templates/module/`.
- Cases follow `qa-pack/conventions.md` (the 7 oracles, Setup 0, design contract keys, `@known-divergence`,
  `@owner-decision`, version from env). `pack.mjs validate --strict` checks sections, step numbering, requirement ids,
  Verify and Oracle lines, contract references, no `TODO(qa-pack)`, every requirement in a module.
- Design contracts: `<paths.contracts>/<screen>.json` plus `tokens.json` (`{light, dark}`), checked by
  `validate-contract.mjs`.

## S5 Compile

- Specs in `paths.compiled` import `qa-pack/lib/designContract.mjs` (`expectDesign`) and the project's auth setup.
  The Playwright config is `qa-pack/lib/playwright-config.mjs` (`packConfig(projectDir)`): projects from
  `playwright.projects`, the webServer from `preview`, blob reports when `QA_BLOB=1` or `CI`.
- `node qa-pack/scripts/coverage-link.mjs` maps requirement ids in test titles (compiled + backend tests) to
  `paths.coverage`; `--check` fails on any uncovered requirement that is not NOT-TESTABLE-LOCALLY.

## S6 Plans

- Browser: `npx playwright test -c <config>`, reliability `--repeat-each=3 --retries=0`, shards
  `--shard=i/N` + `npx playwright merge-reports`.
- Backend: `qa-pack/runners/backend.mjs` with `backend.adapter` = `node-test` | `supabase` (optional: migrations
  twice, SQL through psql in the DB container, edge functions with node --test) | `none`.
- Access: `qa-pack/scripts/access-matrix.mjs` with `router.adapter` = `express` | `react-router` | `json`:
  route x persona cells, replayed by a compiled spec.
- Mobile (when `mobile.enabled`): `qa-pack/scripts/maestro-run.mjs` (resumable series, N green in a row on the same
  APK + flows fingerprint), the emulator recipe and the GitHub Actions template (android-emulator-runner pinned by
  SHA), both rendered into `paths.plans`.
- `node qa-pack/scripts/plans.mjs` writes `paths.plans/*.md`; `--check` fails when stale.

## S7 Fleet

`node qa-pack/runners/pack.mjs fleet-units` turns every flow step with a `fleet.kind` (`static`, `stack`, `mobile`)
into a unit of `<paths.fleet>/units.json` (schema `qa-fleet/units@1`, vendored in `qa-pack/schema/`), shards the
browser step into `playwright.shards` units, adds one local Claude explorer unit per area when `fleet.explore`, and
writes `unit.sh` (setup / ready / run) and the charters. With `QA_FLEET_DIR` pointing at a fleet checkout it is
also checked by the fleet's own `validateUnits()`.

`pack.mjs flow --target cloud` runs those units on the fleet (see the `fleet` skill on main), folds the results into
the same state file and runs the remaining steps (gates) locally.

## The flow

`qa-pack/pack.json` lists the steps (with `requires` capabilities, `when` switches and fleet kinds); the project adds
its own with `flow.extra` and removes some with `flow.skip`.

```bash
node qa-pack/runners/pack.mjs flow --project <dir> --dry      # plan only
node qa-pack/runners/pack.mjs flow --project <dir>            # run what can run, defer the rest
node qa-pack/runners/pack.mjs flow --project <dir> --resume   # skip steps already done
node qa-pack/runners/pack.mjs gate --project <dir>            # G0..G6 (+ profiles)
```

Outputs in `paths.state` (default `.qa-pack/`, gitignored): `state.json`, `FLOW_REPORT.md`, `DEFERRED.md`,
`CLOUD_REPORT.md`.

## Gates

`qa-pack/gates/gates.json`. A gate is green when its flow steps are done and its evidence files (templates in
`qa-pack/evidence/`, copies in `paths.gateEvidence`) carry `Signed: <who> <yyyy-mm-dd>` and no TODO/UNSIGNED.

| Gate | Profile | Needs |
|---|---|---|
| G0 | core | inventory, requirements, strict validation, coverage |
| G1 | core | 0 open decisions in `decisions.md` |
| G2 | core | every static fleet step |
| G3 | core | backend adapter green (n/a with `none`) |
| G4 | core | access matrix + browser suite green, `design-approved.md` signed |
| G6 | core | reliability repeat green |
| G5 | mobile | Maestro series green, `maestro-series.md` and `device-checklist.md` signed |
| G7-G9 | store | production backend aligned, legal data and store forms, published proof |

## Example

`examples/tiny-app/` is a tiny notes app (Node API + one HTML page + a Python report tool) taken through S1-S7.
Its compiled Playwright specs pass locally:

```bash
npm ci && npx playwright install chromium
npx playwright test -c examples/tiny-app/playwright.config.mjs
```

`npm run example:flow` runs the whole flow on it (s6-mobile is n/a there: the example has no mobile app).
Gate G4 stays open on purpose: `qa/evidence/gates/design-approved.md` is a human sign-off, never generated.
While the specs were compiled they found a real defect in the example: at 390 px the sign-in form overflowed
(inputs without `min-width: 0`), mobile Chrome zoomed out and a tap missed the button. The page was fixed and
R3-002 now also asserts there is no horizontal overflow, so the touch-size oracle measures an unzoomed layout.
