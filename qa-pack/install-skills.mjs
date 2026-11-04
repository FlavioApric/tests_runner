#!/usr/bin/env node
// Copies the qa-pack skills (.claude/skills/qa*) of this repo into a project (default: --project <dir>/.claude/skills)
// or into ~/.claude/skills (--user). Never overwrites a skill that differs without --force.
//   node qa-pack/install-skills.mjs --project <dir> [--force] | --user [--force]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO_DIR, args } from './lib/util.mjs'

const a = args(), force = a.flag('--force')
const project = a.opt('--project')
if (!a.flag('--user') && !project) { console.log('usage: install-skills.mjs --project <dir> | --user [--force]'); process.exit(2) }
const dest = a.flag('--user') ? path.join(os.homedir(), '.claude', 'skills') : path.join(path.resolve(project), '.claude', 'skills')
const srcDir = path.join(REPO_DIR, '.claude', 'skills')
let n = 0, kept = 0
for (const name of fs.readdirSync(srcDir).filter((x) => x === 'qa' || x.startsWith('qa-'))) {
  const src = path.join(srcDir, name, 'SKILL.md'); if (!fs.existsSync(src)) continue
  const out = path.join(dest, name, 'SKILL.md')
  if (fs.existsSync(out) && !force && fs.readFileSync(out, 'utf8') !== fs.readFileSync(src, 'utf8')) { console.log(`kept ${name} (differs; use --force)`); kept++; continue }
  fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(src, out); n++
}
console.log(`${n} skill(s) installed to ${dest}${kept ? `, ${kept} kept` : ''}`)
