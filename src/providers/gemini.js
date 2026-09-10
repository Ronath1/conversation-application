/**
 * Gemini adapter.
 *
 * Implements the shared adapter interface documented in providers/index.js.
 * Everything Gemini-specific — wire format, header name, error shapes — stops
 * at this file. Talks to the REST API directly with fetch, so there is no SDK
 * to keep in step with.
 */

import { ErrorCode, ProviderError } from './errors.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const DEFAULT_TIMEOUT_MS = 30_000;

const id = 'gemini';

/**
 * Smallest thinking allowance used for a low-latency turn. Not zero: the
 * Gemini 3 models reject a budget of 0 outright, so a small positive budget is
 * the one setting that means "think as little as possible" on every model.
 */
const LOW_LATENCY_THINKING_BUDGET = 128;

/** Turns the app's neutral message list into the `contents` array Gemini wants. */
function toContents(messages) {
  return messages
    .filter((message) => message && typeof message.content === 'string' && message.content.trim())
    .map((message) => ({
      role: message.role === 'assistant' || message.role === 'model' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));
}

/** Pulls the human-readable reason out of the provider error envelope. */
function describeError(payload, fallback) {
  const error = payload && payload.error;
  if (!error) return fallback;
  const status = error.status ? `${error.status}: ` : '';
  return `${status}${error.message || fallback}`;
}

function mapHttpError(response, payload) {
  const detail = describeError(payload, `HTTP ${response.status}`);
  const status = response.status;
  const reason = payload?.error?.status || '';
  const message = String(payload?.error?.message || '');

  if (status === 400 && /api[_ ]?key/i.test(message)) {
    return new ProviderError(ErrorCode.INVALID_KEY, undefined, { provider: id, detail });
  }
  if (status === 401 || status === 403) {
    return new ProviderError(ErrorCode.INVALID_KEY, undefined, { provider: id, detail });
  }
  if (status === 429) {
    const retryAfter = Number(response.headers.get('retry-after')) || undefined;
    const code = /quota/i.test(message) ? ErrorCode.QUOTA_EXHAUSTED : ErrorCode.RATE_LIMITED;
    return new ProviderError(code, undefined, { provider: id, detail, retryAfter });
  }
  if (status === 400 || status === 404 || reason === 'INVALID_ARGUMENT') {
    return new ProviderError(ErrorCode.BAD_REQUEST, `The provider rejected the request. ${detail}`, {
      provider: id,
      detail,
    });
  }
  if (status >= 500) {
    return new ProviderError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, { provider: id, detail });
  }
  return new ProviderError(ErrorCode.PROVIDER_ERROR, undefined, { provider: id, detail });
}

