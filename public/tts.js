/**
 * One speaking surface over two engines.
 *
 * speech.js uses the voices the device already has: instant, free, and on
 * Windows they sound like 2013. kokoro.js runs a neural model in the page:
 * far better, at the cost of a one-time download the listener has to agree
 * to. Neither is right for everybody, so both stay and the voice decides.
 *
 * Everything above this file — the conversation screen, the voices window —
 * calls speak() and stop() and never learns which engine answered.
 */

import * as kokoro from './kokoro.js';
import * as speech from './speech.js';

/** True when anything at all can talk. */
export const isSupported = speech.isSupported || kokoro.isSupported;

/** The device's own voices. Empty until the browser has loaded them. */
export function listVoices() {
  return speech.listVoices();
}

export function onVoicesReady(listener) {
  return speech.onVoicesReady(listener);
}

/**
 * The downloadable voices. These are the same six on every device, because
 * they come from the model rather than from the operating system.
 */
export function neuralVoices() {
  return kokoro.isSupported ? kokoro.VOICES : [];
}

export const isNeural = kokoro.isKokoroVoice;

export function findVoice(voiceURI) {
  if (isNeural(voiceURI)) return kokoro.findVoice(voiceURI);
  return speech.findVoice(voiceURI);
}

/* ---------- the download ---------- */

export const neuralStatus = kokoro.status;
export const onNeuralStatus = kokoro.onStatus;

/** Starts the download, or resolves at once if it already happened. */
export function loadNeural() {
  return kokoro.load();
}

/* ---------- speaking ---------- */

export function stop() {
  speech.stop();
  kokoro.stop();
}

/**
 * Speaks one reply with whichever engine owns the voice.
 *
 * @param {string} text
 * @param {object} [options] As speech.js, plus onPrepare and onError, which
 *   only a downloaded voice can raise: it takes seconds to make audio, and it
 *   can fail after speak() has already returned. A device voice is immediate
 *   and fires neither.
 * @returns {boolean}
 */
export function speak(text, options = {}) {
  const voice = options.voice;

  if (voice && isNeural(voice.voiceURI)) {
    if (!kokoro.isSupported) return false;
    return kokoro.speak(text, options);
  }

  // Dropped rather than passed on, so the difference between the two engines
  // stays in this one place instead of in every caller.
  const { onPrepare, onError, ...rest } = options;
  return speech.speak(text, rest);
}
