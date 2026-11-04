"""Offline report over a JSON export of notes (exercises the Python adapter of qa-pack/scripts/inventory.mjs)."""
import json
import sys


def load_notes(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)["notes"]


def count_by_owner(notes):
    out = {}
    for n in notes:
        out[n["owner"]] = out.get(n["owner"], 0) + 1
    return _sorted(out)


def _sorted(d):
    return dict(sorted(d.items()))


def main(argv):
    print(json.dumps(count_by_owner(load_notes(argv[1])), indent=1))


if __name__ == "__main__":
    main(sys.argv)
