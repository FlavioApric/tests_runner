# Example: a small project that is not Node-only

Only `.qa-fleet/units.json` is needed (no `unit.sh`: each unit's `cmd` runs as is).
To try it on the fleet, copy this folder into a private repo, install the fleet App on it, push, then:

    node <tests_runner>/cli/fleet.mjs run --source me/py-js-example --ref main --project .
