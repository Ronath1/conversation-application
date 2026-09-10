/**
 * Sign-in, sign-up and the session token.
 *
 * Clerk is loaded from a CDN at runtime rather than bundled, because this app
 * has no build step. The publishable key comes from the backend instead of
 * being written into the page, so the same files work in development and in
 * production without editing.
 *
 * When the backend reports that sign-in is switched off — local development
 * with no Clerk keys — everything here becomes a no-op and the app runs as a
 * single-user tool.
 */

const CLERK_SCRIPT = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';

let clerk = null;
let enabled = false;
const listeners = new Set();

function loadScript(publishableKey) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CLERK_SCRIPT;
    script.async = true;
    script.crossOrigin = 'anonymous';
    // Clerk's loader reads the key from its own script tag.
    script.setAttribute('data-clerk-publishable-key', publishableKey);
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load the sign-in library.')));
    document.head.append(script);
  });
}

/**
 * Loads Clerk if the backend says sign-in is required.
 *
 * @returns {Promise<{enabled: boolean, signedIn: boolean, error?: string}>}
 */
export async function initAuth() {
  let config;
  try {
    config = await (await fetch('/api/auth/config')).json();
  } catch {
    return { enabled: false, signedIn: true, error: 'Could not reach the server.' };
  }

  if (!config.enabled || !config.publishableKey) {
    enabled = false;
    return { enabled: false, signedIn: true };
  }

  enabled = true;

  try {
    await loadScript(config.publishableKey);
    // The loader may leave the class or a ready-made instance on window.
    const exported = window.Clerk;
    clerk = typeof exported === 'function' ? new exported(config.publishableKey) : exported;
    await clerk.load();
  } catch (error) {
    return { enabled: true, signedIn: false, error: error.message };
  }

  clerk.addListener(() => {
    for (const listener of listeners) listener(Boolean(clerk.user));
  });

  return { enabled: true, signedIn: Boolean(clerk.user) };
}

/** Called whenever the user signs in or out. */
export function onAuthChange(listener) {
  listeners.add(listener);
}

export function isSignedIn() {
  return !enabled || Boolean(clerk?.user);
}

/** The current user's display name, for the header. */
export function currentUserLabel() {
  if (!clerk?.user) return null;
  return (
    clerk.user.primaryEmailAddress?.emailAddress ||
    clerk.user.username ||
    clerk.user.firstName ||
    'Signed in'
  );
}

/** A fresh session token, or null when sign-in is switched off. */
export async function getToken() {
  if (!enabled || !clerk?.session) return null;
  try {
    return await clerk.session.getToken();
  } catch {
    return null;
  }
}

/**
 * Each form gets its own container and is mounted once. Sharing one container
 * and unmounting between them leaves Clerk with a node it no longer owns, and
 * the second form silently fails to appear.
 */
export function mountSignIn(element) {
  clerk?.mountSignIn(element);
}

export function mountSignUp(element) {
  clerk?.mountSignUp(element);
}

export async function signOut() {
  await clerk?.signOut();
}
