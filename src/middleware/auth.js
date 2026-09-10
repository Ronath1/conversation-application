/**
 * Password gate.
 *
 * The app holds an API key that costs money to use and a history of everything
 * the user has said, and it has no accounts. On a public URL that is enough to
 * warrant a lock, even a simple one.
 *
 * Set APP_PASSWORD to switch it on. With it unset the app is open, which is
 * what local development wants. Anywhere reachable from the internet, set it.
 *
 * Uses HTTP Basic authentication: the browser shows its own prompt and repeats
 * the credentials on later requests, so there is no login page, no cookie and
 * no session to store. The password is only as private as the connection, so
 * this belongs behind HTTPS.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

const PASSWORD = (process.env.APP_PASSWORD || '').trim();
const REALM = 'English Conversation Practice';

export const isPasswordSet = Boolean(PASSWORD);

/**
 * Compares two strings without leaking their length or contents through how
 * long the comparison takes. Hashing first makes both sides the same size.
 */
function matches(supplied, expected) {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function challenge(res) {
  res.set('WWW-Authenticate', `Basic realm="${REALM}", charset="UTF-8"`);
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'This app is password protected.' } });
}

export function requirePassword(req, res, next) {
  if (!PASSWORD) return next();

  const header = req.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme !== 'Basic' || !encoded) return challenge(res);

  let decoded;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return challenge(res);
  }

  // Basic sends "user:password". Any user name is accepted; only the password
  // matters, so there is nothing to remember but the one secret.
  const separator = decoded.indexOf(':');
  const supplied = separator === -1 ? '' : decoded.slice(separator + 1);

  if (supplied && matches(supplied, PASSWORD)) return next();
  return challenge(res);
}
