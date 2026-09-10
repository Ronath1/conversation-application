/**
 * Claude adapter.
 *
 * Implements the same adapter interface as the Gemini one, through the
 * official Anthropic SDK rather than raw HTTP. That difference is the point:
 * the app calls getAiReply either way and never learns which is behind it.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ErrorCode, ProviderError } from './errors.js';

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Thinking is on by default on this model family and counts against
 * max_tokens, so a conversational ceiling of ~1000 tokens can truncate a
 * reply. The adapter raises the floor rather than making callers know that.
 */
const MIN_MAX_TOKENS = 4096;

const id = 'claude';

function client(apiKey, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
}

/** Maps the app's neutral message list onto the Messages API shape. */
function toMessages(messages) {
  return messages
    .filter((message) => message && typeof message.content === 'string' && message.content.trim())
    .map((message) => ({
      role: message.role === 'assistant' || message.role === 'model' ? 'assistant' : 'user',
      content: message.content,
    }));
}

/**
 * Structured output here requires a strict JSON schema: every object must
 * refuse unknown properties. The shared schema is written once, provider
 * neutral, and each adapter tightens it to its own rules.
 */
function toStrictSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toStrictSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  for (const [key, value] of Object.entries(schema)) out[key] = toStrictSchema(value);
  if (out.type === 'object' && out.properties) out.additionalProperties = false;
  return out;
}

/** Translates SDK errors into the app's shared error codes. */
function mapError(error) {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError(ErrorCode.INVALID_KEY, undefined, { provider: id, detail: error.message });
  }
  if (error instanceof Anthropic.RateLimitError) {
    const code = error.type === 'billing_error' ? ErrorCode.QUOTA_EXHAUSTED : ErrorCode.RATE_LIMITED;
    return new ProviderError(code, undefined, { provider: id, detail: error.message });
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderError(ErrorCode.BAD_REQUEST, `The provider rejected the request. ${error.message}`, {
      provider: id,
      detail: error.message,
    });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
    return new ProviderError(ErrorCode.BAD_REQUEST, `The provider rejected the request. ${error.message}`, {
      provider: id,
      detail: error.message,
    });
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ProviderError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, { provider: id, detail: error.message });
  }
  // APIConnectionError extends APIError in this SDK, so it is checked first.
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError(ErrorCode.NETWORK_ERROR, undefined, { provider: id, cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderError(ErrorCode.PROVIDER_ERROR, undefined, { provider: id, detail: error.message });
  }
  return new ProviderError(ErrorCode.PROVIDER_ERROR, undefined, { provider: id, cause: error });
}

/**
 * Sends conversation history and returns one reply.
 *
 * @param {object} params Same shape every adapter accepts.
 * @param {boolean} [params.lowLatency] Trade depth for speed on a spoken turn.
 * @returns {Promise<{text: string, model: string, finishReason: string|null, usage: object}>}
 */
async function generateReply({
  apiKey,
  messages = [],
  systemPrompt,
  model = DEFAULT_MODEL,
  temperature,
  maxOutputTokens,
  responseSchema,
  json = false,
  lowLatency = false,
  timeoutMs,
} = {}) {
  if (!apiKey) {
    throw new ProviderError(ErrorCode.MISSING_KEY, undefined, { provider: id });
  }

  const conversation = toMessages(messages);
  if (conversation.length === 0) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'No message content to send.', { provider: id });
  }

  const outputConfig = {};
  // Lower effort keeps thinking on but shallow. Turning thinking off entirely
  // is the documented way to get tool calls leaking into visible text.
  if (lowLatency) outputConfig.effort = 'low';
  if (responseSchema) {
    outputConfig.format = { type: 'json_schema', schema: toStrictSchema(responseSchema) };
  } else if (json) {
    outputConfig.format = { type: 'json_object' };
  }

  const request = {
    model,
    max_tokens: Math.max(maxOutputTokens || 0, MIN_MAX_TOKENS),
    messages: conversation,
  };
  if (systemPrompt) request.system = systemPrompt;
  if (typeof temperature === 'number') request.temperature = temperature;
  if (Object.keys(outputConfig).length > 0) request.output_config = outputConfig;

  let response;
  try {
    response = await client(apiKey, timeoutMs).messages.create(request);
  } catch (error) {
    throw mapError(error);
  }

  if (response.stop_reason === 'refusal') {
    const category = response.stop_details?.category;
    throw new ProviderError(
      ErrorCode.CONTENT_BLOCKED,
      `The provider declined this request${category ? ` (${category})` : ''}.`,
      { provider: id },
    );
  }

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  if (!text) {
    throw new ProviderError(
      ErrorCode.PROVIDER_ERROR,
      `The provider returned an empty reply (${response.stop_reason || 'unknown'}).`,
      { provider: id },
    );
  }

  return {
    text,
    model: response.model || model,
    finishReason: response.stop_reason || null,
    usage: {
      promptTokens: response.usage?.input_tokens ?? null,
      replyTokens: response.usage?.output_tokens ?? null,
      totalTokens:
        response.usage ? (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0) : null,
    },
  };
}

/** Listing models is the cheapest authenticated call, and costs no tokens. */
async function validateKey(apiKey, { timeoutMs = 10_000 } = {}) {
  if (!apiKey) return { valid: false, reason: 'No API key given.' };
  try {
    await client(apiKey, timeoutMs).models.list({ limit: 1 });
    return { valid: true };
  } catch (error) {
    const mapped = mapError(error);
    if (mapped.code === ErrorCode.INVALID_KEY) return { valid: false, reason: mapped.message };
    if (mapped.code === ErrorCode.RATE_LIMITED || mapped.code === ErrorCode.QUOTA_EXHAUSTED) {
      return { valid: true, warning: mapped.message };
    }
    throw mapped;
  }
}

const claudeAdapter = {
  id,
  label: 'Claude',
  defaultModel: DEFAULT_MODEL,
  /** No free tier, so the app shows a plain request count instead of a limit. */
  freeTierDailyRequests: null,
  envVar: 'ANTHROPIC_API_KEY',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  keyHint: 'Anthropic Console key (starts with sk-ant-). Usage is paid, with no free daily allowance.',
  generateReply,
  validateKey,
};

export default claudeAdapter;
