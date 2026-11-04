// "fleet init --kind X": scaffold <project>/.qa-fleet for a common test runner. Edit the result freely.
import fs from 'node:fs'
import path from 'node:path'
import { SCHEMA } from './units.mjs'

const R = 'qa-fleet-results'
const KINDS = {
  playwright: (n) => ({ defaults: { needs: ['node:22', 'browsers:chromium'], results: [R] }, units: range(n, (i) => ({ id: `pw-${i}-of-${n}`, estMinutes: 8, cmd: `npx playwright test --shard=${i}/${n} --reporter=junit,list` , env: { PLAYWRIGHT_JUNIT_OUTPUT_NAME: `${R}/junit.xml` } })) }),
  vitest: (n) => ({ defaults: { needs: ['node:22'], results: [R] }, units: range(n, (i) => ({ id: `vitest-${i}-of-${n}`, estMinutes: 4, cmd: `npx vitest run --shard=${i}/${n} --reporter=default --reporter=junit --outputFile.junit=${R}/junit.xml` })) }),
  jest: (n) => ({ defaults: { needs: ['node:22'], results: [R] }, units: range(n, (i) => ({ id: `jest-${i}-of-${n}`, estMinutes: 4, cmd: `npx jest --shard=${i}/${n} --ci --reporters=default --reporters=jest-junit`, env: { JEST_JUNIT_OUTPUT_DIR: R } })) }),
  pytest: (n) => ({ defaults: { needs: ['python:3.12'], results: [R] }, units: range(n, (i) => ({ id: `pytest-${i}-of-${n}`, estMinutes: 5, cmd: `python -m pip install -q -r requirements.txt pytest && python -m pytest $(python - <<'PY'\nimport glob\nfs=sorted(glob.glob('tests/**/test_*.py',recursive=True)); print(' '.join(f for k,f in enumerate(fs) if k % ${n} == ${i - 1}))\nPY\n) --junitxml=${R}/junit.xml` })) }),
  go: (n) => ({ defaults: { needs: ['go:1.23'], results: [R] }, units: range(n, (i) => ({ id: `go-${i}-of-${n}`, estMinutes: 5, cmd: `go install github.com/jstemmer/go-junit-report/v2@v2.1.0 && go list ./... | awk 'NR % ${n} == ${i % n}' | xargs go test -v 2>&1 | $(go env GOPATH)/bin/go-junit-report -set-exit-code > ${R}/junit.xml` })) }),
  maestro: (n) => ({ defaults: { needs: ['android-emulator:34', 'node:22'], results: [R], timeoutMinutes: 90 }, units: range(n, (i) => ({ id: `maestro-${i}-of-${n}`, estMinutes: 15, cmd: `maestro test --format junit --output ${R}/junit.xml $(ls .maestro/*.yaml | awk 'NR % ${n} == ${i % n}')` })) }),
  gradle: (n) => ({ defaults: { needs: ['java:21'], results: [R] }, units: [{ id: 'gradle-unit', estMinutes: 10, cmd: `./gradlew test --no-daemon && cp -r build/test-results ${R}/` }, ...range(n - 1, (i) => ({ id: `gradle-android-${i}`, needs: ['android-emulator:34'], estMinutes: 20, cmd: `./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.numShards=${n - 1} -Pandroid.testInstrumentationRunnerArguments.shardIndex=${i - 1} --no-daemon; s=$?; cp -r app/build/outputs/androidTest-results ${R}/ 2>/dev/null; exit $s` }))] }),
  shell: () => ({ defaults: { results: [R] }, units: [{ id: 'example', estMinutes: 1, cmd: `echo replace me; mkdir -p ${R}` }] }),
}
function range(n, f) { return Array.from({ length: Math.max(1, n) }, (_, k) => f(k + 1)) }

const UNIT_SH = `#!/usr/bin/env bash
# qa-fleet hook (optional). Called by the runner as:  unit.sh setup <id>,  unit.sh ready <id>,  unit.sh run <id>
# "setup" prepares what every unit needs (install, build, start services); the emulator (if any) boots meanwhile.
# "ready" runs once the emulator is booted (e.g. adb install). "run" runs the unit's $QAF_CMD (agent units never run on a runner: they are local Claude explorers).
# Exit 75 = environment problem (retried once on another runner); any other non-zero exit = failure.
set -euo pipefail
phase="$1"; unit="$2"
case "$phase" in
  setup)
    # e.g. npm ci / pip install -r requirements.txt / docker compose up -d
    ;;
  ready)
    ;;
  run)
    eval "$QAF_CMD"
    ;;
esac
`

export function initProject(dir, { kind = 'shell', shards = 4, force = false } = {}) {
  if (!KINDS[kind]) throw new Error(`unknown kind ${kind} (${Object.keys(KINDS).join(', ')})`)
  const d = path.join(dir, '.qa-fleet')
  const p = path.join(d, 'units.json')
  if (fs.existsSync(p) && !force) throw new Error(`${p} exists (use --force)`)
  fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(p, JSON.stringify({ schema: SCHEMA, project: path.basename(path.resolve(dir)), ...KINDS[kind](shards) }, null, 1) + '\n')
  if (!fs.existsSync(path.join(d, 'unit.sh'))) fs.writeFileSync(path.join(d, 'unit.sh'), UNIT_SH)
  return `wrote ${p} (${kind}, ${shards} shard(s)) and .qa-fleet/unit.sh; review the commands, then: fleet validate && fleet plan`
}
