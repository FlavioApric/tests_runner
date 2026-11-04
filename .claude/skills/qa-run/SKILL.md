---
name: qa-run
description: Bring up and check the local QA environment of a qa-pack project (stack, preview server, personas file, Playwright browsers, emulator) and run the ready flow steps. Use when a case cannot run, when asked to "bring up the tests", or to see which capabilities this machine has.
---

# /qa-run

1. `node qa-pack/runners/pack.mjs capabilities --project <dir>`: what this machine has (node, docker, stack,
   preview, personas, playwright-browser, adb, emulator, maestro, graphify, python, secrets).
2. Resolve what you can yourself: `npm ci`, `npx playwright install chromium`, copy `env.personasExample` to
   `env.personasFile` and ask the owner for the values (never print them), `stack.up` from qa.config.json. Ask once,
   at the end, for human-only items (start Docker Desktop, real devices).
3. `stack.preflight` when set; otherwise the Playwright `webServer` starts `preview.start` by itself.
4. `pack.mjs flow --resume`: runs what is ready, defers the rest with the missing capability.
5. Close what you started (stack down, emulator off, servers stopped) when the work is finished.
