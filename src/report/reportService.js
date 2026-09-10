/**
 * The permanent mistake report.
 *
 * Reads the stored sessions and derives every view from them. Nothing is kept
 * in a second place, so a mistake shown here is the same record the turn was
 * saved with, whether or not it is still on the conversation screen.
 */

import { readAllSessions } from '../conversation/sessionStore.js';

const TREND_DAYS = 14;

/** Collapses spacing and case so two sayings of the same thing group together. */
function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toDay(isoDate) {
  return String(isoDate || '').slice(0, 10);
}

/** Flattens sessions into one mistake list, newest first. */
function collectMistakes(sessions) {
  const mistakes = [];

  for (const session of sessions) {
    for (const turn of session.turns || []) {
      for (const [index, correction] of (turn.corrections || []).entries()) {
        mistakes.push({
          id: `${session.id}:${turn.id}:${index}`,
          at: turn.at,
          sessionId: session.id,
          topic: session.topic,
          difficulty: session.difficulty,
          said: turn.user,
          original: correction.original,
          corrected: correction.corrected,
          explanation: correction.explanation,
          type: correction.type,
        });
      }
    }
  }

  mistakes.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return mistakes;
}

function countByType(mistakes) {
  const counts = new Map();
  for (const mistake of mistakes) counts.set(mistake.type, (counts.get(mistake.type) || 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);
}

/**
 * The same slip made more than once. This is the list worth studying: a
 * one-off is noise, a repeat is a habit.
 */
function findRecurring(mistakes) {
  const groups = new Map();

  for (const mistake of mistakes) {
    const key = `${mistake.type}|${normalize(mistake.original)}`;
    const group = groups.get(key) || {
      type: mistake.type,
      original: mistake.original,
      corrected: mistake.corrected,
      explanation: mistake.explanation,
      count: 0,
      lastAt: mistake.at,
    };
    group.count += 1;
    if (String(mistake.at) > String(group.lastAt)) group.lastAt = mistake.at;
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.count > 1)
    .sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)));
}

/**
 * Mistakes per turn, by day. Mistake count alone rewards talking less, so the
 * rate is what shows whether the speaking is getting cleaner.
 */
function buildTrend(sessions, mistakes) {
  const days = new Map();

  for (const session of sessions) {
    for (const turn of session.turns || []) {
      const day = toDay(turn.at);
      if (!day) continue;
      const entry = days.get(day) || { date: day, turns: 0, mistakes: 0 };
      entry.turns += 1;
      days.set(day, entry);
    }
  }

  for (const mistake of mistakes) {
    const day = toDay(mistake.at);
    const entry = days.get(day) || { date: day, turns: 0, mistakes: 0 };
    entry.mistakes += 1;
    days.set(day, entry);
  }

  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-TREND_DAYS)
    .map((entry) => ({
      ...entry,
      mistakesPerTurn: entry.turns ? Number((entry.mistakes / entry.turns).toFixed(2)) : 0,
    }));
}

/**
 * @param {object} [filter]
 * @param {string} [filter.type] Limit the log to one mistake type.
 * @param {string} [filter.sessionId] Limit the log to one session.
 * @param {number} [filter.limit] Log entries returned. Totals ignore it.
 */
export async function buildReport(userId, { type, sessionId, limit = 200 } = {}) {
  const sessions = await readAllSessions(userId);
  const mistakes = collectMistakes(sessions);

  const turnCount = sessions.reduce((total, session) => total + (session.turns?.length || 0), 0);

  // Filters narrow the log only. The totals always describe everything stored,
  // so a filtered view cannot be mistaken for the whole picture.
  let log = mistakes;
  if (type) log = log.filter((mistake) => mistake.type === type);
  if (sessionId) log = log.filter((mistake) => mistake.sessionId === sessionId);

  return {
    totals: {
      sessions: sessions.length,
      turns: turnCount,
      mistakes: mistakes.length,
      cleanTurns: countCleanTurns(sessions),
      mistakesPerTurn: turnCount ? Number((mistakes.length / turnCount).toFixed(2)) : 0,
    },
    byType: countByType(mistakes),
    recurring: findRecurring(mistakes).slice(0, 20),
    trend: buildTrend(sessions, mistakes),
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      topic: session.topic,
      turnCount: session.turns?.length || 0,
      mistakeCount: (session.turns || []).reduce((total, turn) => total + (turn.corrections?.length || 0), 0),
    })),
    filtered: { type: type || null, sessionId: sessionId || null, count: log.length },
    mistakes: log.slice(0, limit),
  };
}

function countCleanTurns(sessions) {
  return sessions.reduce(
    (total, session) =>
      total + (session.turns || []).filter((turn) => (turn.corrections?.length || 0) === 0).length,
    0,
  );
}
