// Router adapter "express": node/express style servers.
// Finds (1) app.get('/p', guard, handler) / router.post(...) calls, the first identifier argument after the path is
// looked up in qa.config router.guards (guard -> roles | 'all' | 'session'); no guard = 'all';
// (2) route tables of tuples ['GET', '/p' or /regex/, allow, handler] where allow is 'all' | 'session' | ['role', ...].
// Regex paths become a sample path: each capture group is replaced by `:p1`, `:p2`...
const METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS'
const CALL = new RegExp(`\\b(?:app|router|server)\\.(${METHODS.toLowerCase()})\\(\\s*(['"\`])([^'"\`]+)\\2\\s*(?:,\\s*([A-Za-z_$][\\w$]*))?`)
const TUPLE = new RegExp(`\\[\\s*['"](${METHODS})['"]\\s*,\\s*(?:(['"\`])([^'"\`]+)\\2|/((?:\\\\/|[^/])+)/[a-z]*)\\s*,\\s*('(?:all|session)'|"(?:all|session)"|\\[[^\\]]*\\])`)

export function regexToPath(src) {
  let n = 0
  return src.replace(/^\^/, '').replace(/\$$/, '').replace(/\([^)]*\)/g, () => `:p${++n}`).replace(/\\\//g, '/').replace(/\\(.)/g, '$1')
}
const parseAllow = (raw) => {
  const t = raw.trim()
  if (/^['"](all|session)['"]$/.test(t)) return t.slice(1, -1)
  const arr = /^\[([^\]]*)\]$/.exec(t)
  if (arr) return arr[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  return null
}
export function extract(text, file, cfg) {
  const routes = [], guards = cfg.router?.guards ?? {}
  text.split(/\r?\n/).forEach((l, i) => {
    let m = CALL.exec(l)
    if (m) { routes.push({ method: m[1].toUpperCase(), path: m[3], allow: (m[4] && guards[m[4]]) || 'all', from: `${file}:${i + 1}` }); return }
    m = TUPLE.exec(l)
    if (m) { const allow = parseAllow(m[5]); if (allow) routes.push({ method: m[1], path: m[3] ?? regexToPath(m[4]), allow, from: `${file}:${i + 1}` }) }
  })
  return routes
}
