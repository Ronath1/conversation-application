/**
 * Text-to-speech, using the browser's own speech synthesis.
 *
 * Browser-native keeps this free and offline-ish, at the cost of voice quality
 * varying by machine. A provider TTS API can replace this module later without
 * the conversation screen changing: it only calls speak(), stop() and the
 * voice helpers below.
 */

const synth = window.speechSynthesis;

/** Chrome silently stops long utterances after ~15s unless it is nudged. */
const KEEP_ALIVE_MS = 10_000;

let keepAliveTimer = null;
/** Held so the browser cannot garbage-collect the utterance mid-speech. */
let currentUtterance = null;

export const isSupported = Boolean(synth);

function startKeepAlive() {
  stopKeepAlive();
  keepAliveTimer = setInterval(() => {
    if (!synth.speaking || synth.paused) return;
    synth.pause();
    synth.resume();
  }, KEEP_ALIVE_MS);
}

function stopKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

/** English voices only. The app is for practising English. */
export function listVoices() {
  if (!synth) return [];
  return synth
    .getVoices()
    .filter((voice) => voice.lang?.toLowerCase().startsWith('en'))
    .sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
}

/**
 * Voices load asynchronously in most browsers, so the first getVoices() call
 * often returns an empty list. Call the listener again when they arrive.
 */
export function onVoicesReady(listener) {
  if (!synth) return;
  if (listVoices().length > 0) listener(listVoices());
  synth.addEventListener('voiceschanged', () => listener(listVoices()));
}

export function findVoice(voiceURI) {
  if (!voiceURI) return null;
  return listVoices().find((voice) => voice.voiceURI === voiceURI) || null;
}

export function stop() {
  stopKeepAlive();
  currentUtterance = null;
  if (synth?.speaking || synth?.pending) synth.cancel();
}

/**
 * Speaks one reply.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {SpeechSynthesisVoice|null} [options.voice]
 * @param {number} [options.rate] 0.85 for beginners, 1 for normal pace.
 * @param {(range: {start: number, end: number}) => void} [options.onWord]
 *   Fires per spoken word so the caller can highlight it. Not every browser
 *   sends these events; treat highlighting as a bonus, never as required.
 * @param {() => void} [options.onStart]
 * @param {() => void} [options.onEnd] Also fires on error or cancel.
 * @returns {boolean} false when the browser cannot speak.
 */
export function speak(text, { voice = null, rate = 1, onWord, onStart, onEnd } = {}) {
  if (!synth || !text) return false;

  stop();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voice?.lang || 'en-US';
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  utterance.pitch = 1;

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    stopKeepAlive();
    currentUtterance = null;
    onEnd?.();
  };

  utterance.addEventListener('start', () => {
    startKeepAlive();
    onStart?.();
  });

  utterance.addEventListener('boundary', (event) => {
    if (event.name && event.name !== 'word') return;
    const start = event.charIndex ?? 0;
    // charLength is missing in some browsers; fall back to the next space.
    const length = event.charLength || text.slice(start).search(/\s|$/) || 0;
    onWord?.({ start, end: start + length });
  });

  utterance.addEventListener('end', finish);
  utterance.addEventListener('error', finish);

  currentUtterance = utterance;

  // Chrome drops an utterance queued in the same tick as a cancel().
  setTimeout(() => {
    if (currentUtterance !== utterance) return;
    synth.speak(utterance);
  }, 60);

  return true;
}
