/**
 * OpenAI adapter.
 *
 * Chat completions, through the shared OpenAI-compatible implementation.
 *
 * Worth knowing: OpenAI has no free tier. A key only works once the account
 * has credit on it, which is why the app says so where the key is entered.
 */

import { createOpenAiCompatibleAdapter } from './openaiCompatible.js';

export default createOpenAiCompatibleAdapter({
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  envVar: 'OPENAI_API_KEY',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyHint: 'OpenAI key (starts with sk-). There is no free tier: the account needs credit before any model answers.',
  /** No published free daily allowance, so the app shows a plain count. */
  freeTierDailyRequests: null,
});
