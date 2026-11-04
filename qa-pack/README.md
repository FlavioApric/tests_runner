# qa-pack

| Dir | What |
|---|---|
| `runners/pack.mjs` | the one runner: status, validate, new-module, capabilities, flow, run, decisions, gate, fleet-units, plans |
| `runners/backend.mjs` | backend layers through `adapters/backend/<adapter>.mjs` |
| `runners/cloud.mjs` | `flow --target cloud` on the fleet (QA_FLEET_DIR = a checkout of this repo's main branch) |
| `scripts/` | inventory, graph, research-brief, consolidate, validate-cases, validate-contract, coverage-link, access-matrix, plans, fleet-units, maestro-run |
| `lib/` | config loader and schema validation, flow and capabilities, design contract (`expectDesign`), personas, Playwright config |
| `adapters/` | `backend/` (node-test, supabase) and `router/` (express, react-router, json) |
| `schema/` | qa.config, units (vendored fleet contract) |
| `templates/` | starter qa.config.json, module, decisions, fleet unit.sh and charter, mobile emulator recipe, GitHub workflow |
| `gates/gates.json`, `evidence/` | gates and the evidence templates the owner signs |
| `research/BRIEF.md` | the brief each researcher subagent gets |
| `pack.json` | the generic flow |
| `conventions.md` | case format and the 7 correctness oracles |

An adapter is a module with one export: backend `layers(cfg)` -> `[{ name, what, requires, files, run }]`; router
`extract(text, file, cfg)` -> `[{ method, path, allow, from }]`. Add one by dropping a file in the folder and naming it in
qa.config.json.
