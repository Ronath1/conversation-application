/**
 * Usage endpoints.
 *
 * Everything here is the app's own count, never a live number from the
 * provider. The response says so explicitly so the UI cannot imply otherwise.
 */

import { Router } from 'express';
import * as usageStore from '../usage/usageStore.js';
import * as keyStore from '../config/keyStore.js';
import { getAdapter } from '../providers/index.js';
import { userIdOf } from '../middleware/clerkAuth.js';

const router = Router();

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/** GET /api/usage — today's request count against the free-tier limit. */
router.get(
  '/usage',
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const providerId = req.query.provider || (await keyStore.getActiveProviderId(userId));
    const adapter = getAdapter(providerId);

    const day = await usageStore.getDay(userId, providerId);
    const limit = adapter.freeTierDailyRequests || null;

    res.json({
      provider: adapter.id,
      label: adapter.label,
      date: usageStore.today(),
      used: day.requests,
      failures: day.failures,
      rateLimited: day.rateLimited,
      limit,
      remaining: limit === null ? null : Math.max(0, limit - day.requests),
      percentUsed: limit ? Math.min(100, Math.round((day.requests / limit) * 100)) : null,
      exhausted: day.rateLimited > 0,
      estimate: true,
      note: 'Counted by this app. Providers do not report live quota, and requests made outside this app are not included.',
      recentDays: await usageStore.getRecentDays(userId, providerId, 7),
    });
  }),
);

export default router;
