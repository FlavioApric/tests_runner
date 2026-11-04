// J01 Notes basics: compiled from qa/browser-tests/notes/J01-notes-basics.md (8 steps).
// Runs at mobile 390x844 dpr 2 and at desktop (@all): oracle 6 of qa-pack/conventions.md.
import { test, expect } from '@playwright/test'
import { expectDesign } from '../../../../qa-pack/lib/designContract.mjs'
import { cfg, stateOf, userOf, api, notesOf, cleanNotes, expectedLabel } from './support.mjs'

const P = 'QA J01 '
const SPEC_MESSAGE = 'Title must be 1-80 characters' // docs/SPEC.md 1.2

test.describe('J01 notes basics @J01 @all', () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ storageState: stateOf('MEMBER') })

  test.beforeEach(async () => { await cleanNotes('MEMBER'); await cleanNotes('MEMBER_B') })
  test.afterAll(async () => { await cleanNotes('MEMBER', P); await cleanNotes('MEMBER_B', P) })

  // synchronise on the app's own signals (POST answered, form reset on success), never on sleeps
  const add = async (page, title) => {
    const input = page.getByLabel('Note title')
    await input.fill(title)
    const posted = page.waitForResponse((r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api/notes')
    await page.getByRole('button', { name: 'Add note' }).click()
    const r = await posted
    if (r.ok()) await expect(input).toHaveValue('')
    return r
  }
  const rows = (page) => page.getByRole('list', { name: 'Notes' }).locator('li > span')

  test('R1-001 a new note appears at the top of the list, trimmed; 80 characters are kept whole', async ({ page }, info) => {
    await page.goto('/')
    await add(page, `  ${P}first  `)
    await expect(rows(page)).toHaveText([`${P}first`])
    await add(page, `${P}second`)
    const typed = [`${P}second`, `${P}first`] // newest first, trimmed by the test
    await expect(rows(page)).toHaveText(typed)
    await expect(rows(page)).not.toHaveText([...typed].reverse()) // negative proof: the reverse order must not match
    const long = (P + 'x'.repeat(80)).slice(0, 80)
    await add(page, long)
    await expect(rows(page).first()).toHaveText(long)
    expect((await rows(page).allTextContents()).length).toBe(3)
    await page.screenshot({ path: cfg.abs('evidence') + `/cases/J01-notes-basics/01.${info.project.name}.png` })
    await expectDesign(page, 'notes-home', { keys: ['addNote'] })
  })

  test('R1-002 empty, blank and 81-character titles show the spec message and save nothing', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('count')).toHaveText(expectedLabel(0))
    for (const bad of ['', '   ', P + 'y'.repeat(81)]) {
      await add(page, bad)
      await expect(page.locator('#note-error')).toHaveText(SPEC_MESSAGE)
    }
    await expect(rows(page)).toHaveCount(0)
    const ctx = await api('MEMBER'); expect(await notesOf(ctx)).toHaveLength(0); await ctx.dispose()
  })

  test('R1-003 the count label follows the number of notes', async ({ page }) => {
    await page.goto('/')
    const ctx = await api('MEMBER')
    for (const [i, title] of ['', `${P}one`, `${P}two`].entries()) {
      if (title) await add(page, title)
      await expect(rows(page)).toHaveCount(i)
      const n = (await notesOf(ctx)).length
      expect(n).toBe(i)
      await expect(page.getByTestId('count')).toHaveText(expectedLabel(n))
    }
    await ctx.dispose()
    await expectDesign(page, 'notes-home', { keys: ['count'] })
  })

  test('R1-004 deleting one of my notes removes only that note and the count drops by one', async ({ page }) => {
    await page.goto('/')
    await add(page, `${P}keep`); await add(page, `${P}delete-me`)
    await expect(page.getByTestId('count')).toHaveText(expectedLabel(2))
    const ctx = await api('MEMBER')
    const before = await notesOf(ctx), gone = before.find((n) => n.title === `${P}delete-me`), kept = before.find((n) => n.title === `${P}keep`)
    await page.getByRole('button', { name: `Delete ${P}delete-me` }).click()
    await expect(rows(page)).toHaveText([`${P}keep`])
    await expect(page.getByTestId('count')).toHaveText(expectedLabel(1))
    expect((await notesOf(ctx)).map((n) => n.id)).toEqual([kept.id])
    await page.reload()
    await expect(rows(page)).toHaveText([`${P}keep`]) // negative proof: the deleted note does not come back
    expect((await notesOf(ctx)).some((n) => n.id === gone.id)).toBe(false)
    await ctx.dispose()
  })

  test('R1-005 a member never sees the notes of another member', async ({ page, browser }) => {
    await page.goto('/')
    await add(page, `${P}private`)
    await expect(rows(page)).toHaveText([`${P}private`]) // positive control: the owner sees it
    const b = await browser.newContext({ storageState: stateOf('MEMBER_B') })
    const pb = await b.newPage()
    await pb.goto('/')
    await expect(pb.locator('#who')).toHaveText(userOf('MEMBER_B'))
    await expect(pb.getByTestId('count')).toHaveText(expectedLabel(0))
    await expect(pb.getByText(`${P}private`)).toHaveCount(0)
    await b.close()
    const ctx = await api('MEMBER_B')
    const list = await notesOf(ctx)
    expect(list.filter((n) => n.owner !== userOf('MEMBER_B'))).toEqual([]) // every row, not a sample
    expect(list).toHaveLength(0)
    await ctx.dispose()
  })

  test('R3-001 the header is "Tiny Notes", 24px bold, white on the brand blue', async ({ page, browser }) => {
    await page.goto('/')
    await expectDesign(page, 'notes-home', { keys: ['header', 'headerBar'] })
    const guest = await browser.newContext({ storageState: stateOf('GUEST') })
    const pg = await guest.newPage(); await pg.goto('/')
    await expect(pg.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expectDesign(pg, 'notes-home', { keys: ['header', 'headerBar'] })
    await guest.close()
  })

  test('R3-002 every button is at least 44x44 CSS px, signed in and signed out', async ({ page, browser }) => {
    const MIN = 44
    const tooSmall = async (pg, min) => {
      const out = []
      for (const b of await pg.getByRole('button').all()) {
        if (!(await b.isVisible())) continue
        const box = await b.boundingBox()
        if (box.width < min || box.height < min) out.push(`${await b.textContent()} ${Math.round(box.width)}x${Math.round(box.height)}`)
      }
      return out
    }
    // CSS px only mean real size when the page is not zoomed out: no horizontal overflow at the project's width
    const noOverflow = async (pg) => expect(await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)
    await page.goto('/')
    await noOverflow(page)
    await add(page, `${P}a`); await add(page, `${P}b`)
    await expect(rows(page)).toHaveCount(2)
    const visible = await page.getByRole('button').filter({ visible: true }).count()
    expect(visible).toBe(3) // Add note + 2 Delete: every button, total asserted
    expect(await tooSmall(page, MIN)).toEqual([])
    expect((await tooSmall(page, 1000)).length).toBe(visible) // negative proof: an impossible threshold must flag every button
    const guest = await browser.newContext({ storageState: stateOf('GUEST') })
    const pg = await guest.newPage(); await pg.goto('/')
    await expect(pg.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await noOverflow(pg)
    expect(await tooSmall(pg, MIN)).toEqual([])
    await expectDesign(pg, 'notes-home', { keys: ['signIn'] })
    await guest.close()
    await expectDesign(page, 'notes-home', { keys: ['addNote'] })
  })

  test('R3-003 text and button labels have a contrast of at least 4.5:1', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#who')).toHaveText(userOf('MEMBER'))
    await expectDesign(page, 'notes-home', { keys: ['who', 'count', 'addNote'] })
  })
})
