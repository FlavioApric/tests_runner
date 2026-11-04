// Router adapter "react-router": <Route path="/x" element={<Guard ...>} /> and { path: '/x', element: <Guard> } objects.
// A route is guarded by the first qa.config router.guards name that appears on the same line (or the next 3 lines
// of the same element); guards map to roles | 'all' | 'session'. No guard = 'all'. Method is always GET (a page).
const PATH = /\bpath\s*[:=]\s*\{?\s*(['"`])([^'"`]+)\1/
export function extract(text, file, cfg) {
  const routes = [], guards = Object.entries(cfg.router?.guards ?? {}), lines = text.split(/\r?\n/)
  lines.forEach((l, i) => {
    const m = PATH.exec(l)
    if (!m) return
    const win = lines.slice(i, i + 4).join(' ')
    const g = guards.find(([name]) => new RegExp(`<\\s*${name}\\b|\\b${name}\\s*\\(`).test(win))
    routes.push({ method: 'GET', path: m[2].startsWith('/') ? m[2] : `/${m[2]}`, allow: g ? g[1] : 'all', from: `${file}:${i + 1}` })
  })
  return routes
}
