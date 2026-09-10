/**
 * HTTP server.
 *
 * Backend scope so far: provider adapter layer, runtime key management, and
 * the conversation loop. The frontend comes later.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as keyStore from './config/keyStore.js';
import { listAdapters } from './providers/index.js';
import { isProviderError } from './providers/errors.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';
import conversationRoutes from './routes/conversation.js';
import reportRoutes from './routes/report.js';
import usageRoutes from './routes/usage.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public', import.meta.url)));

const app = express();
app.use(express.json({ limit: '1mb' }));

// The frontend is plain files: same origin, same port, no build step and no proxy.
app.use(express.static(PUBLIC_DIR));

app.get('/api/health', async (req, res) => {
  const activeProvider = await keyStore.getActiveProviderId();
  const hasKey = Boolean(await keyStore.getApiKey(activeProvider));
  res.json({ ok: true, activeProvider, hasKey });
});

app.use('/api', settingsRoutes);
app.use('/api', aiRoutes);
app.use('/api', conversationRoutes);
app.use('/api', reportRoutes);
app.use('/api', usageRoutes);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
});

// Provider failures already carry a safe message and status. Anything else is
// logged in full and reported generically, so internals never reach the client.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);

  if (isProviderError(error)) {
    if (error.detail) console.error(`[${error.code}] ${error.provider}: ${error.detail}`);
    return res.status(error.status).json({ error: error.toJSON() });
  }

  if (error instanceof SyntaxError && 'body' in error) {
    return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Request body is not valid JSON.' } });
  }

  console.error('Unhandled error:', error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong.' } });
});

async function start() {
  await keyStore.load();
  const activeProvider = await keyStore.getActiveProviderId();
  const hasKey = Boolean(await keyStore.getApiKey(activeProvider));

  app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`Providers: ${listAdapters().map((adapter) => adapter.id).join(', ')}`);
    console.log(`Active provider: ${activeProvider} (key ${hasKey ? 'set' : 'NOT set'})`);
    console.log(`Config file: ${keyStore.getConfigPath()}`);
    if (!hasKey) {
      console.log('Add a key with: PUT /api/settings/key  { "apiKey": "..." }');
    }
  });
}

start().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
