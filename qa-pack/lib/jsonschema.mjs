// Minimal JSON Schema (draft 2020-12 subset) validator: type, const, enum, required, properties,
// additionalProperties (boolean or schema), items, minItems, pattern, minimum, maximum, allOf, $ref (#/...).
// Enough for qa.config.schema.json and the qa-fleet units schema; no dependency.
export function validate(schema, data, root = schema, at = '$') {
  const errs = []
  const s = schema.$ref ? resolve(root, schema.$ref) : schema
  const type = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v)
  if (s.type) {
    const t = type(data), ok = [s.type].flat().some((x) => x === t || (x === 'number' && t === 'integer'))
    if (!ok) { errs.push(`${at}: expected ${[s.type].flat().join('|')}, got ${t}`); return errs }
  }
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(data)) errs.push(`${at}: must equal ${JSON.stringify(s.const)}`)
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(data))) errs.push(`${at}: must be one of ${JSON.stringify(s.enum)}`)
  if (typeof data === 'string' && s.pattern && !new RegExp(s.pattern, 'u').test(data)) errs.push(`${at}: "${data}" does not match /${s.pattern}/`)
  if (typeof data === 'number') {
    if (s.minimum !== undefined && data < s.minimum) errs.push(`${at}: ${data} < minimum ${s.minimum}`)
    if (s.maximum !== undefined && data > s.maximum) errs.push(`${at}: ${data} > maximum ${s.maximum}`)
  }
  if (Array.isArray(data)) {
    if (s.minItems !== undefined && data.length < s.minItems) errs.push(`${at}: needs at least ${s.minItems} item(s)`)
    if (s.items) data.forEach((v, i) => errs.push(...validate(s.items, v, root, `${at}[${i}]`)))
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const k of s.required ?? []) if (!(k in data)) errs.push(`${at}: missing required "${k}"`)
    for (const [k, v] of Object.entries(data)) {
      if (s.properties?.[k]) errs.push(...validate(s.properties[k], v, root, `${at}.${k}`))
      else if (s.additionalProperties === false) errs.push(`${at}: unknown property "${k}"`)
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') errs.push(...validate(s.additionalProperties, v, root, `${at}.${k}`))
    }
  }
  for (const sub of s.allOf ?? []) errs.push(...validate(sub, data, root, at))
  return errs
}

function resolve(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`only local $ref supported: ${ref}`)
  return ref.slice(2).split('/').reduce((o, k) => o[k.replace(/~1/g, '/').replace(/~0/g, '~')], root)
}