async function callGemini(pathname, { apiKey, method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, signal }) {
  let response;
  try {
    response = await fetch(`${API_BASE}${pathname}`, {
      method,
      headers: {
        'x-goog-api-key': apiKey,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new ProviderError(
      ErrorCode.NETWORK_ERROR,
      timedOut ? 'The provider did not respond in time.' : 'Could not reach the provider.',
      { provider: id, cause: error },
    );
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) throw mapHttpError(response, payload);
  if (!payload) {
    throw new ProviderError(ErrorCode.PROVIDER_ERROR, 'The provider returned an unreadable response.', {
      provider: id,
      detail: text.slice(0, 500),
    });
  }
  return payload;
}

/**
 * Sends conversation history and returns one reply.
 *
 * @param {object} params
 * @param {string} params.apiKey
 * @param {Array<{role: 'user'|'assistant', content: string}>} params.messages
 * @param {string} [params.systemPrompt] Persona and task instructions.
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @param {number} [params.maxOutputTokens]
 * @param {boolean} [params.json] Ask for a JSON reply (used by the corrections flow).
 * @param {object} [params.responseSchema] JSON schema the reply must match.
 * @param {boolean} [params.lowLatency] Trade depth for speed on a spoken turn.
 * @param {number} [params.thinkingBudget] Thinking tokens. Overrides lowLatency when set.
 * @returns {Promise<{text: string, model: string, finishReason: string|null, usage: object}>}
 */
async function generateReply({
  apiKey,
  messages = [],
  systemPrompt,
  model = DEFAULT_MODEL,
  temperature,
  maxOutputTokens,
  json = false,
  responseSchema,
  lowLatency = false,
  thinkingBudget,
  timeoutMs,
  signal,
} = {}) {
  if (!apiKey) {
    throw new ProviderError(ErrorCode.MISSING_KEY, undefined, { provider: id });
  }

  const contents = toContents(messages);
  if (contents.length === 0) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'No message content to send.', { provider: id });
  }

  const generationConfig = {};
  if (typeof temperature === 'number') generationConfig.temperature = temperature;
  if (typeof maxOutputTokens === 'number') generationConfig.maxOutputTokens = maxOutputTokens;
  if (json || responseSchema) generationConfig.responseMimeType = 'application/json';
  if (responseSchema) generationConfig.responseSchema = responseSchema;
  // Here low latency means the smallest thinking allowance the model accepts.
  const budget =
    typeof thinkingBudget === 'number' ? thinkingBudget : lowLatency ? LOW_LATENCY_THINKING_BUDGET : null;
  if (budget !== null) generationConfig.thinkingConfig = { thinkingBudget: budget };

  const body = { contents };
  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  const payload = await callGemini(`/models/${encodeURIComponent(model)}:generateContent`, {
    apiKey,
    method: 'POST',
    body,
    timeoutMs,
    signal,
  });

  const blockReason = payload.promptFeedback?.blockReason;
  if (blockReason) {
    throw new ProviderError(ErrorCode.CONTENT_BLOCKED, `The provider blocked this request (${blockReason}).`, {
      provider: id,
    });
  }

  const candidate = payload.candidates?.[0];
  const text = (candidate?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim();

  if (!text) {
    const finishReason = candidate?.finishReason || 'UNKNOWN';
    if (finishReason === 'SAFETY' || finishReason === 'PROHIBITED_CONTENT') {
      throw new ProviderError(ErrorCode.CONTENT_BLOCKED, 'The provider blocked its own reply as unsafe.', {
        provider: id,
      });
    }
    throw new ProviderError(ErrorCode.PROVIDER_ERROR, `The provider returned an empty reply (${finishReason}).`, {
      provider: id,
    });
  }

  const usage = payload.usageMetadata || {};
  return {
    text,
    model,
    finishReason: candidate?.finishReason || null,
    usage: {
      promptTokens: usage.promptTokenCount ?? null,
      replyTokens: usage.candidatesTokenCount ?? null,
      totalTokens: usage.totalTokenCount ?? null,
    },
  };
}

/**
 * Checks a key without spending a generation call.
 * Listing models is the cheapest authenticated endpoint the provider offers.
 */
async function validateKey(apiKey, { timeoutMs = 10_000 } = {}) {
  if (!apiKey) return { valid: false, reason: 'No API key given.' };
  try {
    await callGemini('/models?pageSize=1', { apiKey, timeoutMs });
    return { valid: true };
  } catch (error) {
    if (error.code === ErrorCode.INVALID_KEY) return { valid: false, reason: error.message };
    if (error.code === ErrorCode.RATE_LIMITED || error.code === ErrorCode.QUOTA_EXHAUSTED) {
      return { valid: true, warning: error.message };
    }
    throw error;
  }
}

const geminiAdapter = {
  id,
  label: 'Gemini',
  defaultModel: DEFAULT_MODEL,
  /** Free-tier requests per day, used later by the app-side usage estimate. */
  freeTierDailyRequests: 200,
  envVar: 'GEMINI_API_KEY',
  keyHint: 'Google AI Studio key (starts with AIza). A Gemini consumer subscription does not grant API access.',
  generateReply,
  validateKey,
};

export default geminiAdapter;
