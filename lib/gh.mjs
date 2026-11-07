// The gh CLI, with secrets only on stdin or in env, never in argv. Errors are returned with tokens redacted.
import { spawnSync } from 'node:child_process'

export const defaultExec = (cmd, args, o = {}) => spawnSync(cmd, args, { input: o.input, encoding: 'utf8', env: { ...process.env, GH_PROMPT_DISABLED: '1', ...o.env }, maxBuffer: 64 * 1024 * 1024 })

export function gh(args, { input, token, exec = defaultExec } = {}) {
  const r = exec('gh', args, { input, env: token ? { GH_TOKEN: token, GH_HOST: 'github.com' } : {} })
  if (r.error?.code === 'ENOENT') throw new Error('the GitHub CLI (gh) is not installed: https://cli.github.com')
  const redact = (s) => (token ? String(s ?? '').split(token).join('***') : String(s ?? ''))
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')}: ${redact(r.stderr).trim().split('\n').pop() || `exit ${r.status}`}`)
  return redact(r.stdout)
}
