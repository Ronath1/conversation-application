/**
 * Document storage.
 *
 * Everything the app keeps — the API key, sessions, usage counts — is a small
 * JSON document with a collection and an id. This module is the only place
 * that knows where those documents actually live.
 *
 * Two drivers, chosen by whether DATABASE_URL is set:
 *
 *   files     data/<collection>/<id>.json. The default, so local development
 *             needs no database at all.
 *   postgres  a single `documents` table. Used on hosts with no writable disk,
 *             which is every serverless platform.
 *
 * Callers see the same four functions either way.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listJsonFiles, readJson, writeJsonAtomic } from './jsonFile.js';

const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DATA_DIR = path.join(ROOT_DIR, 'data');

/** Ids reach here from URLs, so they are checked before touching a path. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,200}$/;

function assertSafe(collection, id) {
  if (!SAFE_ID.test(collection)) throw new Error(`Invalid collection: ${collection}`);
  if (id !== undefined && !SAFE_ID.test(id)) throw new Error(`Invalid document id: ${id}`);
}

/* ---------- file driver ---------- */

function filePath(collection, id) {
  return path.join(DATA_DIR, collection, `${id}.json`);
}

const fileDriver = {
  name: 'files',

  async read(collection, id) {
    return readJson(filePath(collection, id), null);
  },

  async write(collection, id, value) {
    await writeJsonAtomic(filePath(collection, id), value);
  },

  async remove(collection, id) {
    try {
      await fs.unlink(filePath(collection, id));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  },

  async list(collection) {
    const dir = path.join(DATA_DIR, collection);
    const files = await listJsonFiles(dir);
    const documents = [];
    for (const file of files) {
      const value = await readJson(path.join(dir, file), null);
      if (value) documents.push(value);
    }
    return documents;
  },
};

/* ---------- postgres driver ---------- */

/**
 * One table for every collection. The documents are small and always read
 * whole, so a schema per collection would buy nothing.
 */
const SCHEMA = `
  create table if not exists documents (
    collection text not null,
    id text not null,
    data jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (collection, id)
  );
`;

let pool = null;
let ready = null;

async function getPool() {
  if (!pool) {
    // Imported lazily so the file driver never needs the dependency loaded.
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      // Serverless runs many short-lived instances; one connection each keeps
      // the database's connection limit out of trouble.
      max: Number(process.env.DATABASE_POOL_MAX) || 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.DATABASE_SSL === 'off' ? false : { rejectUnauthorized: false },
    });
  }
  // The table is created once per process, not once per query.
  if (!ready) ready = pool.query(SCHEMA);
  await ready;
  return pool;
}

const postgresDriver = {
  name: 'postgres',

  async read(collection, id) {
    const db = await getPool();
    const { rows } = await db.query('select data from documents where collection = $1 and id = $2', [collection, id]);
    return rows[0]?.data ?? null;
  },

  async write(collection, id, value) {
    const db = await getPool();
    await db.query(
      `insert into documents (collection, id, data, updated_at)
       values ($1, $2, $3, now())
       on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
      [collection, id, JSON.stringify(value)],
    );
  },

  async remove(collection, id) {
    const db = await getPool();
    const { rowCount } = await db.query('delete from documents where collection = $1 and id = $2', [collection, id]);
    return rowCount > 0;
  },

  async list(collection) {
    const db = await getPool();
    const { rows } = await db.query('select data from documents where collection = $1', [collection]);
    return rows.map((row) => row.data);
  },
};

/* ---------- public interface ---------- */

const driver = process.env.DATABASE_URL ? postgresDriver : fileDriver;

export const driverName = driver.name;

/** Returns the stored document, or null when it does not exist. */
export async function readDoc(collection, id) {
  assertSafe(collection, id);
  return driver.read(collection, id);
}

export async function writeDoc(collection, id, value) {
  assertSafe(collection, id);
  return driver.write(collection, id, value);
}

/** Returns true when a document was actually removed. */
export async function deleteDoc(collection, id) {
  assertSafe(collection, id);
  return driver.remove(collection, id);
}

/** Every document in a collection, in no particular order. */
export async function listDocs(collection) {
  assertSafe(collection);
  return driver.list(collection);
}

/** Closes the database connection. Only used when a process shuts down. */
export async function close() {
  if (pool) await pool.end();
  pool = null;
  ready = null;
}
