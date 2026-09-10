/**
 * Starts a normal long-running server. Used for local development and for any
 * host that runs a process. Serverless hosts import src/app.js instead.
 */

import 'dotenv/config';
import app from './app.js';
import { listAdapters } from './providers/index.js';
import { driverName } from './lib/store.js';
import { isAuthConfigured } from './middleware/clerkAuth.js';

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`Providers: ${listAdapters().map((adapter) => adapter.id).join(', ')}`);
    console.log(`Storage: ${driverName}`);
    console.log(`Sign-in: ${isAuthConfigured ? 'Clerk' : 'off (single local user)'}`);
  });
}

start().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
