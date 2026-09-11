/**
 * Neural speech, generated on the listener's own machine.
 *
 * The voices a browser ships with are decided by the operating system, and on
 * Windows they are a decade old. Kokoro is an 82-million-parameter speech
 * model under Apache 2.0, so it can be used commercially at no cost, and it
 * runs here in the page: no API key, no per-word billing, and nothing to pay
 * however many people use the app.
 *
 * The price is paid by the listener, once: the model is downloaded the first
 * time, then cached by the browser and reused offline. That is why this is
 * never loaded unless somebody asks for it — see load().
 *
 * The model itself lives in kokoro-worker.js, off the page's thread. This file
 * only asks it for audio, plays what comes back, and guesses which word is
 * being said. It mirrors speech.js: both expose speak() and stop() with the
 * same options, so tts.js can route between them without the conversation
 * screen knowing which one answered.
 */

/**
 * Six voices, chosen from the model's own quality grades: af_heart is graded
 * A, af_bella A-, bf_emma B-, and am_michael, am_fenrir and bm_george are the
 * best of the remaining American men and British men. The other 48 voices are
 * graded C and below, and a shipped portrait exists for exactly these six.
 */
export const VOICES = [
  { id: 'af_heart', name: 'Heart', lang: 'en-US' },
  { id: 'af_bella', name: 'Bella', lang: 'en-US' },
  { id: 'am_michael', name: 'Michael', lang: 'en-US' },
  { id: 'am_fenrir', name: 'Fenrir', lang: 'en-US' },
  { id: 'bf_emma', name: 'Emma', lang: 'en-GB' },
  { id: 'bm_george', name: 'George', lang: 'en-GB' },
].map((voice) => ({ ...voice, voiceURI: `kokoro:${voice.id}`, engine: 'kokoro' }));

/** Module workers, WebAssembly and Web Audio. All three or none of this works. */
export const isSupported =
  typeof Worker === 'function' &&
  typeof WebAssembly === 'object' &&
  typeof (window.AudioContext || window.webkitAudioContext) === 'function';

export function findVoice(voiceURI) {
  return VOICES.find((voice) => voice.voiceURI === voiceURI) || null;
}

export function isKokoroVoice(voiceURI) {
  return typeof voiceURI === 'string' && voiceURI.startsWith('kokoro:');
}

/**
 * Roughly what picking a voice will cost to download, for saying so before it
 * is spent. The worker chooses between two builds by the same test, so this
 * stays honest without the two files having to agree about anything else.
 */
export const downloadSize = self.crossOriginIsolated ? '165MB' : '95MB';

/* ---------- the worker ---------- */

/** idle, loading, ready or failed. Drives what the voices window offers. */
let state = { phase: 'idle', percent: 0, loaded: 0, total: 0, error: null };
const watchers = new Set();

let worker = null;
let loading = null;
/** The utterance each incoming chunk belongs to, by id. */
const inFlight = new Map();
let nextId = 1;

function announce(next) {
  state = { ...state, ...next };
  for (const watcher of watchers) watcher(state);
}

