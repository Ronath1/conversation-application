/**
 * Provider registry and the single entry point the rest of the app calls.
 *
 * The adapter interface every provider must implement:
 *
 *   id                     string   stable slug, used in config and URLs
 *   label                  string   name shown in the UI
 *   defaultModel           string
 *   freeTierDailyRequests  number   for the app-side usage estimate
 *   envVar                 string   env var that seeds the key on first boot
 *   keyHint                string   help text for the settings panel
 *   keyUrl                 string   where a user gets a key of their own
 *   generateReply(params)  -> { text, model, finishReason, usage }
 *   validateKey(apiKey)    -> { valid, reason?, warning? }
 *   listModels(apiKey)     -> [{ id, label, free? }] the key can actually use
 *
 * `generateReply` takes { apiKey, messages, systemPrompt, model, temperature,
 * maxOutputTokens, json, responseSchema, lowLatency, timeoutMs, signal } and
 * must throw a ProviderError, never a raw provider error. Options are stated
 * as intent, not as one provider's parameter names: `lowLatency` means "answer
 * fast", and each adapter decides how its provider achieves that.
 *
 * Adding a provider is: write one adapter file, add it to ADAPTERS. Nothing
 * else in the app changes.
 */

import geminiAdapter from './gemini.js';
import claudeAdapter from './claude.js';
import openaiAdapter from './openai.js';
import openrouterAdapter from './openrouter.js';
import { ErrorCode, ProviderError } from './errors.js';
import * as keyStore from '../config/keyStore.js';
import * as usageStore from '../usage/usageStore.js';

const ADAPTERS = [geminiAdapter, claudeAdapter, openaiAdapter, openrouterAdapter];

const byId = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function listAdapters() {
  return [...byId.values()];
}

export function hasAdapter(providerId) {
  return byId.has(providerId);
}

export function getAdapter(providerId) {
  const adapter = byId.get(providerId);
  if (!adapter) {
    throw new ProviderError(ErrorCode.UNKNOWN_PROVIDER, `Unknown provider "${providerId}".`, {
      provider: providerId,
    });
  }
  return adapter;
}

/** Resolves the adapter, its stored key and its model in one step. */
export async function resolveProvider(userId, providerId) {
  const id = providerId || (await keyStore.getActiveProviderId(userId));
  const adapter = getAdapter(id);
  const stored = await keyStore.getProviderConfig(userId, id);
  return {
    adapter,
    apiKey: await keyStore.getApiKey(userId, id),
    model: stored?.model || adapter.defaultModel,
  };
}

/**
 * The one function the rest of the app uses to talk to an AI.
 * It does not know or care which provider is behind the active config.
 *
 * @param {object} params
 * @param {Array<{role: 'user'|'assistant', content: string}>} params.messages
 * @param {string} params.userId Whose key and settings to use.
 * @param {string} [params.provider] Defaults to the active provider.
 * @param {string} [params.systemPrompt]
 * @returns {Promise<{provider: string, model: string, text: string, usage: object, finishReason: string|null}>}
 */
export async function getAiReply({ userId, provider, messages, systemPrompt, ...options } = {}) {
  const { adapter, apiKey, model } = await resolveProvider(userId, provider);

  if (!apiKey) {
    throw new ProviderError(ErrorCode.MISSING_KEY, undefined, { provider: adapter.id });
  }

  // Counted around the call itself: a rejected request still spent a request.
  // Key validation is not counted, because it is not a reply.
  try {
    const result = await adapter.generateReply({
      apiKey,
      messages,
      systemPrompt,
      model: options.model || model,
      ...options,
    });
    await usageStore.recordRequest(userId, adapter.id, { ok: true });
    return { provider: adapter.id, ...result };
  } catch (error) {
    await usageStore.recordRequest(userId, adapter.id, { ok: false, code: error.code });
    throw error;
  }
}

export { ErrorCode, ProviderError };
