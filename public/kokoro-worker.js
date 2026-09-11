/**
 * The speech model, kept off the page's own thread.
 *
 * Running an 82-million-parameter model is seconds of solid arithmetic, and
 * WebAssembly does it on whichever thread calls it. Called from the page, that
 * thread is the one drawing the screen: the conversation would freeze mid-reply
 * and the Stop button would not answer. So all of it happens here, and only
 * finished audio crosses back.
 *
 * Messages in:  {type:'load'} | {type:'speak', id, text, voice, speed} | {type:'cancel'}
 * Messages out: {type:'progress'|'ready'|'failed'|'chunk'|'done'|'error'}
 *
 * Every reply carries an id. The model cannot be interrupted in the middle of
 * a sentence, so cancelling marks the id dead and the page throws away
 * anything that arrives for it afterwards.
 */

const LIBRARY = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * Which weights to fetch, decided by how many threads this page may use.
 *
 * WebAssembly gets more than one thread only in a cross-origin-isolated page,
 * and the two builds respond to that completely differently. Measured on one
 * machine, seconds of work per second of speech:
 *
 *            one thread   four threads
 *   8-bit       2.14          1.82
 *   16-bit      2.19          0.90
 *
 * The 8-bit build barely improves, because its quantised operations run on a
 * single thread whatever the page allows. So with one thread the smaller file
 * is free — same speed, 71MB less — and with several the larger one is the
 * only way under 1.0, which is the number that matters: below it each
 * sentence is ready before the one before it finishes, and the speech is
 * continuous. Above it the reply falls further behind at every full stop.
 */
const DTYPE = self.crossOriginIsolated ? 'fp16' : 'q8';

let model = null;
let Splitter = null;
let loading = null;
let cancelled = new Set();

/**
 * Turns per-file download events into one percentage.
 *
 * Several files arrive at once, so reporting whichever event landed last makes
 * the bar jump backwards. Totals are summed instead.
 */
function progressReporter() {
  const files = new Map();
  return (event) => {
    if (event.status !== 'progress' || !event.total) return;
    files.set(event.file, { loaded: event.loaded || 0, total: event.total });

    let loaded = 0;
    let total = 0;
    for (const file of files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    if (total > 0) {
      self.postMessage({ type: 'progress', percent: Math.min(99, Math.round((loaded / total) * 100)) });
    }
  };
}

function load() {
  if (model) return Promise.resolve(model);
  if (loading) return loading;

  loading = (async () => {
    const { KokoroTTS, TextSplitterStream } = await import(LIBRARY);
    Splitter = TextSplitterStream;
    model = await KokoroTTS.from_pretrained(MODEL, {
      dtype: DTYPE,
      device: 'wasm',
      progress_callback: progressReporter(),
    });
    return model;
  })();

  loading.catch(() => {
    // Cleared so a later attempt can retry: a dropped connection should not
    // disable better voices for the rest of the session.
    loading = null;
  });

  return loading;
}

async function speak({ id, text, voice, speed }) {
  const ready = await load();
  if (cancelled.has(id)) return;

  // Built here rather than letting stream() take the string itself. Handed a
  // string, the library never closes its own splitter, so the last sentence is
  // left unflushed and the loop waits for a sentence that cannot arrive.
  const sentences = new Splitter();
  sentences.push(text);
  sentences.close();

  for await (const chunk of ready.stream(sentences, { voice, speed })) {
    if (cancelled.has(id)) return;

    const audio = chunk.audio.audio;
    self.postMessage(
      { type: 'chunk', id, text: chunk.text, audio, sampleRate: chunk.audio.sampling_rate },
      // Handed over rather than copied: a few seconds of audio is megabytes,
      // and the worker has no use for it once it has been sent.
      [audio.buffer],
    );
  }

  if (!cancelled.has(id)) self.postMessage({ type: 'done', id });
}

self.addEventListener('message', async (event) => {
  const message = event.data;

  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }

  if (message.type === 'load') {
    try {
      const ready = await load();
      self.postMessage({ type: 'ready' });
      // One throwaway word, so that building the compute graph is paid for
      // here — where somebody is already waiting on a download — instead of in
      // the middle of the first real reply.
      await ready.generate('Hello.', { voice: 'af_heart' });
    } catch (error) {
      self.postMessage({ type: 'failed', message: String(error?.message || error) });
    }
    return;
  }

  if (message.type === 'speak') {
    try {
      await speak(message);
    } catch (error) {
      self.postMessage({ type: 'error', id: message.id, message: String(error?.message || error) });
    }
    // Ids only matter while their reply is in flight.
    cancelled.delete(message.id);
  }
});
