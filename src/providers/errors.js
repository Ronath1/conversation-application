/**
 * Normalized provider errors.
 *
 * Every adapter maps its own failure modes onto these codes so that the rest
 * of the app can react to a failure without knowing which provider produced
 * it. Adding a provider must never add a new error code here.
 */

export const ErrorCode = {
  MISSING_KEY: 'MISSING_KEY',
  INVALID_KEY: 'INVALID_KEY',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
  CONTENT_BLOCKED: 'CONTENT_BLOCKED',
  BAD_REQUEST: 'BAD_REQUEST',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_PROVIDER: 'UNKNOWN_PROVIDER',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
};

const HTTP_STATUS = {
  [ErrorCode.MISSING_KEY]: 400,
  [ErrorCode.INVALID_KEY]: 401,
  [ErrorCode.RATE_LIMITED]: 429,
  [ErrorCode.QUOTA_EXHAUSTED]: 429,
  [ErrorCode.CONTENT_BLOCKED]: 422,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.PROVIDER_UNAVAILABLE]: 502,
  [ErrorCode.NETWORK_ERROR]: 502,
  [ErrorCode.UNKNOWN_PROVIDER]: 404,
  [ErrorCode.PROVIDER_ERROR]: 502,
};

/** User-facing wording. Kept here so every provider says the same thing. */
const DEFAULT_MESSAGE = {
  [ErrorCode.MISSING_KEY]: 'No API key is set for this provider. Add one in settings.',
  [ErrorCode.INVALID_KEY]: 'The API key was rejected by the provider. Check the key in settings.',
  [ErrorCode.RATE_LIMITED]: 'Key exhausted: the provider is rate limiting this key. Wait and retry, or swap the key.',
  [ErrorCode.QUOTA_EXHAUSTED]: 'Key exhausted: the free-tier quota for this key is used up.',
  [ErrorCode.CONTENT_BLOCKED]: 'The provider blocked this request or its reply.',
  [ErrorCode.BAD_REQUEST]: 'The provider rejected the request as malformed.',
  [ErrorCode.PROVIDER_UNAVAILABLE]: 'The provider is temporarily unavailable.',
  [ErrorCode.NETWORK_ERROR]: 'Could not reach the provider.',
  [ErrorCode.UNKNOWN_PROVIDER]: 'Unknown provider.',
  [ErrorCode.PROVIDER_ERROR]: 'The provider returned an unexpected error.',
};

export class ProviderError extends Error {
  constructor(code, message, options = {}) {
    super(message || DEFAULT_MESSAGE[code] || 'Provider error');
    this.name = 'ProviderError';
    this.code = ErrorCode[code] ? code : ErrorCode.PROVIDER_ERROR;
    this.status = options.status ?? HTTP_STATUS[this.code] ?? 502;
    this.provider = options.provider;
    this.retryAfter = options.retryAfter;
    /** Raw provider payload, for logs only. Never sent to the client. */
    this.detail = options.detail;
    if (options.cause) this.cause = options.cause;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      ...(this.retryAfter ? { retryAfter: this.retryAfter } : {}),
    };
  }
}

export function isProviderError(error) {
  return error instanceof ProviderError;
}
