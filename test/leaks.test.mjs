// Leak guard for a public repository: no private project names or persona keys, no local user paths, no
// personal e-mail addresses, no tokens. The forbidden words are rebuilt at run time so this file never matches itself.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { REPO, repoFiles } from './helpers.mjs'

const rev = (s) => [...s].reverse().join('')
const words = ['tsiltuo', '3aq'].map(rev) // private project names, case-insensitive
const personas = ['RESU', 'B_RESU', 'REZINAGRO', 'COSSA_TNEDUTS', 'RETOMORP', 'GNIDNEP_RETOMORP', 'RESU_OMORP', '1NIMDA', '2NIMDA', 'DEIFIREVNU'].map(rev)
const rules = [
  ...words.map((w) => ({ what: `private name "${w}"`, re: new RegExp(w, 'i') })),
  // persona keys as standalone identifiers (QA_MEMBER_USER style env names are fine: `_` is a word character)
  ...personas.slice(1).map((p) => ({ what: `private persona key ${p}`, re: new RegExp(`(?<![\\w-])${p}(?![\\w-])`) })),
  // the bare key also names the generic _USER / 'USER' env suffix, so it is a leak only where it is a persona
  { what: `private persona key ${personas[0]}`, re: new RegExp(`(key"?\\s*[:=]\\s*["']${personas[0]}["']|persona[s]?\\W+${personas[0]}\\b|stateOf\\(["']${personas[0]}["']\\)|^\\|\\s*${personas[0]}\\s*\\|)`, 'i') },
  { what: 'local user path', re: new RegExp(`[A-Za-z]:[\\\\/]+${rev('sresU')}[\\\\/]`, 'i') },
  { what: 'home path', re: new RegExp(`/${rev('emoh')}/[a-z][\\w.-]+/`, 'i') },
  { what: 'e-mail address', re: /[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}/i, allow: (m) => /@(example\.(com|org|test)|users\.noreply\.github\.com|anthropic\.com)$/i.test(m) || /^[\w.-]+@\d/.test(m) },
  { what: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { what: 'API key', re: /\b(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|xox[abp]-[A-Za-z0-9-]{10,})/ },
  { what: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./ },
  { what: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
]

const TEXT = /\.(m?js|cjs|ts|py|json|md|ya?ml|html|css|txt|example|gitignore|sh|ps1)$|^\.[\w.-]+$/
const files = repoFiles(REPO).filter((f) => TEXT.test(path.basename(f)) && !/package-lock\.json$/.test(f))

test('there are files to scan', () => assert.ok(files.length > 50, String(files.length)))

test('no private names, persona keys, local paths, e-mails or tokens in the repository', () => {
  const hits = []
  for (const f of files) {
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const r of rules) {
        const m = line.match(r.re)
        if (m && !(r.allow && r.allow(m[0]))) hits.push(`${path.relative(REPO, f)}:${i + 1} ${r.what}`)
      }
    })
  }
  assert.deepEqual(hits, [])
})

test('the guard itself catches a planted leak', () => {
  const planted = `${rev('sresU')}`, sample = `C:/${planted}/someone/x and ${words[0].toUpperCase()} and ${personas[1]}`
  assert.ok(rules.filter((r) => r.re.test(sample)).length >= 3)
})
