/**
 * Small helpers for JSON files used as the app's storage.
 *
 * Writes go to a temp file and are renamed into place, so a crash mid-write
 * cannot leave a half-written file behind.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      throw new Error(`${filePath} is not valid JSON. Fix or delete it. (${error.message})`);
    }
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value, { mode = 0o600 } = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode });
  await fs.rename(tempPath, filePath);
}

export async function listJsonFiles(dirPath) {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.filter((name) => name.endsWith('.json'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
