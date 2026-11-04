// Summarise any JUnit XML (pytest, jest, vitest, go-junit-report, gradle, Playwright, Maestro) without a parser dependency.
import fs from 'node:fs'
import path from 'node:path'

const walk = (d, out = []) => { if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p, out); else if (/\.xml$/i.test(e.name)) out.push(p) } return out }
const attr = (tag, name) => { const m = new RegExp(`\\b${name}="(\\d+)"`).exec(tag); return m ? Number(m[1]) : 0 }

export function summarizeXml(xml) {
  const s = { tests: 0, failures: 0, errors: 0, skipped: 0, failed: [] }
  if (!/<testsuites?\b/.test(xml)) return null
  const cases = [...xml.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)]
  if (cases.length) {
    for (const c of cases) {
      s.tests++
      const body = c[3] ?? ''
      const name = /\bname="([^"]*)"/.exec(c[1])?.[1] ?? '?'
      const cls = /\bclassname="([^"]*)"/.exec(c[1])?.[1]
      if (/<failure\b/.test(body)) { s.failures++; s.failed.push(cls ? `${cls} > ${name}` : name) }
      else if (/<error\b/.test(body)) { s.errors++; s.failed.push(cls ? `${cls} > ${name}` : name) }
      else if (/<skipped\b/.test(body)) s.skipped++
    }
    return s
  }
  for (const t of xml.matchAll(/<testsuite\b[^>]*>/g)) { s.tests += attr(t[0], 'tests'); s.failures += attr(t[0], 'failures'); s.errors += attr(t[0], 'errors'); s.skipped += attr(t[0], 'skipped') }
  return s
}

export function summarizeDir(dir) {
  const total = { tests: 0, failures: 0, errors: 0, skipped: 0, failed: [], files: 0 }
  for (const f of walk(dir)) {
    const s = summarizeXml(fs.readFileSync(f, 'utf8'))
    if (!s) continue
    total.files++
    for (const k of ['tests', 'failures', 'errors', 'skipped']) total[k] += s[k]
    total.failed.push(...s.failed)
  }
  return total
}
