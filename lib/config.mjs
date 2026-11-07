// Local state on YOUR PC: no tokens, no card. The gh CLI login is the only credential a session needs.
//   ~/.qa-fleet/identity.key   private key that opens the sealed results (created by  fleet keygen)
//   ~/.qa-fleet/runs/<runId>/  decrypted results
// QA_FLEET_HOME moves that folder; QA_FLEET_REPO names the home repo (default: this checkout's origin).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

export const fleetHome = () => process.env.QA_FLEET_HOME || path.join(os.homedir(), '.qa-fleet')

export function localConfig() {
  const h = fleetHome()
  return { outDir: path.join(h, 'runs'), identityPath: path.join(h, 'identity.key') }
}

// owner/name of the home repo (the one with fleet.yml and the App key)
export function homeRepo() {
  if (process.env.QA_FLEET_REPO) return process.env.QA_FLEET_REPO
  const dir = path.join(import.meta.dirname, '..')
  const r = spawnSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' })
  const m = /github\.com[:/]([\w.-]+\/[\w.-]+?)(\.git)?\s*$/.exec(r.stdout ?? '')
  if (!m) throw new Error('cannot tell the home repo: set QA_FLEET_REPO=owner/tests_runner or run from a clone of it')
  return m[1]
}

export function identityOf(c) {
  if (c.identity) return c.identity.trim()
  if (fs.existsSync(c.identityPath)) return fs.readFileSync(c.identityPath, 'utf8').trim()
  throw new Error(`private result key not found (${c.identityPath}): run  node cli/fleet.mjs keygen`)
}

export function checkRepo(name, v) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(v ?? '')) throw new Error(`${name} must be owner/name, got "${v ?? ''}"`)
  return v
}
