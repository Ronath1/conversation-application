/**
 * Starts a normal long-running server. Used for local development and for any
 * host that runs a process. Serverless hosts import src/app.js instead.
 */

import 'dotenv/config';
import app from './app.js';
import * as keyStore from './config/keyStore.js';
import { listAdapters } from './providers/index.js';
import { driverName } from './lib/store.js';

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  await keyStore.load();
  const activeProvider = await keyStore.getActiveProviderId();
  const hasKey = Boolean(await keyStore.getApiKey(activeProvider));

  app.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
    console.log(`Providers: ${listAdapters().map((adapter) => adapter.id).join(', ')}`);
    console.log(`Active provider: ${activeProvider} (key ${hasKey ? 'set' : 'NOT set'})`);
    console.log(`Storage: ${driverName}`);
    if (!hasKey) {
      console.log('Add a key with: PUT /api/settings/key  { "apiKey": "..." }');
    }
  });
}

start().catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
