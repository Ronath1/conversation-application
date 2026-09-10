/**
 * Document storage.
 *
 * Everything the app keeps — the API key, sessions, usage counts — is a small
 * JSON document identified by an owner, a collection and an id. This module is
 * the only place that knows where those documents actually live.
 *
 * The owner is the signed-in user. It is part of the address of every
 * document, not a field inside one, so reading another account's data is not
 * something a caller can do by forgetting a filter.
 *
 * Two drivers, chosen by whether DATABASE_URL is set:
 *
 *   files     data/<owner>/<collection>/<id>.json. The default, so local
 *             development needs no database at all.
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

/** Owners and ids reach here from tokens and URLs, so they are checked. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,200}$/;

function assertSafe(owner, collection, id) {
  if (!SAFE_ID.test(owner)) throw new Error(`Invalid owner: ${owner}`);
  if (!SAFE_ID.test(collection)) throw new Error(`Invalid collection: ${collection}`);
  if (id !== undefined && !SAFE_ID.test(id)) throw new Error(`Invalid document id: ${id}`);
}

/* ---------- file driver ---------- */

function filePath(owner, collection, id) {
  return path.join(DATA_DIR, owner, collection, `${id}.json`);
}

const fileDriver = {
  name: 'files',

  async read(owner, collection, id) {
    return readJson(filePath(owner, collection, id), null);
  },

  async write(owner, collection, id, value) {
    await writeJsonAtomic(filePath(owner, collection, id), value);
  },

  async remove(owner, collection, id) {
    try {
      await fs.unlink(filePath(owner, collection, id));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  },

  async list(owner, collection) {
    const dir = path.join(DATA_DIR, owner, collection);
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
 * One table for every collection and every owner. The documents are small and
 * always read whole, so a table per collection would buy nothing.
 *
 * The statements are written to be safe to re-run, including against a table
 * created before documents had an owner.
 */
const SCHEMA = `
  create table if not exists documents (
    collection text not null,
    id text not null,
    data jsonb not null,
    updated_at timestamptz not null default now()
  );
  alter table documents add column if not exists owner text not null default '_shared';
  alter table documents drop constraint if exists documents_pkey;
  create unique index if not exists documents_owner_key on documents (owner, collection, id);
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
  // The table is prepared once per process, not once per query.
  if (!ready) ready = pool.query(SCHEMA);
  await ready;
  return pool;
}

const postgresDriver = {
  name: 'postgres',

  async read(owner, collection, id) {
    const db = await getPool();
    const { rows } = await db.query(
      'select data from documents where owner = $1 and collection = $2 and id = $3',
      [owner, collection, id],
    );
    return rows[0]?.data ?? null;
  },

  async write(owner, collection, id, value) {
    const db = await getPool();
    await db.query(
      `insert into documents (owner, collection, id, data, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (owner, collection, id) do update set data = excluded.data, updated_at = now()`,
      [owner, collection, id, JSON.stringify(value)],
    );
  },

  async remove(owner, collection, id) {
    const db = await getPool();
    const { rowCount } = await db.query(
      'delete from documents where owner = $1 and collection = $2 and id = $3',
      [owner, collection, id],
    );
    return rowCount > 0;
  },

  async list(owner, collection) {
    const db = await getPool();
    const { rows } = await db.query(
      'select data from documents where owner = $1 and collection = $2',
      [owner, collection],
    );
    return rows.map((row) => row.data);
  },
};

/* ---------- public interface ---------- */

const driver = process.env.DATABASE_URL ? postgresDriver : fileDriver;

export const driverName = driver.name;

/** Returns the stored document, or null when it does not exist. */
export async function readDoc(owner, collection, id) {
  assertSafe(owner, collection, id);
  return driver.read(owner, collection, id);
}

export async function writeDoc(owner, collection, id, value) {
  assertSafe(owner, collection, id);
  return driver.write(owner, collection, id, value);
}

/** Returns true when a document was actually removed. */
export async function deleteDoc(owner, collection, id) {
  assertSafe(owner, collection, id);
  return driver.remove(owner, collection, id);
}

/** Every document one owner has in a collection, in no particular order. */
export async function listDocs(owner, collection) {
  assertSafe(owner, collection);
  return driver.list(owner, collection);
}

/** Closes the database connection. Only used when a process shuts down. */
export async function close() {
  if (pool) await pool.end();
  pool = null;
  ready = null;
}
