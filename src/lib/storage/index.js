'use strict';
/**
 * File storage for photos, renders, proposals, leases, COCs, invoices and POs.
 * Driver: local disk on the HostyAfrica server (STORAGE_DIR, outside the web root).
 * Files are never served directly: routes check the user's role, then stream the file,
 * or external pages use a signed, expiring link from signedUrl().
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ROOT = process.env.STORAGE_DIR || path.join(__dirname, '../../../storage');
const SECRET = process.env.STORAGE_SIGNING_SECRET || '';

const safeKey = (key) => {
  const k = path.posix.normalize(String(key)).replace(/^\/+/, '');
  if (k.startsWith('..') || k.includes('\0')) throw new Error('Invalid storage key');
  return k;
};

async function put(buffer, { folder, ext }) {
  const now = new Date();
  const key = safeKey(`${folder}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}${ext ? '.' + ext.replace(/^\./, '') : ''}`);
  const full = path.join(ROOT, key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, buffer, { flag: 'wx', mode: 0o640 });
  return key;
}

const get = (key) => fsp.readFile(path.join(ROOT, safeKey(key)));
const stream = (key) => fs.createReadStream(path.join(ROOT, safeKey(key)));
const remove = (key) => fsp.rm(path.join(ROOT, safeKey(key)), { force: true });

function signedUrl(key, ttlSeconds = 900) {
  if (!SECRET) throw new Error('STORAGE_SIGNING_SECRET is not set');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = crypto.createHmac('sha256', SECRET).update(`${safeKey(key)}:${exp}`).digest('base64url');
  return `/files/${encodeURIComponent(safeKey(key))}?exp=${exp}&sig=${sig}`;
}

function verifySignature(key, exp, sig) {
  if (!SECRET || !exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expected = crypto.createHmac('sha256', SECRET).update(`${safeKey(key)}:${exp}`).digest('base64url');
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

module.exports = { put, get, stream, remove, signedUrl, verifySignature, ROOT };
