/**
 * The model list for the settings picker.
 *
 * Asked of the provider with the user's own key, so the list is what that key
 * can actually reach rather than a list of everything that exists. A key with
 * no credit, or a free tier, sees a smaller list — which is the honest answer
 * to "which of these will work for me".
 *
 * When the provider cannot be asked — no key saved yet, or the request fails —
 * the response says so and offers the adapter's default, so the screen still
 * has something to show.
 */

import { Router } from 'express';
import * as keyStore from '../config/keyStore.js';
import { getAdapter } from '../providers/index.js';
import { userIdOf } from '../middleware/clerkAuth.js';

const router = Router();

const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

/** GET /api/models?provider= — models this user's key can use. */
router.get(
  '/models',
  asyncHandler(async (req, res) => {
    const userId = userIdOf(req);
    const providerId = req.query.provider || (await keyStore.getActiveProviderId(userId));
    const adapter = getAdapter(providerId);
    const selected = (await keyStore.getProviderConfig(userId, providerId))?.model || adapter.defaultModel;

    // A fallback list must always contain the model actually in use, or the
    // picker would show something the app is not going to send.
    const fallbackIds = [...new Set([selected, adapter.defaultModel].filter(Boolean))];
    const fallback = {
      provider: adapter.id,
      selected,
      source: 'fallback',
      models: fallbackIds.map((modelId) => ({ id: modelId, label: modelId })),
    };

    const apiKey = await keyStore.getApiKey(userId, providerId);
    if (!apiKey || typeof adapter.listModels !== 'function') {
      return res.json({ ...fallback, reason: apiKey ? null : 'Save an API key to see the models it can use.' });
    }

    try {
      const models = await adapter.listModels(apiKey);
      if (!models.length) return res.json({ ...fallback, reason: 'The provider listed no usable models.' });

      // A model chosen earlier may no longer be offered; keep it in the list
      // so the picker still shows what is actually in use, marked as unlisted.
      const known = models.some((model) => model.id === selected);
      const withSelected = known ? models : [{ id: selected, label: selected, unlisted: true }, ...models];

      res.json({ provider: adapter.id, selected, source: 'provider', models: withSelected });
    } catch (error) {
      // A failure here must not stop the user changing models by hand.
      res.json({ ...fallback, reason: error.message });
    }
  }),
);

export default router;
