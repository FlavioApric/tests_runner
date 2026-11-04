// Backend adapter "supabase" (optional): layers for a LOCAL Supabase stack (never production).
//   migrations  backend.migrationsCmd run twice: the second pass must also succeed (idempotent migrations)
//   sql         every *.test.sql in backend.sql through psql inside stack.dbContainer (ON_ERROR_STOP, one transaction
//               per file; pgTAP files work as-is)
//   edge        every *.test.mjs in backend.edge with node --test, env QA_FUNCTIONS_URL = backend.functionsUrl
// Capabilities: docker + stack (the stack is started by stack.up; this adapter does not start it).
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { walk } from '../../lib/util.mjs'

const list = (cfg, dir, re) => (dir ? walk(path.join(cfg.dir, dir), (p) => re.test(p)).map((p) => cfg.rel(p)) : [])

export function layers(cfg) {
  const b = cfg.backend, db = cfg.stack.dbContainer
  const sql = list(cfg, b.sql, /\.test\.sql$/), edge = list(cfg, b.edge, /\.test\.m?js$/)
  return [
    {
      name: 'migrations', what: 'migrations apply twice', requires: ['docker', 'stack'], files: b.migrationsCmd ? ['qa.config.json'] : [],
      run: (c) => { for (const pass of [1, 2]) { console.log(`migrations pass ${pass}: ${b.migrationsCmd}`); const r = spawnSync(b.migrationsCmd, { cwd: c.dir, shell: true, stdio: 'inherit' }); if (r.status !== 0) return 1 } return 0 },
    },
    {
      name: 'sql', what: `psql in ${db ?? '(stack.dbContainer not set)'}`, requires: ['docker', 'stack'], files: sql,
      run: (c) => {
        if (!db) { console.log('stack.dbContainer is not set in qa.config.json'); return 1 }
        let bad = 0
        for (const f of sql) {
          const r = spawnSync('docker', ['exec', '-i', db, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-q', '-f', '-'], { cwd: c.dir, input: fs.readFileSync(path.join(c.dir, f), "utf8"), encoding: 'utf8', maxBuffer: 64 << 20 })
          console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f}`); if (r.status !== 0) { bad++; console.log((r.stderr || r.stdout).split('\n').slice(-20).join('\n')) }
        }
        return bad ? 1 : 0
      },
    },
    {
      name: 'edge', what: `node --test against ${b.functionsUrl ?? '(backend.functionsUrl not set)'}`, requires: ['docker', 'stack', 'personas'], files: edge,
      run: (c) => spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...edge], { cwd: c.dir, stdio: 'inherit', env: { ...process.env, QA_FUNCTIONS_URL: b.functionsUrl ?? '' } }).status ?? 1,
    },
  ]
}

