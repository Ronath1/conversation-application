/**
 * Sign-in requirement.
 *
 * Every request that reads or writes anything must name a user, because all
 * stored data — the provider key, the conversations, the mistake report — is
 * owned by one account and must never be visible to another.
 *
 * The browser holds a Clerk session and sends a short-lived token with each
 * request. This verifies that token's signature against Clerk and pulls the
 * user id out of it. The token is checked cryptographically, so a forged one
 * is rejected without asking Clerk anything.
 */

import { verifyToken } from '@clerk/backend';
import { ErrorCode, ProviderError } from '../providers/errors.js';

const SECRET_KEY = (process.env.CLERK_SECRET_KEY || '').trim();

export const isAuthConfigured = Boolean(SECRET_KEY);

/**
 * Used when Clerk is not configured, so a developer running the app locally
 * with no Clerk keys still gets a working, single-user app. It is never used
 * when CLERK_SECRET_KEY is set, which is what any deployment must set.
 */
const LOCAL_USER = 'local-dev';

function unauthorized(res, message) {
  res.status(401).json({ error: { code: 'UNAUTHORIZED', message } });
}

/** Reads the bearer token the frontend attaches to every request. */
function bearerToken(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

export async function requireUser(req, res, next) {
  if (!isAuthConfigured) {
    req.userId = LOCAL_USER;
    return next();
  }

  const token = bearerToken(req);
  if (!token) return unauthorized(res, 'Sign in to use this app.');

  try {
    const claims = await verifyToken(token, { secretKey: SECRET_KEY });
    if (!claims?.sub) return unauthorized(res, 'That session is not valid. Sign in again.');
    req.userId = claims.sub;
    return next();
  } catch (error) {
    // An expired token is the normal case: the browser refreshes and retries.
    return unauthorized(res, 'That session has expired. Sign in again.');
  }
}

/**
 * Reads the signed-in user for code below the middleware. Throws rather than
 * returning nothing, so a route that forgets to require sign-in cannot quietly
 * read another account's data.
 */
export function userIdOf(req) {
  if (!req.userId) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'No signed-in user on this request.', { status: 401 });
  }
  return req.userId;
}

/** Tells the frontend how to sign in, before it has a session. */
export function authConfig() {
  return {
    enabled: isAuthConfigured,
    publishableKey: (process.env.CLERK_PUBLISHABLE_KEY || '').trim() || null,
  };
}
