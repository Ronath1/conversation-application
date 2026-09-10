/**
 * App-side request counting.
 *
 * Providers do not expose "requests remaining", so the only honest number the
 * app can show is the one it counts itself: how many replies it asked for
 * today, against the published free-tier limit. It is an estimate. Requests
 * made outside this app, from the same key, are invisible to it.
 */

import { readDoc, writeDoc } from '../lib/store.js';

const COLLECTION = 'usage';

/** Days of history kept. Enough for a weekly look back, small to store. */
const RETAIN_DAYS = 30;

/** One write chain per user. */
const writeChains = new Map();

/** Local calendar date, because a daily quota resets on the provider's clock, not UTC. */
export function today() {
  return new Date().toLocaleDateString('en-CA');
}

function emptyDay() {
  return { requests: 0, failures: 0, rateLimited: 0 };
}

/**
 * One document per provider, holding that provider's days.
 *
 * Read fresh on every call rather than cached: on a serverless host the next
 * request may run in a different process, and a stale count would overwrite a
 * newer one.
 */
async function readProvider(userId, providerId) {
  const stored = await readDoc(userId, COLLECTION, providerId);
  return stored && typeof stored.days === 'object' ? stored : { days: {} };
}

function prune(days) {
  const keep = new Set();
  const now = new Date();
  for (let i = 0; i < RETAIN_DAYS; i += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    keep.add(day.toLocaleDateString('en-CA'));
  }
  for (const date of Object.keys(days)) {
    if (!keep.has(date)) delete days[date];
  }
}

/**
 * Records one reply request. Counted whether it succeeded or not, because a
 * rejected request still counted against the provider's limit.
 *
 * @param {string} providerId
 * @param {object} [outcome]
 * @param {boolean} [outcome.ok]
 * @param {string} [outcome.code] Error code, when the request failed.
 */
export async function recordRequest(userId, providerId, { ok = true, code } = {}) {
  // Queued so two turns finishing together cannot both write the same count.
  const previous = writeChains.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const usage = await readProvider(userId, providerId);
    const day = (usage.days[today()] ||= emptyDay());

    day.requests += 1;
    if (!ok) day.failures += 1;
    if (code === 'RATE_LIMITED' || code === 'QUOTA_EXHAUSTED') day.rateLimited += 1;
    day.lastAt = new Date().toISOString();

    prune(usage.days);
    await writeDoc(userId, COLLECTION, providerId, usage);
    return day;
  });

  writeChains.set(userId, next);
  return next;
}

export async function getDay(userId, providerId, date = today()) {
  const usage = await readProvider(userId, providerId);
  return { ...emptyDay(), ...(usage.days[date] || {}) };
}

/** Recent days, oldest first, for a small history in the settings panel. */
export async function getRecentDays(userId, providerId, dayCount = 7) {
  const usage = await readProvider(userId, providerId);
  const now = new Date();
  const out = [];

  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const key = date.toLocaleDateString('en-CA');
    out.push({ date: key, ...emptyDay(), ...(usage.days[key] || {}) });
  }
  return out;
}
