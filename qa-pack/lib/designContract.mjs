// Test-runner wrapper of the design-contract checker: fails with the full list of mismatches
// (colour, size, text, href, contrast, image resolution). Used by every compiled spec for its "Design contract:" lines.
import { expect } from '@playwright/test'
import { verifyContract } from './designContractCore.mjs'

export async function expectDesign(page, screen, opts = {}) {
  const fails = await verifyContract(page, screen, opts)
  expect(fails, `design contract "${screen}":\n${fails.join('\n')}`).toEqual([])
}
