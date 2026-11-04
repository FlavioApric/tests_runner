// Builds the Playwright config of a project from its qa.config.json (S6 "plans", browser part).
//  - one `setup` project signs every persona in once (storageState, https://playwright.dev/docs/auth)
//  - one test project per qa.config playwright.projects entry (device + optional grep)
//  - webServer from preview.start; retries always 0 (a flaky test is a defect, never retried green)
//  - sharding: `npx playwright test --shard=i/N` with QA_BLOB=1 (or CI) writes blob-report/, then
//    `npx playwright merge-reports --reporter html,junit <dir-with-all-blobs>` merges the shards
import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { loadConfig } from './config.mjs'
import { loadPersonaEnv } from './personas.mjs'

export function packConfig(projectDir) {
  const cfg = loadConfig(projectDir)
  loadPersonaEnv(cfg)
  process.env.QA_PROJECT_DIR = cfg.dir
  process.env.QA_CONTRACT_DIR = cfg.abs('contracts')
  const evidence = cfg.abs('evidence')
  const blob = process.env.QA_BLOB === '1' || (!!process.env.CI && process.env.QA_BLOB !== '0')
  const reporter = blob
    ? [['list'], ['blob', { outputDir: path.join(cfg.dir, 'blob-report') }]]
    : [['list'], ['html', { outputFolder: path.join(evidence, 'html-report'), open: 'never' }], ['json', { outputFile: path.join(evidence, 'results.json') }], ['junit', { outputFile: process.env.PLAYWRIGHT_JUNIT_OUTPUT_NAME ?? path.join(evidence, 'junit.xml') }]]
  const setupMatch = /auth\.setup\.m?[jt]s$/
  return defineConfig({
    testDir: cfg.abs('compiled'),
    testMatch: /.*\.(spec|setup)\.m?[jt]s$/,
    outputDir: path.join(cfg.dir, 'test-results'),
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    workers: cfg.playwright.workers,
    reporter,
    use: { baseURL: cfg.preview.url, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    webServer: cfg.preview.start ? { command: cfg.preview.start, cwd: cfg.dir, url: cfg.preview.url, reuseExistingServer: cfg.preview.reuse ?? !process.env.CI, timeout: cfg.preview.timeoutMs ?? 60000 } : undefined,
    projects: [
      { name: 'setup', testMatch: setupMatch },
      ...cfg.playwright.projects.map((p) => {
        if (!devices[p.device]) throw new Error(`qa.config playwright.projects ${p.name}: unknown device "${p.device}"`)
        return { name: p.name, use: { ...devices[p.device], ...(p.use ?? {}) }, dependencies: ['setup'], testIgnore: setupMatch, ...(p.grep ? { grep: new RegExp(p.grep) } : {}) }
      }),
    ],
  })
}
