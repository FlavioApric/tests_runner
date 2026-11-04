// Backend adapter "node-test": the project's API/domain tests run with the built-in node test runner.
// qa.config backend.tests = a dir (or file) of *.test.mjs / *.test.js; one layer "api".
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { walk } from '../../lib/util.mjs'

export function layers(cfg) {
  const dir = cfg.backend.tests ?? 'tests'
  const files = walk(path.join(cfg.dir, dir), (p) => /\.test\.m?[jt]s$/.test(p)).map((p) => cfg.rel(p))
  return [{
    name: 'api', what: `node --test ${dir}`, requires: ['node'], files,
    run: (c) => spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd: c.dir, stdio: 'inherit' }).status ?? 1,
  }]
}
