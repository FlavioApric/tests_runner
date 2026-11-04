// Router adapter "json": the routes are written in qa.config router.routes: [{ method?, path, allow }].
export function extract(_text, _file, cfg) {
  return (cfg.router?.routes ?? []).map((r, i) => ({ method: (r.method ?? 'GET').toUpperCase(), path: r.path, allow: r.allow ?? 'all', from: `qa.config.json router.routes[${i}]` }))
}
