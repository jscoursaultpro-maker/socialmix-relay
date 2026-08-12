/**
 * utils/base62.js — Encode/decode MongoDB ObjectId (24-char hex) ↔ base62
 *
 * Usage:
 *   encodeObjectId('6691a2b3c4d5e6f7a8b9c0d1') → '1mJ5K7pQ8rS9tU0v2'
 *   decodeToObjectId('1mJ5K7pQ8rS9tU0v2')      → '6691a2b3c4d5e6f7a8b9c0d1'
 *
 * URL-safe, no special characters, ~17 chars output.
 */

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Encode a 24-char hex string (Mongo ObjectId) to base62.
 * @param {string} hexId — e.g. '6691a2b3c4d5e6f7a8b9c0d1'
 * @returns {string} — base62 encoded, zero-padded to 17 chars
 */
export function encodeObjectId(hexId) {
  if (typeof hexId !== 'string' || !/^[0-9a-f]{24}$/i.test(hexId)) {
    throw new Error('INVALID_OBJECT_ID');
  }
  let n = BigInt('0x' + hexId);
  let out = '';
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out;
    n = n / 62n;
  }
  return out.padStart(17, '0');
}

/**
 * Decode a base62 string back to a 24-char hex ObjectId.
 * @param {string} base62 — e.g. '1mJ5K7pQ8rS9tU0v2'
 * @returns {string} — 24-char lowercase hex
 */
export function decodeToObjectId(base62) {
  if (typeof base62 !== 'string' || base62.length === 0) {
    throw new Error('INVALID_BASE62');
  }
  let n = 0n;
  for (const c of base62) {
    const idx = BASE62.indexOf(c);
    if (idx === -1) throw new Error('INVALID_BASE62');
    n = n * 62n + BigInt(idx);
  }
  const hex = n.toString(16).padStart(24, '0');
  if (hex.length > 24) throw new Error('INVALID_BASE62');
  return hex;
}
