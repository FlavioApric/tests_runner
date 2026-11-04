// Domain logic of the example app: a per-user notes store. Pure functions, no I/O.
export const TITLE_MIN = 1
export const TITLE_MAX = 80
export const TITLE_ERROR = 'Title must be 1-80 characters'

export function validateTitle(raw) {
  const title = String(raw ?? '').trim()
  if (title.length < TITLE_MIN || title.length > TITLE_MAX) return { ok: false, error: TITLE_ERROR }
  return { ok: true, title }
}

export function createStore() {
  let seq = 0
  const notes = new Map()
  return {
    add(owner, rawTitle, now = Date.now()) {
      const v = validateTitle(rawTitle)
      if (!v.ok) return v
      const note = { id: `n${++seq}`, owner, title: v.title, createdAt: new Date(now).toISOString() }
      notes.set(note.id, note)
      return { ok: true, note }
    },
    list(owner) {
      return [...notes.values()].filter((n) => n.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id.slice(1)) - Number(a.id.slice(1)))
    },
    remove(owner, id) {
      const n = notes.get(id)
      if (!n || n.owner !== owner) return false // another user's note looks exactly like a missing one (no IDOR oracle)
      notes.delete(id)
      return true
    },
    stats() { return { notes: notes.size, owners: new Set([...notes.values()].map((n) => n.owner)).size } },
  }
}

export const countLabel = (n) => `${n} ${n === 1 ? 'note' : 'notes'}`
