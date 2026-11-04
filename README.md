# tests_runner: test-plan branch

A generic test-plan pipeline for Claude Code: code -> graph -> research -> requirements -> browser cases ->
compiled Playwright specs and Maestro plans -> qa-fleet units. It runs locally, or on the cloud fleet of the `main`
branch of this repository (the `fleet` skill).

- `PIPELINE.md`: the stages S1-S7, the flow, the gates.
- `qa-pack/`: scripts, runners, adapters, schemas, templates, gates, evidence templates, `conventions.md`.
- `.claude/skills/qa*`: the skills (`/qa`, `/qa-run`, `/qa-new-module`, `/qa-author`, `/qa-refiner`, `/qa-runner`,
  `/qa-compiler`, `/qa-backend`, `/qa-access`, `/qa-fix`, `/qa-gate`, `/qa-design-review`).
- `examples/tiny-app/`: a small app taken through every stage.
- `THIRD_PARTY.md`: what is used by reference (browser-test skills, graphify, Playwright, Maestro, actions).

## Use it on an app

1. Copy `qa-pack/templates/qa.config.json` to the app and fill it (paths, ports, personas, areas, adapters).
2. `node qa-pack/install-skills.mjs --project <app>` (or `--user`).
3. In Claude Code, in the app: `/qa status`, then `/qa run` (it asks Local or Cloud fleet).

## Develop

```bash
npm ci
npm test                 # node:test suite (scripts, schemas, example, leak guard)
npm run e2e              # the example's compiled Playwright specs
```

Node >= 20.11. No runtime dependencies; `@playwright/test` is the only dev dependency.
