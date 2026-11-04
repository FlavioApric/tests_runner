// Sealed results: X25519 (ephemeral) + HKDF-SHA256 + AES-256-GCM, Node built-ins only.
// The runners hold only the PUBLIC key (a repo variable, not a secret); the private key stays on the owner's PC.
// File format: "QAF1" | ephemeral public key (32) | iv (12) | ciphertext ... | GCM tag (16)
import crypto from 'node:crypto'
import fs from 'node:fs'
import { pipeline } from 'node:stream/promises'

const MAGIC = Buffer.from('QAF1')
const INFO = Buffer.from('qa-fleet results v1')
const b64u = (b) => Buffer.from(b).toString('base64url')

export function generateKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519')
  const pub = publicKey.export({ format: 'jwk' }).x
  const sec = privateKey.export({ format: 'jwk' }).d
  return { recipient: `qafpub1:${pub}`, identity: `qafsec1:${sec}:${pub}` }
}

function pubKey(recipient) {
  const m = /^qafpub1:([A-Za-z0-9_-]{43})$/.exec(String(recipient).trim())
  if (!m) throw new Error('recipient must look like qafpub1:<43 chars>')
  return { key: crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: m[1] }, format: 'jwk' }), raw: Buffer.from(m[1], 'base64url') }
}

function secKey(identity) {
  const m = /^qafsec1:([A-Za-z0-9_-]{43}):([A-Za-z0-9_-]{43})$/.exec(String(identity).trim())
  if (!m) throw new Error('identity must look like qafsec1:<d>:<x>')
  return { key: crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'X25519', d: m[1], x: m[2] }, format: 'jwk' }), raw: Buffer.from(m[2], 'base64url') }
}

function derive(shared, ephRaw, recRaw) {
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.concat([ephRaw, recRaw]), INFO, 32))
}

export async function sealFile(inPath, outPath, recipient) {
  const rec = pubKey(recipient)
  const eph = crypto.generateKeyPairSync('x25519')
  const ephRaw = Buffer.from(eph.publicKey.export({ format: 'jwk' }).x, 'base64url')
  const key = derive(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: rec.key }), ephRaw, rec.raw)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const fd = fs.openSync(outPath, 'w')
  try {
    fs.writeSync(fd, Buffer.concat([MAGIC, ephRaw, iv]))
    for await (const chunk of fs.createReadStream(inPath)) fs.writeSync(fd, cipher.update(chunk))
    fs.writeSync(fd, cipher.final())
    fs.writeSync(fd, cipher.getAuthTag())
  } finally { fs.closeSync(fd) }
}

export async function openFile(inPath, outPath, identity) {
  const id = secKey(identity)
  const size = fs.statSync(inPath).size
  if (size < 4 + 32 + 12 + 16) throw new Error('sealed file too short')
  const fd = fs.openSync(inPath, 'r')
  const head = Buffer.alloc(48); fs.readSync(fd, head, 0, 48, 0)
  const tag = Buffer.alloc(16); fs.readSync(fd, tag, 0, 16, size - 16)
  fs.closeSync(fd)
  if (!head.subarray(0, 4).equals(MAGIC)) throw new Error('not a qa-fleet sealed file')
  const ephRaw = head.subarray(4, 36), iv = head.subarray(36, 48)
  const ephPub = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(ephRaw) }, format: 'jwk' })
  const key = derive(crypto.diffieHellman({ privateKey: id.key, publicKey: ephPub }), ephRaw, id.raw)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const tmp = `${outPath}.part`
  await pipeline(fs.createReadStream(inPath, { start: 48, end: size - 17 }), decipher, fs.createWriteStream(tmp))
  fs.renameSync(tmp, outPath)
}

// in-memory variant (small payloads such as the sealed card): same format, base64url text
export function sealBuffer(buf, recipient) {
  const rec = pubKey(recipient)
  const eph = crypto.generateKeyPairSync('x25519')
  const ephRaw = Buffer.from(eph.publicKey.export({ format: 'jwk' }).x, 'base64url')
  const key = derive(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: rec.key }), ephRaw, rec.raw)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(buf), cipher.final()])
  return Buffer.concat([MAGIC, ephRaw, iv, body, cipher.getAuthTag()]).toString('base64url')
}

export function openBuffer(text, identity) {
  const id = secKey(identity)
  const all = Buffer.from(String(text).trim(), 'base64url')
  if (all.length < 64 || !all.subarray(0, 4).equals(MAGIC)) throw new Error('not a qa-fleet sealed value')
  const ephRaw = all.subarray(4, 36), iv = all.subarray(36, 48), tag = all.subarray(all.length - 16)
  const ephPub = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: b64u(ephRaw) }, format: 'jwk' })
  const key = derive(crypto.diffieHellman({ privateKey: id.key, publicKey: ephPub }), ephRaw, id.raw)
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  try { return Buffer.concat([d.update(all.subarray(48, all.length - 16)), d.final()]) } catch { throw new Error('cannot open the sealed value: wrong key or damaged data') }
}
