// J02 Access: compiled from qa/browser-tests/access/J02-access.md (4 steps) + a replay of every cell of
// qa/access/matrix.json (generated from the router by qa-pack/scripts/access-matrix.mjs).
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { expectDesign } from '../../../../qa-pack/lib/designContract.mjs'
import { cfg, stateOf, userOf, api, notesOf, cleanNotes } from './support.mjs'

const P = 'QA J02 '
const matrix = JSON.parse(fs.readFileSync(cfg.abs('access'), 'utf8'))
const SIGN_IN_REQUIRED = 'Sign in required', FORBIDDEN = 'Forbidden' // docs/SPEC.md 2.1, 2.4
const concrete = (p) => p.replace(/:p\d+/g, 'n0missing')

// the guard result of one call: 'status:401' / 'status:403' when the guard refused, 'allow' when it let the call through
async function guardOf(ctx, method, url) {
  const r = await ctx.fetch(url, { method, data: method === 'GET' || method === 'DELETE' ? undefined : {} })
  const body = await r.json().catch(() => ({}))
  if (r.status() === 401 && body.error === SIGN_IN_REQUIRED) return 'status:401'
  if (r.status() === 403 && body.error === FORBIDDEN) return 'status:403'
  return 'allow'
}

test.describe('J02 access @J02', () => {
  test.afterAll(async () => { await cleanNotes('MEMBER', P) })

  test('R2-001 a guest gets 401 "Sign in required" on every session route and sees the sign-in form', async ({ browser }) => {
    const guest = await browser.newContext({ storageState: stateOf('GUEST') })
    const page = await guest.newPage()
    const r = await page.request.get('/api/notes')
    expect(r.status()).toBe(401)
    expect((await r.json()).error).toBe(SIGN_IN_REQUIRED)
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expect(page.locator('#notes')).toBeHidden()
    await expectDesign(page, 'notes-home', { keys: ['signIn'] })
    const sessionRoutes = matrix.routes.filter((x) => x.allow !== 'all')
    expect(sessionRoutes.length).toBe(5) // every guarded route of the router, total asserted
    for (const x of sessionRoutes) expect(await guardOf(page.request, x.method, concrete(x.path)), `${x.method} ${x.path}`).toBe('status:401')
    await guest.close()
  })

  test('R2-002 wrong credentials get 401 "Invalid credentials" and the page stays signed out', async ({ browser }) => {
    const guest = await browser.newContext({ storageState: stateOf('GUEST') })
    const page = await guest.newPage()
    await page.goto('/')
    await page.getByLabel('User').fill(userOf('MEMBER'))
    await page.getByLabel('Password').fill('wrong-password-for-the-test')
    const [resp] = await Promise.all([page.waitForResponse('**/api/login'), page.getByRole('button', { name: 'Sign in' }).click()])
    expect(resp.status()).toBe(401)
    await expect(page.getByRole('alert').first()).toHaveText('Invalid credentials')
    await expect(page.locator('#notes')).toBeHidden()
    expect((await page.request.get('/api/me')).status()).toBe(401)
    await guest.close()
  })

  test('R2-003 deleting the note of another member answers 404 like a missing note, and the note survives', async () => {
    const a = await api('MEMBER'), b = await api('MEMBER_B')
    const created = await (await a.post('/api/notes', { data: { title: `${P}keep` } })).json()
    const other = await b.delete(`/api/notes/${created.id}`), missing = await b.delete('/api/notes/n0missing')
    expect(other.status()).toBe(404)
    expect([other.status(), await other.text()]).toEqual([missing.status(), await missing.text()]) // no existence oracle
    expect((await notesOf(a)).map((n) => n.id)).toContain(created.id)
    await a.dispose(); await b.dispose()
  })

  test('R2-004 admin stats: guest 401, members 403, admin 200', async () => {
    const want = { GUEST: 401, MEMBER: 403, MEMBER_B: 403, ADMIN: 200 }
    for (const [key, status] of Object.entries(want)) {
      const ctx = await api(key)
      expect((await ctx.get('/api/admin/stats')).status(), key).toBe(status)
      await ctx.dispose()
    }
  })

  test('R2-001 R2-004 every cell of the access matrix matches the router', async () => {
    expect(matrix.cells.length).toBe(matrix.routes.length * matrix.personas.length)
    expect(matrix.cells.length).toBe(28)
    const wrong = []
    for (const c of matrix.cells) {
      const ctx = await api(c.persona)
      const got = await guardOf(ctx, c.method, concrete(c.path))
      if (got !== c.expect) wrong.push(`${c.method} ${c.path} as ${c.persona}: expected ${c.expect}, got ${got}`)
      await ctx.dispose()
    }
    expect(wrong).toEqual([])
    // negative proof: a cell that claims a member can read the admin stats must be caught
    const ctx = await api('MEMBER')
    expect(await guardOf(ctx, 'GET', '/api/admin/stats')).not.toBe('allow')
    await ctx.dispose()
  })
})
