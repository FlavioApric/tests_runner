// Personas: names come from qa.config.json, values only from the environment (<PREFIX><KEY>_USER / _PASSWORD),
// loaded from env.personasFile (gitignored). Values are never printed or written to reports.
import fs from 'node:fs'
import path from 'node:path'

export function loadPersonaEnv(cfg) {
  const local = cfg.env?.personasFile && path.join(cfg.dir, cfg.env.personasFile)
  const example = cfg.env?.personasExample && path.join(cfg.dir, cfg.env.personasExample)
  const file = [local, example].find((f) => f && fs.existsSync(f))
  if (file) process.loadEnvFile(file)
  return file ? path.basename(file) : null
}

export const signedInPersonas = (cfg) => cfg.personas.filter((p) => p.session !== false)

export function credentials(cfg, key) {
  const user = process.env[cfg.personaVar(key, 'USER')], password = process.env[cfg.personaVar(key, 'PASSWORD')]
  if (!user || !password) throw new Error(`persona ${key}: ${cfg.personaVar(key, 'USER')} / ${cfg.personaVar(key, 'PASSWORD')} not set (fill ${cfg.env?.personasFile ?? 'the personas env file'})`)
  return { user, password }
}

export const authDir = (cfg) => cfg.abs(cfg.paths.auth ?? '.qa-pack/auth')
export const authFile = (cfg, key) => path.join(authDir(cfg), `${key.toLowerCase()}.json`)
