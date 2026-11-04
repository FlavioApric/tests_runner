#!/usr/bin/env node
// Example app server: serves web/ and a tiny JSON API. Demo only: users and passwords are public demo values in seed.json.
//   node api/server.mjs [--port 4317]
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createStore, countLabel } from './notes.mjs'

const DIR = path.resolve(import.meta.dirname, '..')
const PORT = Number(process.env.PORT || (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4317))
const seed = JSON.parse(fs.readFileSync(path.join(DIR, 'api', 'seed.json'), 'utf8'))
const store = createStore()
const sessions = new Map()
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' }

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(JSON.stringify(body))
}
const readBody = (req) => new Promise((resolve) => {
  let b = ''
  req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy() })
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}) } catch { resolve(null) } })
})
export function sessionOf(req) {
  const sid = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1]
  return sid ? sessions.get(sid) ?? null : null
}

// route table: [method, pattern, allow, handler]; allow = 'all' | 'session' | [roles]  (read by the access-matrix router adapter)
const routes = [
  ['GET', '/api/health', 'all', (req, res) => send(res, 200, { ok: true })],
  ['POST', '/api/login', 'all', async (req, res) => {
    const b = await readBody(req)
    const u = seed.users.find((x) => x.user === b?.user && x.password === b?.password)
    if (!u) return send(res, 401, { error: 'Invalid credentials' })
    const sid = crypto.randomBytes(16).toString('hex')
    sessions.set(sid, { user: u.user, role: u.role })
    send(res, 200, { user: u.user, role: u.role }, { 'set-cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` })
  }],
  ['GET', '/api/me', 'session', (req, res, s) => send(res, 200, s)],
  ['GET', '/api/notes', 'session', (req, res, s) => { const list = store.list(s.user); send(res, 200, { notes: list, label: countLabel(list.length) }) }],
  ['POST', '/api/notes', 'session', async (req, res, s) => {
    const b = await readBody(req)
    const r = store.add(s.user, b?.title)
    return r.ok ? send(res, 201, r.note) : send(res, 400, { error: r.error })
  }],
  ['DELETE', /^\/api\/notes\/([a-z0-9]+)$/, 'session', (req, res, s, m) => (store.remove(s.user, m[1]) ? send(res, 204, {}) : send(res, 404, { error: 'Not found' }))],
  ['GET', '/api/admin/stats', ['admin'], (req, res) => send(res, 200, store.stats())],
]

export function allowed(allow, s) {
  if (allow === 'all') return 200
  if (!s) return 401
  if (allow === 'session') return 200
  return allow.includes(s.role) ? 200 : 403
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname.startsWith('/api/')) {
    for (const [method, pat, allow, handler] of routes) {
      const m = typeof pat === 'string' ? (pat === url.pathname ? [pat] : null) : pat.exec(url.pathname)
      if (!m || method !== req.method) continue
      const s = sessionOf(req), code = allowed(allow, s)
      if (code === 401) return send(res, 401, { error: 'Sign in required' })
      if (code === 403) return send(res, 403, { error: 'Forbidden' })
      return handler(req, res, s, m)
    }
    return send(res, 404, { error: 'Not found' })
  }
  const file = path.join(DIR, 'web', url.pathname === '/' ? 'index.html' : path.normalize(url.pathname).replace(/^([/\\])+/, ''))
  if (!file.startsWith(path.join(DIR, 'web')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found') }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})

server.listen(PORT, '127.0.0.1', () => console.log(`tiny-app on http://127.0.0.1:${PORT}`))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)))
