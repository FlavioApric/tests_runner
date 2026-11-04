#!/usr/bin/env bash
# Runs ONE unit on a runner. Layout: $GITHUB_WORKSPACE/fleet (this repo), $GITHUB_WORKSPACE/src (the private source).
# Everything the unit prints goes to qaf-out/qa-fleet-meta/unit.log (sealed later), NOT to the public job log.
# Phases: prepare -> setup -> emulator -> ready -> run. Exit 75 from setup/emulator = infrastructure (retried once elsewhere).
set -uo pipefail
UNIT_ID="${1:?unit id}"
WS="${GITHUB_WORKSPACE:-$PWD}"
FLEET="$WS/fleet"; SRC="$WS/src"; OUT="$WS/qaf-out"; META="$OUT/qa-fleet-meta"
mkdir -p "$META" "$OUT/results"
exec 3>&1
exec >"$META/unit.log" 2>&1
say() { echo "[qa-fleet] $*" >&3; echo "[qa-fleet] $*"; }
START=$(date +%s)
phase=prepare
finish() {
  local code="$1"
  # copy declared result folders (relative to the source root)
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    if [ -e "$SRC/$p" ]; then (cd "$SRC" && cp -r --parents "$p" "$OUT/results/") || true; fi
  done <<<"$QAF_RESULTS"
  local sha; sha=$(git -C "$SRC" rev-parse HEAD 2>/dev/null || echo unknown)
  printf '{"unit":"%s","phase":"%s","exitCode":%d,"durationSec":%d,"sha":"%s","runner":"%s"}\n' \
    "$UNIT_ID" "$phase" "$code" "$(( $(date +%s) - START ))" "$sha" "${GITHUB_REPOSITORY:-local}" >"$META/result.json"
  say "unit $UNIT_ID: phase $phase, exit $code, $(( $(date +%s) - START ))s"
  exit "$code"
}

# unit definition comes from the SOURCE repo's units.json (never from the dispatch inputs)
ENV_LINES=$(node "$FLEET/cli/fleet.mjs" unit-env --project "$SRC" --unit "$UNIT_ID") || { QAF_RESULTS=""; finish 75; }
dec() { printf '%s' "$1" | base64 -d; }
QAF_CMD=$(dec "$(grep '^QAF_CMD_B64=' <<<"$ENV_LINES" | cut -d= -f2-)")
QAF_RESULTS=$(dec "$(grep '^QAF_RESULTS_B64=' <<<"$ENV_LINES" | cut -d= -f2-)")
# shellcheck disable=SC2163 # kv is KEY=VALUE on purpose
while IFS= read -r kv; do [ -n "$kv" ] && export "$kv"; done <<<"$(dec "$(grep '^QAF_ENV_B64=' <<<"$ENV_LINES" | cut -d= -f2-)")"
QAF_EMULATOR_API=$(grep '^QAF_EMULATOR_API=' <<<"$ENV_LINES" | cut -d= -f2-)
export QAF_UNIT_ID="$UNIT_ID" QAF_CMD QAF_RESULTS QAF_EMULATOR_API QAF_RESULTS_DIR="$SRC/qa-fleet-results" QAF_META="$META"

# only the secrets this unit declared
if [ -f "${RUNNER_TEMP:-/tmp}/qaf-unit.env" ]; then set -a; . "${RUNNER_TEMP:-/tmp}/qaf-unit.env"; set +a; rm -f "${RUNNER_TEMP:-/tmp}/qaf-unit.env"; fi

EMU_PID=""
if [ -n "$QAF_EMULATOR_API" ]; then
  say "booting Android emulator API $QAF_EMULATOR_API in the background"
  bash "$FLEET/runner/start-emulator.sh" "$QAF_EMULATOR_API" >"$META/emulator.log" 2>&1 &
  EMU_PID=$!
fi

cd "$SRC" || finish 75
mkdir -p qa-fleet-results
HOOK=""
[ -f .qa-fleet/unit.sh ] && HOOK=".qa-fleet/unit.sh"

phase=setup
if [ -n "$HOOK" ]; then
  say "setup"
  bash "$HOOK" setup "$UNIT_ID"; c=$?
  [ $c -eq 0 ] || finish $c
fi

# need "browsers:<list>": install them with the project's own Playwright version (after its deps are installed)
if [ -n "${QAF_BROWSERS:-}" ] && [ -x node_modules/.bin/playwright ]; then
  say "installing browsers ${QAF_BROWSERS}"
  npx playwright install --with-deps ${QAF_BROWSERS//,/ } || finish 75
fi

if [ -n "$EMU_PID" ]; then
  phase=emulator
  wait "$EMU_PID" || finish 75
  say "emulator ready"
fi

# optional "ready" hook: the device and services are up (e.g. adb reverse + install the APK). Exit 75 = infrastructure.
if [ -n "$HOOK" ]; then
  phase=ready
  bash "$HOOK" ready "$UNIT_ID"; c=$?
  [ $c -eq 0 ] || finish $c
fi

phase=run
say "run"
if [ -n "$HOOK" ]; then
  bash "$HOOK" run "$UNIT_ID"; c=$?
else
  bash -c "$QAF_CMD"; c=$?
fi
finish $c
