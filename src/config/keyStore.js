/**
 * Per-user provider settings: which provider is active, which model, and the
 * API key.
 *
 * Every function takes the signed-in user, because one account's key must
 * never be readable by another. The key is encrypted before it is stored, so
 * the database holds no usable credentials.
 */

import { readDoc, writeDoc } from '../lib/store.js';
import { decryptSecret, encryptSecret } from '../lib/secrets.js';
import { isAuthConfigured } from '../middleware/clerkAuth.js';

const COLLECTION = 'config';
const DOC_ID = 'app';

/**
 * Environment variable consulted only when sign-in is switched off, which is
 * local development. A deployment gives every user their own key; handing out
 * the owner's key to whoever signs up is exactly what accounts prevent.
 */
const ENV_KEY_BY_PROVIDER = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

const DEFAULT_CONFIG = {
  activeProvider: 'gemini',
  providers: {},
};

/**
 * One write chain per user, so two requests cannot clobber each other.
 *
 * There is deliberately no cache of the config itself. A serverless host runs
 * many instances at once: one caching a key it read earlier will keep using it
 * after another instance has replaced it, so swapping an exhausted key appears
 * to do nothing. Reading the document per request is one small query and is
 * always right.
 */
const writeChains = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function readFromStore(userId) {
  const parsed = await readDoc(userId, COLLECTION, DOC_ID);
  if (!parsed) return clone(DEFAULT_CONFIG);
  return {
    activeProvider: parsed.activeProvider || DEFAULT_CONFIG.activeProvider,
    providers: parsed.providers && typeof parsed.providers === 'object' ? parsed.providers : {},
  };
}

/** Queues a write so overlapping requests apply in order. */
function persist(userId, config) {
  const previous = writeChains.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => writeDoc(userId, COLLECTION, DOC_ID, config));
  writeChains.set(userId, next);
  return next;
}

/**
 * Loads a user's config, seeding from the environment only in local mode.
 * Seeding happens once: after the first write the store is the source of truth.
 */
export async function load(userId) {
  const config = await readFromStore(userId);
  let seeded = false;

  if (!isAuthConfigured) {
    for (const [providerId, envVar] of Object.entries(ENV_KEY_BY_PROVIDER)) {
      const envKey = (process.env[envVar] || '').trim();
      if (!envKey) continue;
      if (config.providers[providerId]?.apiKey) continue;
      config.providers[providerId] = {
        ...config.providers[providerId],
        apiKey: encryptSecret(envKey),
        source: 'env',
        updatedAt: new Date().toISOString(),
      };
      seeded = true;
    }
  }

  if (seeded) await persist(userId, clone(config));
  return config;
}

export async function getActiveProviderId(userId) {
  const config = await load(userId);
  return config.activeProvider;
}

export async function setActiveProviderId(userId, providerId) {
  const config = await load(userId);
  config.activeProvider = providerId;
  await persist(userId, clone(config));
  return config.activeProvider;
}

/** The stored settings for one provider, without the key itself. */
export async function getProviderConfig(userId, providerId) {
  const config = await load(userId);
  const stored = config.providers[providerId];
  if (!stored) return null;
  const { apiKey, ...rest } = stored;
  return { ...rest, hasKey: Boolean(apiKey) };
}

export async function getApiKey(userId, providerId) {
  const config = await load(userId);
  const stored = config.providers[providerId]?.apiKey;
  if (!stored) return null;
  return decryptSecret(stored);
}

/** The masked form, for showing which key is in use without revealing it. */
export async function getMaskedKey(userId, providerId) {
  const key = await getApiKey(userId, providerId);
  return maskKey(key);
}

export async function setApiKey(userId, providerId, apiKey) {
  const config = await load(userId);
  config.providers[providerId] = {
    ...config.providers[providerId],
    apiKey: encryptSecret(apiKey),
    source: 'settings',
    updatedAt: new Date().toISOString(),
  };
  await persist(userId, clone(config));
  return getProviderConfig(userId, providerId);
}

export async function clearApiKey(userId, providerId) {
  const config = await load(userId);
  const existing = config.providers[providerId];
  if (!existing) return false;
  delete existing.apiKey;
  delete existing.source;
  existing.updatedAt = new Date().toISOString();
  await persist(userId, clone(config));
  return true;
}

export async function setProviderModel(userId, providerId, model) {
  const config = await load(userId);
  config.providers[providerId] = {
    ...config.providers[providerId],
    model,
    updatedAt: new Date().toISOString(),
  };
  await persist(userId, clone(config));
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
