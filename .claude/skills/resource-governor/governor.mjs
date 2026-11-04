#!/usr/bin/env node
// Resource governor: one machine, several Claude sessions or sub-agents. Heavy jobs take a named lock first and wait
// until it is free AND enough RAM is free, so parallel work does not overload the PC. Cross-platform, no deps.
//   node governor.mjs status
//   node governor.mjs acquire <lock> <owner> [timeoutMin]     exit 0 = you hold it, 2 = timeout
//   node governor.mjs release <lock> <owner>
// Env: GOVERNOR_DIR (lock folder, default <tmp>/claude-governor), GOVERNOR_MIN_FREE_GB (default 6),
//      GOVERNOR_STALE_MIN (default 90), GOVERNOR_POLL_SEC (default 30).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = process.env.GOVERNOR_DIR || path.join(os.tmpdir(), 'claude-governor')
const MIN_FREE = Number(process.env.GOVERNOR_MIN_FREE_GB || 6) * 2 ** 30
const STALE = Number(process.env.GOVERNOR_STALE_MIN || 90) * 60000
const POLL = Number(process.env.GOVERNOR_POLL_SEC || 30) * 1000
const NAME = /^[a-z0-9][a-z0-9._-]{0,40}$/i
const [cmd, lock, owner, timeoutMin = '60'] = process.argv.slice(2)
const file = (l) => path.join(DIR, `${l}.lock`)
const read = (l) => { try { return JSON.parse(fs.readFileSync(file(l), 'utf8')) } catch { return null } }
const stale = (h) => !h || Date.now() - h.at > STALE
const gb = (b) => (b / 2 ** 30).toFixed(1)
fs.mkdirSync(DIR, { recursive: true })

function status() {
  const locks = fs.readdirSync(DIR).filter((f) => f.endsWith('.lock')).map((f) => { const l = f.slice(0, -5), h = read(l); return { lock: l, owner: h?.owner, minutes: h ? Math.round((Date.now() - h.at) / 60000) : null, stale: stale(h) } })
  return { freeRamGB: gb(os.freemem()), totalRamGB: gb(os.totalmem()), cpus: os.cpus().length, load1: os.loadavg()[0], minFreeGB: gb(MIN_FREE), locks }
}

function tryTake() {
  const h = read(lock)
  if (h && !stale(h) && h.owner !== owner) return `held by ${h.owner} for ${Math.round((Date.now() - h.at) / 60000)} min`
  if (os.freemem() < MIN_FREE) return `free RAM ${gb(os.freemem())} GB < ${gb(MIN_FREE)} GB`
  if (h && stale(h)) fs.rmSync(file(lock), { force: true })
  try { fs.writeFileSync(file(lock), JSON.stringify({ owner, at: Date.now(), pid: process.ppid }), { flag: h?.owner === owner ? 'w' : 'wx' }); return null } catch { return 'raced: someone took it' }
}

if (cmd === 'status') console.log(JSON.stringify(status(), null, 1))
else if (cmd === 'acquire' || cmd === 'release') {
  if (!NAME.test(lock ?? '') || !NAME.test(owner ?? '')) { console.error('usage: acquire|release <lock> <owner> [timeoutMin]'); process.exit(1) }
  if (cmd === 'release') {
    const h = read(lock)
    if (h && h.owner !== owner) { console.error(`${lock} is held by ${h.owner}, not ${owner}: not released`); process.exit(1) }
    fs.rmSync(file(lock), { force: true }); console.log(`released ${lock}`)
  } else {
    const deadline = Date.now() + Number(timeoutMin) * 60000
    for (;;) {
      const why = tryTake()
      if (!why) { console.log(`acquired ${lock} for ${owner}`); break }
      if (Date.now() > deadline) { console.error(`timeout waiting for ${lock}: ${why}`); process.exit(2) }
      console.error(`waiting for ${lock}: ${why}`)
      await new Promise((r) => setTimeout(r, POLL))
    }
  }
} else { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')) }
