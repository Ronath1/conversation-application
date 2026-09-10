/**
 * App-side request counting.
 *
 * Providers do not expose "requests remaining", so the only honest number the
 * app can show is the one it counts itself: how many replies it asked for
 * today, against the published free-tier limit. It is an estimate. Requests
 * made outside this app, from the same key, are invisible to it.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from '../lib/jsonFile.js';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const USAGE_PATH = path.join(ROOT_DIR, 'data', 'usage.json');

/** Days of history kept. Enough for a weekly look back, small on disk. */
const RETAIN_DAYS = 30;

let cache = null;
let writeChain = Promise.resolve();

/** Local calendar date, because a daily quota resets on the provider's clock, not UTC. */
export function today() {
  return new Date().toLocaleDateString('en-CA');
}

async function load() {
  if (!cache) cache = (await readJson(USAGE_PATH, null)) || { providers: {} };
  if (!cache.providers) cache.providers = {};
  return cache;
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

function persist(snapshot) {
  writeChain = writeChain.then(
    () => writeJsonAtomic(USAGE_PATH, snapshot),
    () => writeJsonAtomic(USAGE_PATH, snapshot),
  );
  return writeChain;
}

function emptyDay() {
  return { requests: 0, failures: 0, rateLimited: 0 };
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
export async function recordRequest(providerId, { ok = true, code } = {}) {
  const usage = await load();
  const days = (usage.providers[providerId] ||= {});
  const day = (days[today()] ||= emptyDay());

  day.requests += 1;
  if (!ok) day.failures += 1;
  if (code === 'RATE_LIMITED' || code === 'QUOTA_EXHAUSTED') day.rateLimited += 1;
  day.lastAt = new Date().toISOString();

  prune(days);
  await persist(JSON.parse(JSON.stringify(usage)));
  return day;
}

export async function getDay(providerId, date = today()) {
  const usage = await load();
  return { ...emptyDay(), ...(usage.providers[providerId]?.[date] || {}) };
}

/** Recent days, oldest first, for a small history in the settings panel. */
export async function getRecentDays(providerId, dayCount = 7) {
  const usage = await load();
  const days = usage.providers[providerId] || {};
  const now = new Date();
  const out = [];

  for (let i = dayCount - 1; i >= 0; i -= 1) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const key = date.toLocaleDateString('en-CA');
    out.push({ date: key, ...emptyDay(), ...(days[key] || {}) });
  }
  return out;
}

export function resetCache() {
  cache = null;
}
