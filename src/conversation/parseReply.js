/**
 * Parses the provider's JSON turn payload.
 *
 * Correction detection must never break the conversation. If the JSON is
 * malformed, the raw text becomes the reply and the turn carries no
 * corrections, so the user keeps talking instead of hitting an error.
 */

import { MISTAKE_TYPES } from './prompt.js';

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

function stripFence(text) {
  const match = text.trim().match(FENCE);
  return match ? match[1] : text;
}

/** Last resort: pull the outermost {...} out of a chatty response. */
function extractObject(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function cleanString(value, maxLength = 1000) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
}

function normalizeCorrection(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const original = cleanString(raw.original, 500);
  const corrected = cleanString(raw.corrected, 500);
  const explanation = cleanString(raw.explanation, 500);

  // A correction with nothing to compare, or one that changes nothing, tells
  // the user nothing. Drop it rather than showing an empty card.
  if (!original || !corrected) return null;
  if (original.toLowerCase() === corrected.toLowerCase()) return null;

  const type = MISTAKE_TYPES.includes(raw.type) ? raw.type : 'other';
  return { original, corrected, explanation, type };
}

/**
 * @param {string} text Raw provider output.
 * @returns {{reply: string, corrections: Array, parsed: boolean}}
 */
export function parseReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return { reply: '', corrections: [], parsed: false };

  const candidates = [stripFence(raw), extractObject(raw)].filter(Boolean);

  for (const candidate of candidates) {
    let data;
    try {
      data = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!data || typeof data !== 'object') continue;

    const reply = cleanString(data.reply, 4000);
    if (!reply) continue;

    const corrections = Array.isArray(data.corrections)
      ? data.corrections.map(normalizeCorrection).filter(Boolean).slice(0, 5)
      : [];

    return { reply, corrections, parsed: true };
  }

  return { reply: raw.slice(0, 4000), corrections: [], parsed: false };
}
