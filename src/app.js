/**
 * The Express app.
 *
 * Kept separate from the thing that listens on a port: a normal server calls
 * listen() in server.js, while a serverless host imports this app and hands it
 * one request at a time.
 */

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import * as keyStore from './config/keyStore.js';
import { isProviderError } from './providers/errors.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';
import conversationRoutes from './routes/conversation.js';
import reportRoutes from './routes/report.js';
import usageRoutes from './routes/usage.js';

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

export default app;
