// Signs every persona with a session in once, through the real sign-in form, and saves its storage state.
// Credentials come only from the environment (qa.config env.personasFile, here the public demo example file).
import { test as setup, expect } from '@playwright/test'
import path from 'node:path'
import { loadConfig } from '../../../../qa-pack/lib/config.mjs'
import { signedInPersonas, credentials, authFile } from '../../../../qa-pack/lib/personas.mjs'

const cfg = loadConfig(path.resolve(import.meta.dirname, '../..'))

for (const p of signedInPersonas(cfg)) {
  setup(`sign in ${p.key}`, async ({ page }) => {
    const { user, password } = credentials(cfg, p.key)
    await page.goto('/')
    await page.getByLabel('User').fill(user)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.locator('#who')).toHaveText(user)
    await page.context().storageState({ path: authFile(cfg, p.key) })
  })
}
