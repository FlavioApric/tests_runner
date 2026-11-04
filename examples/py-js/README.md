# Example: a small project that is not Node-only

Only `.qa-fleet/units.json` is needed (no `unit.sh`: each unit's `cmd` runs as is).
To try it on the fleet, copy this folder into a private repo listed in the runners' `ALLOWED_SOURCES`, push, then:

    node <qa-fleet>/cli/fleet.mjs run --project . --source me/py-js-example --ref main
