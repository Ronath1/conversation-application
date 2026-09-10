/**
 * The one way this app talks to its own backend.
 *
 * Every request carries the signed-in user's session token, so a screen cannot
 * accidentally ask for data without saying who is asking. The token is
 * short-lived and fetched per request; Clerk refreshes it behind the scenes.
 */

import { getToken } from './auth.js';

export async function apiFetch(path, options = {}) {
  const token = await getToken();

  const headers = { ...options.headers };
  if (options.body) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    error.status = response.status;
    throw error;
  }
  return payload;
}
