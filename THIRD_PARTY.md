# Third-party components

Nothing below is vendored in this branch except where stated. Each is used by reference: install it yourself after
reading its source, and pin the version.

| Component | Use | Licence | How |
|---|---|---|---|
| browser-test skills (author, refiner, runner, compiler), https://github.com/Autodesk/claude-browser-test-skills | S3-S5: case authoring, refinement, running, compiling. `.claude/skills/qa-author`, `qa-refiner`, `qa-runner`, `qa-compiler` adapt them to the qa-pack format | Apache-2.0 | `/plugin marketplace add Autodesk/claude-browser-test-skills`, then `/plugin install browser-test@browser-test-skills` (check the marketplace and plugin names in that repo's README) |
| graphify, PyPI `graphifyy` | S1 knowledge graph (`qa-pack/scripts/graph.mjs`), optional | see the package | `pip install graphifyy==0.9.91` |
| Playwright `@playwright/test` | S5/S6 browser specs, shards, merge-reports | Apache-2.0 | devDependency, pinned `1.61.1` |
| Maestro CLI | S6 mobile series (`maestro-run.mjs`) | Apache-2.0 | release `2.11.0`, zip sha256 checked (see `qa-pack/templates/mobile/EMULATOR.md`) |
| reactivecircus/android-emulator-runner and the `actions/*` actions | GitHub Actions TEMPLATE `qa-pack/templates/github/maestro-android.yml` | Apache-2.0 / MIT | pinned by commit SHA in the template |
| superpowers, https://github.com/obra/superpowers | discipline of `/qa-fix` (optional) | MIT | see `qa-pack/SUPERPOWERS.md` |
| `qa-pack/schema/units.schema.json` | the qa-fleet units contract | same as this repo | VENDORED from the fleet (main branch), with the regex escapes fixed so the file is valid JSON |
