/**
 * Conversation endpoints: sessions, turns and the end-of-session recap.
 */

import { Router } from 'express';
import * as sessionStore from '../conversation/sessionStore.js';
import { summarize, takeTurn, validateDifficulty, validateTopic } from '../conversation/service.js';
import { DIFFICULTIES, TOPICS } from '../conversation/prompt.js';
import { ErrorCode, ProviderError } from '../providers/errors.js';
import { hasAdapter } from '../providers/index.js';

const router = Router();

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function requireSessionId(sessionId) {
  if (!sessionStore.isValidSessionId(sessionId)) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'Invalid session id.', { status: 400 });
  }
  return sessionId;
}

async function loadSession(sessionId) {
  const session = await sessionStore.getSession(requireSessionId(sessionId));
  if (!session) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'Session not found.', { status: 404 });
  }
  return session;
}

/** GET /api/conversation/options — topics and difficulty levels for the picker. */
router.get('/conversation/options', (req, res) => {
  res.json({
    topics: TOPICS.map(({ id, label, description }) => ({ id, label, description })),
    difficulties: DIFFICULTIES.map(({ id, label }) => ({ id, label })),
  });
});

/** POST /api/sessions — start a session. Body: { topic?, difficulty?, provider? } */
router.post(
  '/sessions',
  asyncHandler(async (req, res) => {
    const topic = validateTopic(req.body?.topic);
    const difficulty = validateDifficulty(req.body?.difficulty);

    const provider = req.body?.provider ?? null;
    if (provider !== null && !hasAdapter(provider)) {
      throw new ProviderError(ErrorCode.UNKNOWN_PROVIDER, `Unknown provider "${provider}".`, { status: 404 });
    }

    const session = await sessionStore.createSession({ topic, difficulty, provider });
    res.status(201).json(session);
  }),
);

/** GET /api/sessions — recent sessions, newest first. */
router.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    res.json({ sessions: await sessionStore.listSessions() });
  }),
);

/** GET /api/sessions/:id — one session with its full turn history. */
router.get(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    res.json(await loadSession(req.params.id));
  }),
);

/**
 * POST /api/sessions/:id/turns — the conversation loop.
 * Body: { text }
 * Returns the spoken reply and any corrections for this turn only.
 */
router.post(
  '/sessions/:id/turns',
  asyncHandler(async (req, res) => {
    const sessionId = requireSessionId(req.params.id);
    const result = await takeTurn(sessionId, req.body?.text);
    res.json(result);
  }),
);

/** PATCH /api/sessions/:id — change topic or difficulty mid-session. */
router.patch(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const session = await loadSession(req.params.id);
    const patch = {};
    if (req.body?.topic !== undefined) patch.topic = validateTopic(req.body.topic);
    if (req.body?.difficulty !== undefined) patch.difficulty = validateDifficulty(req.body.difficulty);
    if (Object.keys(patch).length === 0) return res.json(session);
    res.json(await sessionStore.updateSession(session.id, patch));
  }),
);

/** POST /api/sessions/:id/end — close the session and return the recap. */
router.post(
  '/sessions/:id/end',
  asyncHandler(async (req, res) => {
    await loadSession(req.params.id);
    const session = await sessionStore.endSession(req.params.id);
    res.json({ ok: true, summary: summarize(session) });
  }),
);

/** GET /api/sessions/:id/summary — the recap without ending the session. */
router.get(
  '/sessions/:id/summary',
  asyncHandler(async (req, res) => {
    res.json(summarize(await loadSession(req.params.id)));
  }),
);

/** DELETE /api/sessions/:id — remove a session and its stored mistakes. */
router.delete(
  '/sessions/:id',
  asyncHandler(async (req, res) => {
    const deleted = await sessionStore.deleteSession(requireSessionId(req.params.id));
    res.json({ ok: true, deleted });
  }),
);

export default router;