/** @returns {() => void} Stops watching. */
export function onStatus(watcher) {
  watcher(state);
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

export function status() {
  return state;
}

function handleMessage(message) {
  if (message.type === 'progress') {
    announce({ percent: message.percent, loaded: message.loaded, total: message.total });
    return;
  }
  if (message.type === 'ready') {
    announce({ phase: 'ready', percent: 100 });
    return;
  }
  if (message.type === 'failed') {
    announce({ phase: 'failed', percent: 0, error: new Error(message.message) });
    return;
  }

  const utterance = inFlight.get(message.id);
  if (!utterance) return;

  if (message.type === 'chunk') utterance.receive(message);
  else utterance.close(message.type === 'error' ? new Error(message.message) : null);
}

/**
 * Downloads the model and keeps it. Safe to call repeatedly: the first call
 * does the work and every later one waits on that same promise.
 */
export function load() {
  if (!isSupported) return Promise.reject(new Error('This browser cannot run the downloaded voices.'));
  if (state.phase === 'ready') return Promise.resolve();
  if (loading) return loading;

  announce({ phase: 'loading', percent: 0, loaded: 0, total: 0, error: null });

  if (!worker) {
    worker = new Worker('/kokoro-worker.js', { type: 'module' });
    worker.addEventListener('message', (event) => handleMessage(event.data));
    worker.addEventListener('error', () => {
      // Almost always the worker script arriving without the header the page
      // requires, which is a server setting rather than anything the listener
      // can act on — so the message does not send them to check their wifi.
      announce({
        phase: 'failed',
        percent: 0,
        error: new Error('The voices cannot start on this site.'),
      });
    });
  }

  loading = new Promise((resolve, reject) => {
    const stop = onStatus((next) => {
      if (next.phase === 'ready') {
        stop();
        resolve();
      } else if (next.phase === 'failed') {
        stop();
        // Cleared so a later attempt can retry: a dropped connection should
        // not disable better voices for the rest of the session.
        loading = null;
        reject(next.error);
      }
    });
    worker.postMessage({ type: 'load' });
  });

  return loading;
}

/* ---------- word timing ---------- */

const WORD_PATTERN = /\S+/g;

/**
 * Guesses when each word in a sentence is spoken.
 *
 * The model returns one finished clip and says nothing about what happens
 * where inside it, so there is no true answer to copy. What is known is the
 * clip's exact length, so that length is shared out across the words: longer
 * words take longer to say, and a comma or full stop buys the word before it
 * some extra time for the pause that follows.
 *
 * The result can sit a word ahead or behind in the middle of a long sentence.
 * It cannot drift away entirely, because every sentence is measured against
 * its own real duration and so re-synchronises at each full stop.
 *
 * @param {string} text The whole reply, which the highlight indexes into.
 * @param {number} from Where this sentence starts in that text.
 * @param {string} sentence
 * @param {number} startedAt Audio-clock time when this sentence starts.
 * @param {number} duration Real length of the clip, in seconds.
 */
function scheduleWords(text, from, sentence, startedAt, duration) {
  const words = [];
  let weight = 0;

  for (const match of sentence.matchAll(WORD_PATTERN)) {
    const word = match[0];
    // A short word still takes time to say, hence the floor rather than a
    // plain character count, which would race through "a" and "of".
    let cost = Math.max(word.length, 2);
    if (/[,;:]$/.test(word)) cost += 2;
    if (/[.!?…]$/.test(word)) cost += 4;

    words.push({ start: from + match.index, end: from + match.index + word.length, cost });
    weight += cost;
  }

  if (weight === 0) return [];

  let elapsed = 0;
  return words.map((word) => {
    const at = startedAt + (elapsed / weight) * duration;
    elapsed += word.cost;
    return { at, range: { start: word.start, end: word.end } };
  });
}

/* ---------- speaking ---------- */

let context = null;

function audio() {
  if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
  return context;
}

/** The utterance being spoken, so stop() can take all of it down at once. */
let current = null;

export function stop() {
  if (!current) return;
  const utterance = current;
  current = null;

  utterance.cancelled = true;
  worker?.postMessage({ type: 'cancel', id: utterance.id });
  inFlight.delete(utterance.id);

  if (utterance.ticker) clearInterval(utterance.ticker);
  for (const source of utterance.sources) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already finished. Stopping a stopped source throws in some browsers.
    }
  }
  utterance.finish();
}

/**
 * Speaks one reply.
 *
 * The reply is made a sentence at a time, and the first sentence starts
 * playing while the rest are still being generated. Waiting for a whole reply
 * before any sound came out would feel broken, and it would get worse the more
 * the model had to say.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {{id: string}} [options.voice]
 * @param {number} [options.rate]
 * @param {() => void} [options.onPrepare] Fires when generation starts, before
 *   any audio exists. The reply is on screen but silent during this.
 * @param {() => void} [options.onStart] Fires when sound actually begins.
 * @param {(range: {start: number, end: number}) => void} [options.onWord]
 * @param {(error: Error) => void} [options.onError] Fires only when this
 *   utterance actually failed — not when it was stopped or replaced.
 * @param {() => void} [options.onEnd] Also fires on error or stop.
 * @returns {boolean} false when this engine cannot speak at all.
 */
