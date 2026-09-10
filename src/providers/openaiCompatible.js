/**
 * Shared adapter for providers that speak the OpenAI chat-completions format.
 *
 * OpenAI and OpenRouter differ only in host, key page and which models they
 * carry, so one implementation serves both. A third such provider is a few
 * lines of configuration rather than another file of wire handling.
 *
 * Users pick their own model here, and models vary in what they accept: newer
 * reasoning models reject `temperature` and want `max_completion_tokens`,
 * older ones want `max_tokens`. Rather than keep a table of which is which and
 * watch it go stale, the adapter sends the modern shape and drops whatever
 * parameter the provider names as unsupported, then retries.
 */

import { ErrorCode, ProviderError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 45_000;
/** Enough to walk back from a couple of rejected parameters, never a loop. */
const MAX_PARAM_RETRIES = 3;

function toMessages(messages, systemPrompt) {
  const out = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
  for (const message of messages) {
    if (!message || typeof message.content !== 'string' || !message.content.trim()) continue;
    out.push({
      role: message.role === 'assistant' || message.role === 'model' ? 'assistant' : 'user',
      content: message.content,
    });
  }
  return out;
}

/** Names the parameter a provider is complaining about, if it names one. */
function unsupportedParameter(message, sentKeys) {
  if (!/unsupported|not supported|unrecognized|unknown parameter|is not permitted/i.test(message)) return null;
  return sentKeys.find((key) => message.includes(key)) || null;
}

export function createOpenAiCompatibleAdapter(config) {
  const { id, label, baseUrl, defaultModel, keyUrl, keyHint, envVar, freeTierDailyRequests = null, extraHeaders = {} } =
    config;

  function headers(apiKey, withBody) {
    return {
      authorization: `Bearer ${apiKey}`,
      ...(withBody ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    };
  }

  function mapHttpError(status, payload, fallbackText) {
    const message = String(payload?.error?.message || fallbackText || `HTTP ${status}`);
    const code = String(payload?.error?.code || payload?.error?.type || '');
    const detail = `${status}: ${message}`;

    if (status === 401) return new ProviderError(ErrorCode.INVALID_KEY, undefined, { provider: id, detail });
    if (status === 403) {
      return new ProviderError(ErrorCode.INVALID_KEY, `The provider refused this key. ${message}`, {
        provider: id,
        detail,
      });
    }
    if (status === 402 || /insufficient_quota|insufficient credit|billing/i.test(`${code} ${message}`)) {
      return new ProviderError(
        ErrorCode.QUOTA_EXHAUSTED,
        `This account has no credit left for ${label}. Add credit, or choose a cheaper model.`,
        { provider: id, detail },
      );
    }
    if (status === 429) {
      return new ProviderError(ErrorCode.RATE_LIMITED, undefined, { provider: id, detail });
    }
    if (status === 404) {
      return new ProviderError(
        ErrorCode.BAD_REQUEST,
        `That model is not available to this key. Choose another model in settings. (${message})`,
        { provider: id, detail },
      );
    }
    if (status === 400 || status === 422) {
      return new ProviderError(ErrorCode.BAD_REQUEST, `The provider rejected the request. ${message}`, {
        provider: id,
        detail,
      });
    }
    if (status >= 500) return new ProviderError(ErrorCode.PROVIDER_UNAVAILABLE, undefined, { provider: id, detail });
    return new ProviderError(ErrorCode.PROVIDER_ERROR, undefined, { provider: id, detail });
  }

  async function call(pathname, { apiKey, method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    let response;
    try {
      response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: headers(apiKey, Boolean(body)),
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
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

    if (!response.ok) throw mapHttpError(response.status, payload, text.slice(0, 300));
    if (!payload) {
      throw new ProviderError(ErrorCode.PROVIDER_ERROR, 'The provider returned an unreadable response.', {
        provider: id,
        detail: text.slice(0, 300),
      });
    }
    return payload;
  }

  async function generateReply({
    apiKey,
    messages = [],
    systemPrompt,
    model = defaultModel,
    temperature,
    maxOutputTokens,
    responseSchema,
    json = false,
    lowLatency = false,
    timeoutMs,
  } = {}) {
    if (!apiKey) throw new ProviderError(ErrorCode.MISSING_KEY, undefined, { provider: id });

    const chat = toMessages(messages, systemPrompt);
    if (chat.length === 0) {
      throw new ProviderError(ErrorCode.BAD_REQUEST, 'No message content to send.', { provider: id });
    }

    const body = { model, messages: chat };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (typeof maxOutputTokens === 'number') body.max_completion_tokens = maxOutputTokens;
    if (lowLatency) body.reasoning_effort = 'low';

    if (responseSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'conversation_turn', strict: false, schema: responseSchema },
      };
    } else if (json) {
      body.response_format = { type: 'json_object' };
    }

    // Optional parameters are dropped one at a time when the model says it
    // does not accept them, so any model the user picks still answers.
    const optional = ['reasoning_effort', 'temperature', 'max_completion_tokens', 'response_format'];
    let payload;
    for (let attempt = 0; ; attempt += 1) {
      try {
        payload = await call('/chat/completions', { apiKey, method: 'POST', body, timeoutMs });
        break;
      } catch (error) {
        const sent = optional.filter((key) => key in body);
        const offending = error.code === ErrorCode.BAD_REQUEST ? unsupportedParameter(error.detail || '', sent) : null;

        if (!offending || attempt >= MAX_PARAM_RETRIES) throw error;

        delete body[offending];
        // The older name for the same thing, when that is what was rejected.
        if (offending === 'max_completion_tokens' && typeof maxOutputTokens === 'number') {
          body.max_tokens = maxOutputTokens;
          optional.push('max_tokens');
        }
      }
    }

    const choice = payload.choices?.[0];
    const text = String(choice?.message?.content || '').trim();

    if (!text) {
      const reason = choice?.finish_reason || 'unknown';
      if (reason === 'content_filter') {
        throw new ProviderError(ErrorCode.CONTENT_BLOCKED, 'The provider blocked this reply.', { provider: id });
      }
      throw new ProviderError(ErrorCode.PROVIDER_ERROR, `The provider returned an empty reply (${reason}).`, {
        provider: id,
      });
    }

    const usage = payload.usage || {};
    return {
      text,
      model: payload.model || model,
      finishReason: choice?.finish_reason || null,
      usage: {
        promptTokens: usage.prompt_tokens ?? null,
        replyTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
      },
    };
  }

  /** Listing models both proves the key works and costs no tokens. */
  async function validateKey(apiKey, { timeoutMs = 15_000 } = {}) {
    if (!apiKey) return { valid: false, reason: 'No API key given.' };
    try {
      await call('/models', { apiKey, timeoutMs });
      return { valid: true };
    } catch (error) {
      if (error.code === ErrorCode.INVALID_KEY) return { valid: false, reason: error.message };
      if (error.code === ErrorCode.RATE_LIMITED || error.code === ErrorCode.QUOTA_EXHAUSTED) {
        return { valid: true, warning: error.message };
      }
      throw error;
    }
  }

  /**
   * The models this key can actually see. Chat models only: the same endpoint
   * lists embedding, image and audio models that cannot hold a conversation.
   */
  async function listModels(apiKey, { timeoutMs = 15_000 } = {}) {
    const payload = await call('/models', { apiKey, timeoutMs });
    const rows = Array.isArray(payload.data) ? payload.data : [];

    return rows
      .filter((row) => row?.id)
      .filter((row) => !/embed|whisper|tts|dall-e|moderation|image|audio|transcribe|realtime/i.test(row.id))
      .map((row) => ({
        id: row.id,
        label: row.name || row.id,
        // OpenRouter reports prices; OpenAI does not.
        free: row.pricing ? Number(row.pricing.prompt) === 0 && Number(row.pricing.completion) === 0 : undefined,
      }));
  }

  return {
    id,
    label,
    defaultModel,
    freeTierDailyRequests,
    envVar,
    keyUrl,
    keyHint,
    generateReply,
    validateKey,
    listModels,
  };
}
