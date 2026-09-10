/**
 * Mistake report endpoints.
 */

import { Router } from 'express';
import { buildReport } from '../report/reportService.js';
import { MISTAKE_TYPES } from '../conversation/prompt.js';
import { ErrorCode, ProviderError } from '../providers/errors.js';

const router = Router();

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const MAX_LIMIT = 500;

/**
 * GET /api/report — totals, patterns and the full mistake log.
 * Query: type, sessionId, limit
 */
router.get(
  '/report',
  asyncHandler(async (req, res) => {
    const { type, sessionId } = req.query;

    if (type && !MISTAKE_TYPES.includes(type)) {
      throw new ProviderError(ErrorCode.BAD_REQUEST, `Unknown mistake type "${type}".`, { status: 400 });
    }

    const limit = Math.min(Number(req.query.limit) || 200, MAX_LIMIT);
    res.json(await buildReport({ type, sessionId, limit }));
  }),
);

/** GET /api/report/types — the mistake types, for the filter control. */
router.get('/report/types', (req, res) => {
  res.json({ types: MISTAKE_TYPES });
});

export default router;
