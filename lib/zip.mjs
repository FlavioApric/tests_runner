// Minimal ZIP reader (stored + deflate), enough for GitHub artifact downloads. No dependencies.
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

export function unzipToDir(buf, dir) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('zip: end of central directory not found')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const files = []
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory entry')
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20)
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/')) continue
    const safe = path.normalize(name).replace(/^(\.\.[\\/])+/, '')
    if (path.isAbsolute(safe) || safe.startsWith('..')) throw new Error(`zip: unsafe path ${name}`)
    const lnl = buf.readUInt16LE(local + 26), lxl = buf.readUInt16LE(local + 28)
    const data = buf.subarray(local + 30 + lnl + lxl, local + 30 + lnl + lxl + csize)
    const out = method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null
    if (!out) throw new Error(`zip: unsupported method ${method}`)
    const target = path.join(dir, safe)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, out)
    files.push(target)
  }
  return files
}
