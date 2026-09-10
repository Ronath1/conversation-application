/**
 * Session storage: one document per session.
 *
 * A session holds the full turn history, including every correction. The
 * mistake report reads these same documents, so a correction is kept whether
 * or not it is still on screen.
 */

import { randomUUID } from 'node:crypto';
import { deleteDoc, listDocs, readDoc, writeDoc } from '../lib/store.js';
import { DEFAULT_DIFFICULTY, DEFAULT_TOPIC } from './prompt.js';

const COLLECTION = 'sessions';

/** Ids come from randomUUID, so anything else is a bad or hostile id. */
const SESSION_ID_PATTERN = /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One promise chain per session. Every change runs read, modify and write
 * inside this chain: serializing only the write would let two overlapping
 * requests both read the old session and the later write would drop the
 * earlier change.
 *
 * This holds within one process. Two server instances writing to the same
 * session at the same moment could still overlap, which for a single user
 * talking into one browser tab does not arise.
 */
const writeChains = new Map();

export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId);
}

function assertValid(sessionId) {
  if (!isValidSessionId(sessionId)) throw new Error(`Invalid session id: ${sessionId}`);
}

function persist(session) {
  return writeDoc(COLLECTION, session.id, session);
}

/**
 * Runs one read-modify-write against a session, queued behind any other change
 * to the same session.
 *
 * @param {string} sessionId
 * @param {(session: object) => any} mutator Returns a value passed back to the
 *   caller. Returning undefined means "no change"; nothing is written.
 */
function mutate(sessionId, mutator) {
  const previous = writeChains.get(sessionId) || Promise.resolve();

  const next = previous.catch(() => {}).then(async () => {
    const session = await getSession(sessionId);
    if (!session) return null;
    const result = mutator(session);
    if (result === undefined) return session;
    await persist(session);
    return result;
  });

  writeChains.set(sessionId, next);
  return next;
}

export async function createSession({ topic = DEFAULT_TOPIC, difficulty = DEFAULT_DIFFICULTY, provider = null } = {}) {
  const now = new Date().toISOString();
  const session = {
    id: `sess_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
    topic,
    difficulty,
    provider,
    turns: [],
  };
  await persist(session);
  return session;
}

export async function getSession(sessionId) {
  if (!isValidSessionId(sessionId)) return null;
  return readDoc(COLLECTION, sessionId);
}

/** Appends a completed turn: what the user said, the reply, any corrections. */
export async function appendTurn(sessionId, turn) {
  assertValid(sessionId);
  return mutate(sessionId, (session) => {
    const record = {
      id: `turn_${session.turns.length + 1}`,
      at: new Date().toISOString(),
      ...turn,
    };
    session.turns.push(record);
    session.updatedAt = record.at;
    return { session, turn: record };
  });
}

export async function updateSession(sessionId, patch) {
  assertValid(sessionId);
  return mutate(sessionId, (session) => {
    Object.assign(session, patch, { updatedAt: new Date().toISOString() });
    return session;
  });
}

export async function endSession(sessionId) {
  assertValid(sessionId);
  return mutate(sessionId, (session) => {
    // Already ended: return the session without rewriting the end time.
    if (session.endedAt) return undefined;
    session.endedAt = new Date().toISOString();
    session.updatedAt = session.endedAt;
    return session;
  });
}

/** Newest first. Summary rows only, without turn bodies. */
export async function listSessions({ limit = 50 } = {}) {
  const sessions = await readAllSessions();
  return sessions.slice(0, limit).map((session) => ({
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    endedAt: session.endedAt,
    topic: session.topic,
    difficulty: session.difficulty,
    turnCount: session.turns?.length || 0,
    mistakeCount: (session.turns || []).reduce((total, turn) => total + (turn.corrections?.length || 0), 0),
  }));
}

/** Every stored session in full, newest first. The mistake report builds on this. */
export async function readAllSessions() {
  const sessions = (await listDocs(COLLECTION)).filter((session) => session?.id);
  sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return sessions;
}

export async function deleteSession(sessionId) {
  if (!isValidSessionId(sessionId)) return false;
  writeChains.delete(sessionId);
  return deleteDoc(COLLECTION, sessionId);
}
