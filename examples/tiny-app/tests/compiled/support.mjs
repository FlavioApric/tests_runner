// Shared helpers of the example's compiled specs: persona contexts and idempotent cleanup through the API.
import path from 'node:path'
import { request } from '@playwright/test'
import { loadConfig } from '../../../../qa-pack/lib/config.mjs'
import { authFile, credentials } from '../../../../qa-pack/lib/personas.mjs'

export const cfg = loadConfig(path.resolve(import.meta.dirname, '../..'))
export const stateOf = (key) => (key === 'GUEST' ? { cookies: [], origins: [] } : authFile(cfg, key))
export const userOf = (key) => credentials(cfg, key).user
export const api = (key) => request.newContext({ baseURL: cfg.preview.url, storageState: stateOf(key) })

// the spec's oracle: the count label computed from a number, independently of the app (docs/SPEC.md 1.3)
export const expectedLabel = (n) => (n === 1 ? '1 note' : `${n} notes`)

export async function notesOf(ctx) {
  const r = await ctx.get('/api/notes')
  if (r.status() !== 200) throw new Error(`GET /api/notes ${r.status()}`)
  return (await r.json()).notes
}

// delete the persona's notes (all of them when prefix is null); returns how many were deleted
export async function cleanNotes(key, prefix = null) {
  const ctx = await api(key)
  try {
    let n = 0
    for (const note of await notesOf(ctx)) if (prefix === null || note.title.startsWith(prefix)) { await ctx.delete(`/api/notes/${note.id}`); n++ }
    return n
  } finally { await ctx.dispose() }
}
