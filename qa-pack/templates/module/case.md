# {{ID}} {{NAME}}

## Summary
TODO(qa-pack): one paragraph: who does what on which screen, and what a correct result is.

## Preconditions
- **Standard preconditions** (see qa-pack/conventions.md)
- **Environments:** local
- **Markers:** @planned @{{SLUG}} @{{ID}}

## Before Hook

### Setup 0. Fixture preflight
TODO(qa-pack): the fixtures this case needs and how they are checked (delete this setup if none).

### Setup 1. Standard preconditions
TODO(qa-pack): personas (env names `{{PREFIX}}<PERSONA>_USER` / `_PASSWORD` only, never values), seed rows, flags.

## Test Steps

### 1. {{REQ}} TODO(qa-pack) first scenario
TODO(qa-pack): what the user does.
**Verify:** TODO(qa-pack) the exact expected values from the requirement.
**Oracle:** TODO(qa-pack) the independent source of truth, every item not a sample, a negative proof (conventions: Correctness oracles).
Screenshot: qa/evidence/cases/{{ID}}-{{SLUG}}/01.png (viewport 390x844 dpr 2)
Design contract: {{SCREEN}}#TODO
Golden: qa/design/golden/{{ID}}-{{SLUG}}/01.png

## After Hook

### Teardown 1. Idempotent cleanup
TODO(qa-pack): delete only what the case created (title prefix `QA {{ID}} `); a second run must match nothing.
