/**
 * One conversation turn, end to end.
 *
 * Takes what the user said, sends it with the recent history, and returns the
 * spoken reply plus any corrections for that turn. The turn is stored before
 * it is returned, so a correction survives even if the browser tab dies.
 */

import { getAiReply } from '../providers/index.js';
import { ErrorCode, ProviderError } from '../providers/errors.js';
import * as sessionStore from './sessionStore.js';
import { parseReply } from './parseReply.js';
import { findNewVocabulary } from './vocabulary.js';
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_TOPIC,
  REPLY_SCHEMA,
  buildSystemPrompt,
  findDifficulty,
  findTopic,
} from './prompt.js';

/** How many past turns travel with each request. Bounds cost and latency. */
const HISTORY_TURN_LIMIT = 12;
const MAX_USER_TEXT_LENGTH = 2000;

/** Turns stored history into the neutral message list adapters accept. */
function toMessages(session, userText) {
  const recent = session.turns.slice(-HISTORY_TURN_LIMIT);
  const messages = [];

  for (const turn of recent) {
    if (turn.user) messages.push({ role: 'user', content: turn.user });
    if (turn.reply) messages.push({ role: 'assistant', content: turn.reply });
  }

  messages.push({ role: 'user', content: userText });
  return messages;
}

export function validateTopic(topic) {
  if (topic === undefined || topic === null) return DEFAULT_TOPIC;
  if (!findTopic(topic)) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, `Unknown topic "${topic}".`, { status: 400 });
  }
  return topic;
}

export function validateDifficulty(difficulty) {
  if (difficulty === undefined || difficulty === null) return DEFAULT_DIFFICULTY;
  if (!findDifficulty(difficulty)) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, `Unknown difficulty "${difficulty}".`, { status: 400 });
  }
  return difficulty;
}

/**
 * Runs one turn against the active provider and stores the result.
 *
 * @param {string} sessionId
 * @param {string} text What the user said, as transcribed.
 * @returns {Promise<{turn: object, reply: string, corrections: Array, session: object}>}
 */
export async function takeTurn(sessionId, text) {
  const session = await sessionStore.getSession(sessionId);
  if (!session) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'Session not found.', { status: 404 });
  }
  if (session.endedAt) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'This session has ended. Start a new one.', { status: 409 });
  }

  const userText = String(text || '').trim();
  if (!userText) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, 'text is required.', { status: 400 });
  }
  if (userText.length > MAX_USER_TEXT_LENGTH) {
    throw new ProviderError(ErrorCode.BAD_REQUEST, `text must be ${MAX_USER_TEXT_LENGTH} characters or fewer.`, {
      status: 400,
    });
  }

  const result = await getAiReply({
    provider: session.provider || undefined,
    messages: toMessages(session, userText),
    systemPrompt: buildSystemPrompt(session),
    responseSchema: REPLY_SCHEMA,
    temperature: 0.8,
    // Thinking tokens count against this ceiling, so leave room above the reply.
    maxOutputTokens: 2048,
    // Spoken conversation: latency matters more than depth. Each adapter
    // decides what that means for its own provider.
    lowLatency: true,
  });

  const { reply, corrections, parsed } = parseReply(result.text);
  if (!reply) {
    throw new ProviderError(ErrorCode.PROVIDER_ERROR, 'The provider returned no usable reply.', {
      provider: result.provider,
    });
  }

  const appended = await sessionStore.appendTurn(sessionId, {
    user: userText,
    reply,
    corrections,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
    // Recorded so a run of unparsed turns is visible instead of silent.
    structured: parsed,
  });

  return {
    sessionId,
    turn: appended.turn,
    reply,
    corrections,
    provider: result.provider,
    model: result.model,
    usage: result.usage,
  };
}

/** The end-of-session recap: mistakes, error types, new words and talk time. */
export function summarize(session) {
  const turns = session.turns || [];
  const corrections = turns.flatMap((turn) => turn.corrections || []);

  const byType = {};
  for (const correction of corrections) {
    byType[correction.type] = (byType[correction.type] || 0) + 1;
  }

  const started = session.createdAt ? Date.parse(session.createdAt) : null;
  const ended = session.endedAt ? Date.parse(session.endedAt) : Date.parse(session.updatedAt || session.createdAt);
  const durationSeconds = started && ended ? Math.max(0, Math.round((ended - started) / 1000)) : null;

  const userWords = turns.reduce((total, turn) => total + String(turn.user || '').split(/\s+/).filter(Boolean).length, 0);

  return {
    sessionId: session.id,
    topic: session.topic,
    difficulty: session.difficulty,
    turnCount: turns.length,
    mistakeCount: corrections.length,
    cleanTurnCount: turns.filter((turn) => (turn.corrections?.length || 0) === 0).length,
    mistakesByType: Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])),
    userWordCount: userWords,
    wordsPerTurn: turns.length ? Math.round(userWords / turns.length) : 0,
    // Rough talk time: 130 words per minute is a normal conversational pace.
    speakingSecondsEstimate: Math.round((userWords / 130) * 60),
    durationSeconds,
    newVocabulary: findNewVocabulary(session),
    startedAt: session.createdAt,
    endedAt: session.endedAt,
  };
}
