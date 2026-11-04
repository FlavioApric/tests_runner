#!/usr/bin/env node
// S1 inventory: every function of the app with file, line, kind, exported, callers and the test files that name it.
//   node qa-pack/scripts/inventory.mjs [--project <dir>] [--check] [--stdout]
// Adapters: js (.js .mjs .cjs .jsx, inline <script> of .html), ts (.ts .tsx .mts .cts), py (.py).
// Static and heuristic (line-based regexes, comments stripped): it lists where things are and who names them;
// it never says that a test PASSED. Output is deterministic (no timestamp), so --check fails only on real drift.
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, projectDirFrom } from '../lib/config.mjs'
import { args, walk, read, write, isMain } from '../lib/util.mjs'

const EXT = { js: ['.js', '.mjs', '.cjs', '.jsx', '.html'], ts: ['.ts', '.tsx', '.mts', '.cts'], py: ['.py'] }
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'await', 'import', 'super', 'constructor', 'get', 'set', 'elif', 'print', 'with'])
const ID = '[A-Za-z_$][\\w$]*'

export const languageOf = (file) => Object.entries(EXT).find(([, exts]) => exts.includes(path.extname(file)))?.[0] ?? null

// ---------------------------------------------------------------- adapters
// string literals are blanked first (a URL or a path in a string is not a call), then comments
const stripStrings = (line) => line.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""')
const stripJs = (line) => stripStrings(line).replace(/(^|[\s;{}(),])\/\/.*$/, '$1').replace(/\/\*.*?\*\//g, '')
const stripPy = (line) => stripStrings(line).replace(/(^|\s)#.*$/, '$1')
const names = (s, re) => new Set(s.match(re) ?? [])

export const adapters = {
  js: {
    strip: stripJs,
    defs(lines) {
      const out = [], exportList = new Set()
      let classDepth = null, depth = 0, inBlockComment = false
      lines.forEach((raw, i) => {
        let line = raw
        if (inBlockComment) { if (!line.includes('*/')) return; line = line.slice(line.indexOf('*/') + 2); inBlockComment = false }
        if (/\/\*(?!.*\*\/)/.test(line)) { inBlockComment = true; line = line.slice(0, line.indexOf('/*')) }
        line = stripJs(line)
        for (const m of line.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of m[1].split(',')) { const [a, b] = n.trim().split(/\s+as\s+/); if (a) exportList.add(a.trim()); if (b) exportList.add(a.trim()) }
        for (const m of line.matchAll(new RegExp(`(?:module\\.)?exports\\.(${ID})\\s*=`, 'g'))) exportList.add(m[1])
        const me = /module\.exports\s*=\s*\{([^}]*)\}/.exec(line); if (me) for (const n of me[1].split(',')) exportList.add(n.split(':')[0].trim())
        let m
        if ((m = new RegExp(`^\\s*(export\\s+)?(default\\s+)?(?:declare\\s+)?(async\\s+)?function\\s*\\*?\\s*(${ID})\\s*(?:<[^>]*>)?\\s*\\(`).exec(line))) out.push({ name: m[4], line: i + 1, kind: 'function', exported: !!m[1] })
        else if ((m = new RegExp(`^\\s*(export\\s+)?(?:const|let|var)\\s+(${ID})\\s*(?::[^=]+)?=\\s*(async\\s+)?(?:function\\b|(?:\\([^)]*\\)|${ID})\\s*(?::[^=]+)?=>|\\([^)]*$)`).exec(line)) && (/=>|function\b/.test(line) || /=>/.test(lines[i + 1] ?? '') || /=>/.test(lines[i + 2] ?? ''))) out.push({ name: m[2], line: i + 1, kind: 'function', exported: !!m[1] })
        else if ((m = new RegExp(`^\\s*(export\\s+)?(default\\s+)?(?:abstract\\s+)?class\\s+(${ID})`).exec(line))) { out.push({ name: m[3], line: i + 1, kind: 'class', exported: !!m[1] }); classDepth = depth }
        else if ((m = new RegExp(`^\\s+(?:public\\s+|private\\s+|protected\\s+)?(?:static\\s+)?(async\\s+)?\\*?\\s*(${ID})\\s*\\([^)]*\\)?\\s*(?::[^{]+)?\\{\\s*$`).exec(line)) && !KEYWORDS.has(m[2])) out.push({ name: m[2], line: i + 1, kind: 'method', exported: false, inClass: classDepth !== null })
        else if ((m = new RegExp(`^\\s+(${ID})\\s*\\(.*\\)\\s*\\{`).exec(line)) && !KEYWORDS.has(m[1]) && !/^\s*(\w+\.)/.test(line) && !/=>|;\s*$/.test(line.split('{')[0])) out.push({ name: m[1], line: i + 1, kind: 'method', exported: false })
        depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)
        if (classDepth !== null && depth <= classDepth) classDepth = null
      })
      for (const d of out) if (exportList.has(d.name) && d.kind !== 'method') d.exported = true
      return out
    },
    callRe: (name) => new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}\\s*(?:<[^>()]*>)?\\(`, 'g'),
    refRe: (name) => new RegExp(`(?<![\\w$.'"\`/-])${name.replace(/\$/g, '\\$')}(?![\\w$('"\`:{-])`, 'g'),
    isImport: (line) => /^\s*(import\b|export\s*\{.*\}\s*from|const\s*\{[^}]*\}\s*=\s*require\()/.test(line),
    imported: (line) => (/^\s*import\b/.test(line) || /require\(/.test(line) ? names(line.replace(/from\s+['"].*$/, ''), /[A-Za-z_$][\w$]*/g) : new Set()),
  },
  py: {
    strip: stripPy,
    defs(lines) {
      const out = []
      const all = lines.join('\n').match(/^__all__\s*=\s*\[([^\]]*)\]/m)?.[1]?.match(/['"](\w+)['"]/g)?.map((s) => s.slice(1, -1))
      lines.forEach((raw, i) => {
        const line = stripPy(raw)
        let m
        if ((m = /^(\s*)(async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line))) {
          const top = m[1].length === 0
          out.push({ name: m[3], line: i + 1, kind: top ? 'function' : 'method', exported: top && (all ? all.includes(m[3]) : !m[3].startsWith('_')) })
        } else if ((m = /^class\s+([A-Za-z_]\w*)/.exec(line))) out.push({ name: m[1], line: i + 1, kind: 'class', exported: all ? all.includes(m[1]) : !m[1].startsWith('_') })
      })
      return out
    },
    callRe: (name) => new RegExp(`(?<![\\w])${name}\\s*\\(`, 'g'),
    refRe: (name) => new RegExp(`(?<![\\w.'"])${name}(?![\\w('"])`, 'g'),
    isImport: (line) => /^\s*(from\s+\S+\s+import|import)\b/.test(line),
    imported: (line) => (/^\s*(from\s+\S+\s+)?import\b/.test(line) ? names(line.replace(/^\s*from\s+\S+\s+import/, ''), /[A-Za-z_]\w*/g) : new Set()),
  },
}
adapters.ts = adapters.js

// ---------------------------------------------------------------- build
export function buildInventory(cfg) {
  const langs = cfg.app.languages ?? ['js', 'ts', 'py']
  const exts = new Set(langs.flatMap((l) => EXT[l]))
  const excluded = (rel) => ['graphify-out/', 'node_modules/', ...(cfg.app.exclude ?? [])].some((x) => rel.includes(x)) // generated output is never app code
  const srcFiles = [...new Set(cfg.app.src.flatMap((s) => walk(path.join(cfg.dir, s), (p) => exts.has(path.extname(p)))))].map((p) => cfg.rel(p)).filter((r) => !excluded(r)).sort()
  const testRoots = [cfg.paths.tests ?? 'tests', cfg.paths.compiled].filter((x, i, a) => a.indexOf(x) === i)
  const testFiles = [...new Set(testRoots.flatMap((t) => walk(path.join(cfg.dir, t), (p) => exts.has(path.extname(p)) || /\.(ya?ml|sql|sh)$/.test(p))))].map((p) => cfg.rel(p)).sort()
  const text = Object.fromEntries([...srcFiles, ...testFiles].map((f) => [f, read(path.join(cfg.dir, f)).split(/\r?\n/)]))
  const functions = []
  for (const file of srcFiles) {
    const lang = languageOf(file)
    for (const d of adapters[lang].defs(text[file])) functions.push({ name: d.name, file, line: d.line, kind: d.kind, exported: d.exported, language: lang === 'ts' ? 'ts' : lang })
  }
  const imports = Object.fromEntries(srcFiles.map((f) => { const ad = adapters[languageOf(f)], s = new Set(); for (const l of text[f]) for (const n of ad.imported(l)) s.add(n); return [f, s] }))
  const byName = {}
  for (const f of functions) (byName[f.name] ??= []).push(f)
  for (const f of functions) {
    const ad = adapters[f.language], callers = [], seen = new Set()
    for (const file of srcFiles) {
      const fl = languageOf(file); if ((fl === 'py') !== (f.language === 'py')) continue
      const fad = adapters[fl]
      text[file].forEach((raw, i) => {
        if (file === f.file && i + 1 === f.line) return
        if (fad.isImport(raw)) return
        // another file reaches a function only through an import; methods are called on objects (no import needed)
        if (file !== f.file && f.kind !== 'method' && !imports[file].has(f.name)) return
        const line = fad.strip(raw)
        const call = ad.callRe(f.name).test(line), ref = !call && f.kind !== 'method' && ad.refRe(f.name).test(line)
        if (!call && !ref) return
        const k = `${file}:${i + 1}`; if (seen.has(k)) return; seen.add(k)
        callers.push({ file, line: i + 1, kind: call ? 'call' : 'ref' })
      })
    }
    f.callers = callers
    f.testedBy = testFiles.filter((t) => text[t].some((l) => { const s = ad.strip(l); return ad.callRe(f.name).test(s) || (f.kind !== 'method' && ad.refRe(f.name).test(s)) }))
    if (byName[f.name].length > 1) f.ambiguous = true
  }
  functions.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
  const per = (k) => Object.fromEntries([...new Set(functions.map((f) => f[k]))].sort().map((v) => [v, functions.filter((f) => f[k] === v).length]))
  return {
    schema: 'qa-pack/inventory@1',
    project: cfg.project,
    sources: cfg.app.src,
    files: srcFiles.length,
    testFiles: testFiles.length,
    totals: { functions: functions.length, exported: functions.filter((f) => f.exported).length, withoutCallers: functions.filter((f) => !f.callers.length).length, withoutTests: functions.filter((f) => !f.testedBy.length).length, byLanguage: per('language'), byKind: per('kind') },
    functions,
  }
}

export function inventoryMarkdown(inv) {
  const rows = inv.functions.map((f) => `| \`${f.name}\` | ${f.kind} | ${f.file}:${f.line} | ${f.exported ? 'yes' : ''} | ${f.callers.length ? f.callers.slice(0, 4).map((c) => `${c.file}:${c.line}${c.kind === 'ref' ? ' (ref)' : ''}`).join(', ') + (f.callers.length > 4 ? `, +${f.callers.length - 4}` : '') : '**none**'} | ${f.testedBy.join(', ') || '**none**'} |`)
  return [`# Inventory (${inv.project})`, '', `Generated by \`node qa-pack/scripts/inventory.mjs\`. ${inv.totals.functions} functions in ${inv.files} files (${inv.totals.exported} exported), ${inv.totals.withoutCallers} without callers, ${inv.totals.withoutTests} not named by any test file. "Tested by" is static evidence (a test file names it), not a pass.`, '',
    '| Function | Kind | Where | Exported | Callers | Tested by |', '|---|---|---|---|---|---|', ...rows, ''].join('\n')
}

if (isMain(import.meta.url)) {
  const a = args()
  const cfg = loadConfig(projectDirFrom())
  const inv = buildInventory(cfg)
  const out = JSON.stringify(inv, null, 1) + '\n'
  if (a.flag('--stdout')) { process.stdout.write(out); process.exit(0) }
  const jp = cfg.abs('inventory'), mp = cfg.abs('inventoryMd')
  if (a.flag('--check')) {
    const stale = !fs.existsSync(jp) || fs.readFileSync(jp, 'utf8').replace(/\r/g, '') !== out
    console.log(stale ? `inventory stale: run node qa-pack/scripts/inventory.mjs --project ${cfg.rel(cfg.dir) || '.'}` : 'inventory up to date')
    process.exit(stale ? 1 : 0)
  }
  write(jp, out); write(mp, inventoryMarkdown(inv))
  console.log(`inventory: ${inv.totals.functions} functions (${JSON.stringify(inv.totals.byLanguage)}), ${inv.totals.withoutCallers} without callers, ${inv.totals.withoutTests} without tests -> ${cfg.rel(jp)}, ${cfg.rel(mp)}`)
}
