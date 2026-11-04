---
name: qa-compiler
description: Turn a stable browser case (markdown) of a qa-pack project into a Playwright spec under paths.compiled, keeping requirement ids, tags and design-contract calls. Use after a case passed cleanly at least once.
---

# /qa-compiler

Adapts `browser-test:compiler` (Autodesk/claude-browser-test-skills, Apache-2.0, by reference).
- One spec per module in `paths.compiled`, named `<id lowercase>-<slug>.spec.mjs` (or `.ts`). The Playwright config
  comes from `qa-pack/lib/playwright-config.mjs` (projects, shards, blob reports, auth setup).
- Personas through the saved storage state (see `auth.setup.mjs` in the example), the hooks as `beforeAll`/`afterAll`,
  test titles with the requirement ids the test truly asserts (`R1-003 ...`) so `coverage-link.mjs` counts them, tags
  such as `@J01`.
- `expectDesign(page, screen, { keys })` (from `qa-pack/lib/designContract.mjs`) for every Design contract line.
- `@known-divergence` steps use `test.fail()` with the reason, never `skip`/`fixme`.
- Run `npx playwright test -c <playwright.config> <file>`, then `node qa-pack/scripts/coverage-link.mjs`; record the
  spec in `module.json` `compiled`, status `compiled`, and `green` after a clean run.
