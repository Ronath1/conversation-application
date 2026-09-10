/**
 * Smoke-test endpoint for the adapter layer.
 *
 * This is not the conversation endpoint — that arrives in step 2 with history
 * and correction detection. This exists so the adapter and the stored key can
 * be exercised end to end before any of that is built.
 */

import { Router } from 'express';
import { getAiReply } from '../providers/index.js';

const router = Router();

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const DEFAULT_MESSAGE = 'Say hello in one short sentence.';

/** POST /api/ai/test — one round trip through the active provider. */
router.post(
  '/ai/test',
  asyncHandler(async (req, res) => {
    const message = typeof req.body?.message === 'string' && req.body.message.trim()
      ? req.body.message.trim()
      : DEFAULT_MESSAGE;

    const reply = await getAiReply({
      provider: req.body?.provider,
      messages: [{ role: 'user', content: message }],
      systemPrompt: 'You are a friendly English conversation partner. Keep replies short.',
      maxOutputTokens: 200,
    });

    res.json({ ok: true, sent: message, ...reply });
  }),
);

export default router;
