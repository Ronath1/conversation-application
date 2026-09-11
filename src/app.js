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
import { authConfig, requireUser } from './middleware/clerkAuth.js';
import { isProviderError } from './providers/errors.js';
import settingsRoutes from './routes/settings.js';
import aiRoutes from './routes/ai.js';
import conversationRoutes from './routes/conversation.js';
import reportRoutes from './routes/report.js';
import usageRoutes from './routes/usage.js';
import modelRoutes from './routes/models.js';

const PUBLIC_DIR = path.resolve(fileURLToPath(new URL('../public', import.meta.url)));

const app = express();
app.use(express.json({ limit: '1mb' }));

/**
 * Off by default: these two headers let the downloaded voices use more than
 * one processor thread, and put sign-in at risk.
 *
 * The speech model runs in the browser, and WebAssembly is given extra threads
 * only in a page the browser considers cross-origin isolated. The difference
 * is large — measured at 2.2 seconds of work per second of speech without it
 * against 0.9 with it, which is the line between speech that keeps up with
 * itself and speech that pauses between sentences.
 *
 * The cost is that "Cross-Origin-Opener-Policy: same-origin" cuts a popup off
 * from the page that opened it, and Clerk offers "Continue with Google". That
 * flow cannot be tested without somebody's real Google account, so this stays
 * off until a person has turned it on and signed in that way themselves. Turn
 * it off again and everything reverts: nothing is stored differently and the
 * voices keep working, more slowly.
 *
 * This covers only what the app itself serves. On a serverless host the files
 * under public/ are served by the platform's own static layer, which never
 * runs this middleware — and a browser refuses to start a worker whose script
 * arrives without a policy of its own from a page that has one. So
 * public/kokoro-worker.js gets its header from vercel.json instead. Losing
 * that is not a slow app but a silent one: the worker never starts, the
 * download bar sits at nothing, and no reply is ever spoken.
 */
if (process.env.CROSS_ORIGIN_ISOLATION === 'on') {
  app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // The permissive variant: cross-origin scripts, such as Clerk's own from a
    // CDN, still load, but without credentials attached.
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    next();
  });
}

/**
 * The only endpoint that answers before sign-in. The page needs the
 * publishable key to render the sign-in form at all, and that key is designed
 * to be public.
 */
app.get('/api/auth/config', (req, res) => {
  res.json(authConfig());
});

// The frontend is plain files: same origin, same port, no build step and no
// proxy. Serving the page itself needs no session; every route below does, and
// the page shows nothing but a sign-in form until it has one.
app.use(express.static(PUBLIC_DIR));

// Everything past this point belongs to one account.
app.use('/api', requireUser);

// Wrapped like every other route: an async handler that rejects without this
// takes the whole process down rather than returning an error.
app.get('/api/health', (req, res, next) => {
  (async () => {
    const activeProvider = await keyStore.getActiveProviderId(req.userId);
    const hasKey = Boolean(await keyStore.getApiKey(req.userId, activeProvider));
    res.json({ ok: true, userId: req.userId, activeProvider, hasKey });
  })().catch(next);
});

app.use('/api', settingsRoutes);
app.use('/api', aiRoutes);
app.use('/api', conversationRoutes);
app.use('/api', reportRoutes);
app.use('/api', usageRoutes);
app.use('/api', modelRoutes);

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
