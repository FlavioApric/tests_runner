// Playwright config of the example: everything comes from qa.config.json (projects, preview, shards, reporters).
import { packConfig } from '../../qa-pack/lib/playwright-config.mjs'

export default packConfig(import.meta.dirname)
