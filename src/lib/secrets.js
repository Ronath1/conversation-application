/**
 * Encryption for stored API keys.
 *
 * Once people other than the owner sign in, the database holds other people's
 * provider keys. Those are credentials that cost money to misuse, so they are
 * encrypted at rest rather than stored as plain text: a leaked database dump
 * is then not a list of working keys.
 *
 * AES-256-GCM, which authenticates as well as encrypts, so a tampered value
 * fails to decrypt instead of returning something wrong.
 *
 * ENCRYPTION_KEY holds 32 bytes as 64 hex characters. Generate one with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Losing that value means every stored key becomes unreadable and every user
 * has to paste theirs again. Changing it has the same effect.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const PREFIX = 'encv1';

function readKey() {
  const raw = (process.env.ENCRYPTION_KEY || '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
  }
  return key;
}

export const isEncryptionConfigured = Boolean((process.env.ENCRYPTION_KEY || '').trim());

/**
 * Encrypts a secret for storage.
 *
 * With no ENCRYPTION_KEY set the value is returned unchanged, so local
 * development needs no setup. Anywhere holding someone else's key, set it.
 */
export function encryptSecret(plainText) {
  const key = readKey();
  if (!key || !plainText) return plainText;

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

/**
 * Reverses encryptSecret. Values stored before encryption was switched on are
 * returned as they are, so switching it on does not break what is already
 * saved; those values are re-encrypted the next time they are written.
 */
export function decryptSecret(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(`${PREFIX}.`)) return stored;

  const key = readKey();
  if (!key) {
    throw new Error('A stored key is encrypted but ENCRYPTION_KEY is not set.');
  }

  const [, ivPart, tagPart, dataPart] = stored.split('.');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
}