export function speak(text, { voice = null, rate = 1, onPrepare, onStart, onWord, onError, onEnd } = {}) {
  if (!isSupported || !text) return false;

  stop();

  const id = nextId++;
  const utterance = {
    id,
    cancelled: false,
    ended: false,
    sources: [],
    schedule: [],
    painted: null,
    ticker: null,
    cursor: 0,
    queueEnd: 0,
    started: false,
    streamed: false,
  };

  utterance.finish = () => {
    if (utterance.ended) return;
    utterance.ended = true;
    if (utterance.ticker) clearInterval(utterance.ticker);
    inFlight.delete(id);
    if (current === utterance) current = null;
    onEnd?.();
  };

  /**
   * One loop for the whole reply, walking a schedule the worker extends.
   *
   * A timer rather than an animation frame: a browser stops animation frames
   * altogether in a tab nobody is looking at, and the highlight would be left
   * on whatever word happened to be showing when the tab went away.
   */
  const followAlong = () => {
    if (utterance.cancelled) return;
    const now = audio().currentTime;

    // Anything already past is dropped, so a loop that was throttled while the
    // tab sat in the background catches up in one step rather than racing
    // through every word it missed.
    while (utterance.schedule.length > 1 && utterance.schedule[1].at <= now) utterance.schedule.shift();
    const next = utterance.schedule[0];
    if (next && next.at <= now && next !== utterance.painted) {
      utterance.painted = next;
      onWord?.(next.range);
    }
  };

  utterance.receive = ({ text: sentence, audio: samples, sampleRate }) => {
    if (utterance.cancelled) return;

    const ctx = audio();
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Queued back to back. A sentence generated slower than the one before it
    // plays leaves a gap, which lands at a full stop and passes for a pause
    // rather than a fault.
    const at = Math.max(ctx.currentTime + 0.05, utterance.queueEnd);
    source.start(at);
    utterance.queueEnd = at + buffer.duration;
    utterance.sources.push(source);
    utterance.streamed = true;

    // The worker sends the sentence exactly as it appeared in the text, so it
    // can be found again to index the highlight.
    const found = text.indexOf(sentence, utterance.cursor);
    if (found >= 0) {
      utterance.schedule.push(...scheduleWords(text, found, sentence, at, buffer.duration));
      utterance.cursor = found + sentence.length;
    }

    if (!utterance.started) {
      utterance.started = true;
      onStart?.();
      // 50ms is well inside the shortest word and far cheaper than a frame
      // loop, which would run twenty times as often to paint the same thing.
      utterance.ticker = setInterval(followAlong, 50);
    }
  };

  /** The worker has no more sentences: end when the queued audio runs out. */
  utterance.close = (error) => {
    if (utterance.cancelled) return;
    if (error) onError?.(error);

    const last = utterance.sources.at(-1);
    if (!last || !utterance.streamed) {
      utterance.finish();
      return;
    }
    last.onended = utterance.finish;
  };

  current = utterance;
  inFlight.set(id, utterance);
  onPrepare?.();

  load()
    .then(async () => {
      if (utterance.cancelled) return;
      // Browsers leave the audio clock suspended until a gesture. Every path
      // here follows a click or a spoken turn, so this resolves immediately.
      await audio().resume();
      if (utterance.cancelled) return;

      worker.postMessage({ type: 'speak', id, text, voice: voice?.id || VOICES[0].id, speed: rate });
    })
    .catch((error) => {
      if (!utterance.cancelled) onError?.(error);
      utterance.finish();
    });

  return true;
}
