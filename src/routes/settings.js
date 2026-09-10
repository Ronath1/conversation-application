/**
 * Settings endpoints: read provider state, swap the API key at runtime.
 *
 * A stored key is never sent back. Responses carry a masked form only, which
 * is enough to tell two keys apart and useless for making requests.
 */

import { Router } from 'express';
import * as keyStore from '../config/keyStore.js';
import { getAdapter, hasAdapter, listAdapters } from '../providers/index.js';
import { ErrorCode, ProviderError } from '../providers/errors.js';

const router = Router();

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 500;

/** Express 4 does not catch rejected promises from handlers. */
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

async function describeProvider(adapter, activeProviderId) {
  const stored = await keyStore.getProviderConfig(adapter.id);
  return {
    id: adapter.id,
    label: adapter.label,
    active: adapter.id === activeProviderId,
    model: stored?.model || adapter.defaultModel,
    defaultModel: adapter.defaultModel,
    hasKey: Boolean(stored?.apiKey),
    maskedKey: keyStore.maskKey(stored?.apiKey),
    keySource: stored?.apiKey ? stored.source || 'settings' : null,
    keyUpdatedAt: stored?.updatedAt || null,
    freeTierDailyRequests: adapter.freeTierDailyRequests,
    keyHint: adapter.keyHint,
    envVar: adapter.envVar,
  };
}

async function buildSettings() {
  const activeProviderId = await keyStore.getActiveProviderId();
  const providers = await Promise.all(listAdapters().map((adapter) => describeProvider(adapter, activeProviderId)));
  return { activeProvider: activeProviderId, providers };
}

/** GET /api/settings — current provider, model and key status. */
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json(await buildSettings());
  }),
);

/**
 * PUT /api/settings/key — store a new key for a provider.
 * Body: { apiKey, provider?, validate? }
 *
 * The new key applies to the next request immediately; nothing restarts.
 * By default the key is checked against the provider before it is stored, so
 * a typo cannot silently replace a working key.
 */
router.put(
  '/settings/key',
  asyncHandler(async (req, res) => {
    const providerId = req.body?.provider || (await keyStore.getActiveProviderId());
    const adapter = getAdapter(providerId);

    const rawKey = req.body?.apiKey;
    if (typeof rawKey !== 'string' || !rawKey.trim()) {
      throw new ProviderError(ErrorCode.BAD_REQUEST, 'apiKey is required.', { provider: providerId, status: 400 });
    }

    const apiKey = rawKey.trim();
    if (apiKey.length < MIN_KEY_LENGTH || apiKey.length > MAX_KEY_LENGTH) {
      throw new ProviderError(
        ErrorCode.BAD_REQUEST,
        `apiKey must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters.`,
        { provider: providerId, status: 400 },
      );
    }

    const shouldValidate = req.body?.validate !== false;
    let validation = null;
    if (shouldValidate) {
      validation = await adapter.validateKey(apiKey);
      if (!validation.valid) {
        throw new ProviderError(ErrorCode.INVALID_KEY, validation.reason || 'The provider rejected this key.', {
          provider: providerId,
          status: 400,
        });
      }
    }

    await keyStore.setApiKey(providerId, apiKey);

    res.json({
      ok: true,
      validated: shouldValidate,
      warning: validation?.warning || null,
      provider: await describeProvider(adapter, await keyStore.getActiveProviderId()),
    });
  }),
);

/** DELETE /api/settings/key/:provider — forget a stored key. */
router.delete(
  '/settings/key/:provider',
  asyncHandler(async (req, res) => {
    const adapter = getAdapter(req.params.provider);
    const removed = await keyStore.clearApiKey(adapter.id);
    res.json({
      ok: true,
      removed,
      provider: await describeProvider(adapter, await keyStore.getActiveProviderId()),
    });
  }),
);

/** PUT /api/settings/provider — choose the active provider. Body: { provider } */
router.put(
  '/settings/provider',
  asyncHandler(async (req, res) => {
    const providerId = req.body?.provider;
    if (!hasAdapter(providerId)) {
      throw new ProviderError(ErrorCode.UNKNOWN_PROVIDER, `Unknown provider "${providerId}".`, { status: 404 });
    }
    await keyStore.setActiveProviderId(providerId);
    res.json(await buildSettings());
  }),
);

/** PUT /api/settings/model — override the model for a provider. Body: { model, provider? } */
router.put(
  '/settings/model',
  asyncHandler(async (req, res) => {
    const providerId = req.body?.provider || (await keyStore.getActiveProviderId());
    const adapter = getAdapter(providerId);
    const model = req.body?.model;
    if (typeof model !== 'string' || !model.trim()) {
      throw new ProviderError(ErrorCode.BAD_REQUEST, 'model is required.', { provider: providerId, status: 400 });
    }
    await keyStore.setProviderModel(providerId, model.trim());
    res.json({ ok: true, provider: await describeProvider(adapter, await keyStore.getActiveProviderId()) });
  }),
);

export default router;
