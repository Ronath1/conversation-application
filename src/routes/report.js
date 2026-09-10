/**
 * Mistake report endpoints.
 */

import { Router } from 'express';
import { buildReport } from '../report/reportService.js';
import { MISTAKE_TYPES } from '../conversation/prompt.js';
import { ErrorCode, ProviderError } from '../providers/errors.js';
import { userIdOf } from '../middleware/clerkAuth.js';

const router = Router();

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

const MAX_LIMIT = 500;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar day, as the browser's own local day. */
function day(value, name) {
  if (value === undefined || value === '') return null;
  if (!DAY_PATTERN.test(String(value))) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, `"${name}" must be a date like 2026-09-11.`, { status: 400 });
  }
  return String(value);
}

/**
 * GET /api/report — totals, patterns and the full mistake log.
 * Query: type, sessionId, from, to, tzOffset, limit
 */
router.get(
  '/report',
  asyncHandler(async (req, res) => {
    const { type, sessionId } = req.query;

    if (type && !MISTAKE_TYPES.includes(type)) {
      throw new ProviderError(ErrorCode.BAD_REQUEST, `Unknown mistake type "${type}".`, { status: 400 });
    }

    const from = day(req.query.from, 'from');
    const to = day(req.query.to, 'to');
    // Accepting a backwards range would silently return nothing, which reads
    // as "no mistakes" rather than as the mistake it is.
    if (from && to && from > to) {
      throw new ProviderError(ErrorCode.BAD_REQUEST, 'The start of the range is after its end.', { status: 400 });
    }

    // Bounded to the real range of world offsets, so a bad value cannot shift
    // every day in the report.
    const rawOffset = Number(req.query.tzOffset);
    const offsetMinutes = Number.isFinite(rawOffset) ? Math.max(-840, Math.min(840, Math.trunc(rawOffset))) : 0;

    const limit = Math.min(Number(req.query.limit) || 200, MAX_LIMIT);
    res.json(await buildReport(userIdOf(req), { type, sessionId, from, to, offsetMinutes, limit }));
  }),
);

/** GET /api/report/types — the mistake types, for the filter control. */
router.get('/report/types', (req, res) => {
  res.json({ types: MISTAKE_TYPES });
});

export default router;
