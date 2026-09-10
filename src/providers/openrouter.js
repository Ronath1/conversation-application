/**
 * OpenRouter adapter.
 *
 * One key reaching many providers' models, including some that are free to
 * use. That makes it the practical choice when a provider's own free tier runs
 * out, which is why it sits alongside the direct providers rather than
 * replacing them.
 *
 * The API is OpenAI-compatible, so it shares that implementation. Model ids
 * are namespaced by their origin, such as "google/gemini-2.0-flash-exp:free".
 */

import { createOpenAiCompatibleAdapter } from './openaiCompatible.js';

export default createOpenAiCompatibleAdapter({
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel: process.env.OPENROUTER_MODEL || 'openrouter/auto',
  envVar: 'OPENROUTER_API_KEY',
  keyUrl: 'https://openrouter.ai/keys',
  keyHint:
    'OpenRouter key (starts with sk-or-). Models ending in ":free" cost nothing; the rest draw on your OpenRouter credit.',
  freeTierDailyRequests: null,
  // OpenRouter attributes traffic to an app when these are sent.
  extraHeaders: {
    'HTTP-Referer': 'https://conversation-application.vercel.app',
    'X-Title': 'English Conversation Practice',
  },
});
