/**
 * Persistent config store for API keys and per-provider settings.
 *
 * The key lives in data/config.json, not in code and not in the environment
 * beyond first-boot seeding, so the settings endpoint can swap it at runtime
 * without a restart or redeploy. Writes are atomic (temp file + rename) so a
 * crash mid-write cannot leave a truncated config behind.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from '../lib/jsonFile.js';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

/** Environment variable consulted once, only if a provider has no stored key. */
const ENV_KEY_BY_PROVIDER = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
};

const DEFAULT_CONFIG = {
  activeProvider: 'gemini',
  providers: {},
};

/** In-memory copy of the config. Written through on every change. */
let cache = null;
/** Serializes concurrent writes so two requests cannot clobber each other. */
let writeChain = Promise.resolve();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readFromDisk() {
  const parsed = await readJson(CONFIG_PATH, null);
  if (!parsed) return clone(DEFAULT_CONFIG);
  return {
    activeProvider: parsed.activeProvider || DEFAULT_CONFIG.activeProvider,
    providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
  };
}

/** Queues a write so overlapping requests apply in order. */
function persist(config) {
  writeChain = writeChain.then(
    () => writeJsonAtomic(CONFIG_PATH, config),
    () => writeJsonAtomic(CONFIG_PATH, config),
  );
  return writeChain;
}

/**
 * Loads config from disk and seeds any missing key from the environment.
 * Seeding happens once: after the first write the file is the source of truth.
 */
export async function load() {
  if (cache) return cache;

  const config = await readFromDisk();
  let seeded = false;

  for (const [providerId, envVar] of Object.entries(ENV_KEY_BY_PROVIDER)) {
    const envKey = (process.env[envVar] || '').trim();
    if (!envKey) continue;
    if (config.providers[providerId]?.apiKey) continue;
    config.providers[providerId] = {
      ...config.providers[providerId],
      apiKey: envKey,
      source: 'env',
      updatedAt: new Date().toISOString(),
    };
    seeded = true;
  }

  cache = config;
  if (seeded) await persist(clone(cache));
  return cache;
}

/** Drops the in-memory copy. Used by tests. */
export function resetCache() {
  cache = null;
}

export function getConfigPath() {
  return CONFIG_PATH;
}

export async function getActiveProviderId() {
  const config = await load();
  return config.activeProvider;
}

export async function setActiveProviderId(providerId) {
  const config = await load();
  config.activeProvider = providerId;
  await persist(clone(config));
  return config.activeProvider;
}

export async function getProviderConfig(providerId) {
  const config = await load();
  return config.providers[providerId] ? clone(config.providers[providerId]) : null;
}

export async function getApiKey(providerId) {
  const config = await load();
  const key = config.providers[providerId]?.apiKey;
  return key ? String(key) : null;
}

export async function setApiKey(providerId, apiKey) {
  const config = await load();
  config.providers[providerId] = {
    ...config.providers[providerId],
    apiKey,
    source: 'settings',
    updatedAt: new Date().toISOString(),
  };
  await persist(clone(config));
  return clone(config.providers[providerId]);
}

export async function clearApiKey(providerId) {
  const config = await load();
  const existing = config.providers[providerId];
  if (!existing) return false;
  delete existing.apiKey;
  delete existing.source;
  existing.updatedAt = new Date().toISOString();
  await persist(clone(config));
  return true;
}

export async function setProviderModel(providerId, model) {
  const config = await load();
  config.providers[providerId] = {
    ...config.providers[providerId],
    model,
    updatedAt: new Date().toISOString(),
  };
  await persist(clone(config));
  return model;
}

/**
 * Shows enough of a key to tell two keys apart, never enough to use one.
 * This is the only shape a key may take in an HTTP response.
 */
export function maskKey(apiKey) {
  if (!apiKey) return null;
  const key = String(apiKey);
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 4)}${'•'.repeat(6)}${key.slice(-4)}`;
}
