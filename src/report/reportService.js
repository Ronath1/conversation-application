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

/**
 * The calendar day a timestamp fell on, in the reader's own zone.
 *
 * Slicing the ISO string would give the UTC day, which puts a late evening's
 * practice on the following date for anyone east of London. The browser sends
 * its offset so the days here are the days the person actually lived.
 *
 * @param {string} isoDate
 * @param {number} offsetMinutes From Date.getTimezoneOffset(): UTC minus local.
 */
function toDay(isoDate, offsetMinutes = 0) {
  if (!isoDate) return '';
  const time = new Date(isoDate).getTime();
  if (Number.isNaN(time)) return '';
  return new Date(time - offsetMinutes * 60_000).toISOString().slice(0, 10);
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
 * Every day that has either a turn or a mistake on it, oldest first.
 *
 * The calendar and the heatmap both need the whole history, not a window, so
 * this is built once and the trend is a slice of it. A day with turns and no
 * mistakes is kept: a clean day is a result, not an absence of data.
 */
function buildDays(sessions, mistakes, offsetMinutes) {
  const days = new Map();

  const entryFor = (day) => {
    const existing = days.get(day);
    if (existing) return existing;
    const created = { date: day, turns: 0, mistakes: 0 };
    days.set(day, created);
    return created;
  };

  for (const session of sessions) {
    for (const turn of session.turns || []) {
      const day = toDay(turn.at, offsetMinutes);
      if (day) entryFor(day).turns += 1;
    }
  }

  for (const mistake of mistakes) {
    const day = toDay(mistake.at, offsetMinutes);
    if (day) entryFor(day).mistakes += 1;
  }

  return [...days.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      ...entry,
      mistakesPerTurn: entry.turns ? Number((entry.mistakes / entry.turns).toFixed(2)) : 0,
    }));
}

/**
 * @param {object} [filter]
 * @param {string} [filter.type] Limit the log to one mistake type.
 * @param {string} [filter.sessionId] Limit the log to one session.
 * @param {string} [filter.from] Earliest day to show, as YYYY-MM-DD.
 * @param {string} [filter.to] Latest day to show, as YYYY-MM-DD. Inclusive.
 * @param {number} [filter.offsetMinutes] The reader's Date.getTimezoneOffset().
 * @param {number} [filter.limit] Log entries returned. Totals ignore it.
 */
export async function buildReport(userId, { type, sessionId, from, to, offsetMinutes = 0, limit = 200 } = {}) {
  const sessions = await readAllSessions(userId);
  const mistakes = collectMistakes(sessions);

  const turnCount = sessions.reduce((total, session) => total + (session.turns?.length || 0), 0);
  const days = buildDays(sessions, mistakes, offsetMinutes);

  // Filters narrow the log only. The totals always describe everything stored,
  // so a filtered view cannot be mistaken for the whole picture.
  let log = mistakes;
  if (type) log = log.filter((mistake) => mistake.type === type);
  if (sessionId) log = log.filter((mistake) => mistake.sessionId === sessionId);
  // The same day boundary the calendar was built with, so clicking a day shows
  // exactly the mistakes that day's square counted.
  if (from) log = log.filter((mistake) => toDay(mistake.at, offsetMinutes) >= from);
  if (to) log = log.filter((mistake) => toDay(mistake.at, offsetMinutes) <= to);

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
    trend: days.slice(-TREND_DAYS),
    calendar: days,
    sessions: sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      topic: session.topic,
      turnCount: session.turns?.length || 0,
      mistakeCount: (session.turns || []).reduce((total, turn) => total + (turn.corrections?.length || 0), 0),
    })),
    filtered: {
      type: type || null,
      sessionId: sessionId || null,
      from: from || null,
      to: to || null,
      count: log.length,
    },
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
