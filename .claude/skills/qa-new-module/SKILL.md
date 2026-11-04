---
name: qa-new-module
description: Add a new feature of the app to the test pack as a module (J01, J02, ...). Use when a new feature, screen or backend capability needs tests, so the pack tests N+M features.
---

# /qa-new-module

1. `node qa-pack/runners/pack.mjs new-module <slug> --name "Feature name" --area <R?> [--screen <screen>] --project <dir>`.
   It picks the next free id (`ids.module`) and creates only new files from `qa-pack/templates/module/`: the manifest
   `module.json`, a case with the five sections, a design-contract screen, non-browser notes, a Maestro stub.
2. Requirements first: add rows to the area research file (`<paths.research>/R?-*.md`) and run
   `node qa-pack/scripts/consolidate.mjs`; list the ids in `module.json` `requirements`.
3. Fill every `TODO(qa-pack)`: author the case (`/qa-author`), make each Verify name its oracle (`/qa-refiner`), write
   the design-contract keys from the real components and the spec, backend tests (`/qa-backend`), access cells
   (`/qa-access`), a Maestro flow if mobile is enabled.
4. `pack.mjs validate --strict` must be clean (no draft, no TODO, every requirement in a module, every step id in its
   module). Then `/qa-compiler`, `coverage-link.mjs`, and `/qa run`.
5. Large feature: plan it first (superpowers `brainstorming`, `writing-plans`; see qa-pack/SUPERPOWERS.md).
