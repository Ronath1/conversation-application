/**
 * Main conversation screen.
 *
 * Scope so far: mic, speech-to-text, the text conversation, spoken replies and
 * the correction shown beside the current turn.
 *
 * The conversation is hands free. One tap starts it; the mic then reopens
 * after every reply until the user taps stop.
 */

import * as tts from './tts.js';
import * as report from './report.js';
import * as settings from './settings.js';
import * as auth from './auth.js';
import { apiFetch } from './api.js';
import { avatar, defaultMark, shortName } from './avatar.js';
import { portraitFor } from './portraits.js';
import { initTheme } from './theme.js';

const conversationEl = document.getElementById('conversation');
const liveEl = document.getElementById('live');
const liveTextEl = document.getElementById('live-text');
const statusEl = document.getElementById('status');
const micButton = document.getElementById('mic');
const micLabel = document.getElementById('mic-label');
const typedForm = document.getElementById('typed-form');
const typedInput = document.getElementById('typed-input');
const newSessionButton = document.getElementById('new-session');
const autoSpeakInput = document.getElementById('auto-speak');
const voiceButton = document.getElementById('voice-button');
const voiceButtonFace = document.getElementById('voice-button-face');
const voiceButtonLabel = document.getElementById('voice-button-label');
const voiceModal = document.getElementById('voice-modal');
const voiceGrid = document.getElementById('voice-grid');
const neuralGroup = document.getElementById('neural-group');
const neuralGrid = document.getElementById('neural-grid');
const neuralNote = document.getElementById('neural-note');
const neuralProgress = document.getElementById('neural-progress');
const repeatButton = document.getElementById('repeat');

const topicSelect = document.getElementById('topic-select');
const difficultySelect = document.getElementById('difficulty-select');
const endSessionButton = document.getElementById('end-session');
const sessionBar = document.getElementById('session-bar');

const STORAGE_KEYS = {
  autoSpeak: 'ecp.autoSpeak',
  voice: 'ecp.voiceURI',
  topic: 'ecp.topic',
  difficulty: 'ecp.difficulty',
  showFixes: 'ecp.showFixes',
};

/** Beginners asked for a slower pace, so difficulty drives the speaking rate. */
const RATE_BY_DIFFICULTY = { beginner: 0.85, intermediate: 1, advanced: 1.05 };

/** Shown while a downloaded voice is making audio, and cleared when it speaks. */
const MAKING_AUDIO = 'Making the audio…';

const state = {
  sessionId: null,
  topic: 'free-chat',
  difficulty: 'intermediate',
  ended: false,
  listening: false,
  busy: false,
  speaking: false,
  /** True while the conversation runs hands free: mic reopens after each reply. */
  handsFree: false,
  /** Set when we cut speech off ourselves, so it does not look like a natural end. */
  speechCancelled: false,
  autoSpeak: true,
  voiceURI: '',
  /** The last reply, kept so "Repeat that" works after more turns are added. */
  lastReply: null,
  lastReplyEl: null,
};

/* ---------- stored preferences ---------- */

function readStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse storage. The preference just will not persist.
  }
}

/* ---------- rendering ---------- */

function setStatus(message, isError = false) {
  statusEl.textContent = message || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

function scrollToBottom() {
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function clearConversation() {
  const hint = document.createElement('p');
  hint.className = 'empty';
  hint.id = 'empty-state';
  hint.textContent = 'Tap the mic once. It keeps listening between replies.';
  conversationEl.replaceChildren(hint);
}

function addTurn(role, text) {
  document.getElementById('empty-state')?.remove();
  const el = document.createElement('div');
  el.className = `turn ${role}`;
  el.textContent = text;
  conversationEl.append(el);
  scrollToBottom();
  return el;
}

/* ---------- corrections ---------- */

const MISTAKE_LABEL = {
  grammar: 'Grammar',
  'verb-tense': 'Verb tense',
  article: 'Article',
  preposition: 'Preposition',
  plural: 'Plural',
  'word-order': 'Word order',
  'word-choice': 'Word choice',
  phrasing: 'Phrasing',
  other: 'Fix',
};

/**
 * The main screen shows corrections for the current turn only. The permanent
 * record lives on the backend, so removing a card here loses nothing.
 */
function clearCorrections() {
  for (const el of conversationEl.querySelectorAll('.corrections')) el.remove();
}

/**
 * Whether corrections open showing the fix.
 *
 * Open is the default: the fix is the reason the app exists, and hiding it by
 * default would make most turns look like nothing happened. But some people do
 * not want every slip spelled out mid-conversation, so hiding one card is
 * remembered and every later card arrives hidden too, until they open one
 * again. The badge stays visible either way, so a correction is never silent.
 */
function fixesShown() {
  return readStored(STORAGE_KEYS.showFixes, 'true') !== 'false';
}

/** Puts one card into its open or closed state, label and all. */
function setCardOpen(card, open) {
  const head = card.querySelector('.correction-head');
  const body = card.querySelector('.correction-body');
  const hint = card.querySelector('.correction-hint');

  card.classList.toggle('closed', !open);
  body.hidden = !open;
  head.setAttribute('aria-expanded', String(open));
  hint.textContent = open ? 'tap to hide fixes' : 'tap to see the fix';
}

/** Renders correction cards directly under the user turn they belong to. */
function showCorrections(userTurnEl, corrections) {
  if (!corrections?.length) return;

  const wrap = document.createElement('div');
  wrap.className = 'corrections';
  wrap.setAttribute('role', 'note');
  wrap.setAttribute('aria-label', `${corrections.length} correction${corrections.length > 1 ? 's' : ''} for your last turn`);

  for (const correction of corrections) {
    const card = document.createElement('div');
    card.className = 'correction';

    // The whole header is the control, so the target is the width of the card
    // rather than a small chevron.
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'correction-head';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = MISTAKE_LABEL[correction.type] || MISTAKE_LABEL.other;

    const hint = document.createElement('span');
    hint.className = 'correction-hint';

    head.append(badge, hint);

    const body = document.createElement('div');
    body.className = 'correction-body';

    const fix = document.createElement('p');
    fix.className = 'fix';
    const was = document.createElement('s');
    was.textContent = correction.original;
    const now = document.createElement('strong');
    now.textContent = correction.corrected;
    fix.append(was, ' ', now);
    body.append(fix);

    if (correction.explanation) {
      const why = document.createElement('p');
      why.className = 'why';
      why.textContent = correction.explanation;
      body.append(why);
    }

    card.append(head, body);
    setCardOpen(card, fixesShown());

    head.addEventListener('click', () => {
      const open = body.hidden;
      writeStored(STORAGE_KEYS.showFixes, String(open));
      // Every card on screen follows, so the setting never looks half-applied.
      for (const other of conversationEl.querySelectorAll('.correction')) setCardOpen(other, open);
    });

    wrap.append(card);
  }

  userTurnEl.after(wrap);
  scrollToBottom();
}

/* ---------- session summary ---------- */

function formatDuration(seconds) {
  if (!seconds) return '0s';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

const MISTAKE_TYPE_LABEL = {
  grammar: 'Grammar',
  'verb-tense': 'Verb tense',
  article: 'Article',
  preposition: 'Preposition',
  plural: 'Plural',
  'word-order': 'Word order',
  'word-choice': 'Word choice',
  phrasing: 'Phrasing',
  other: 'Fix',
};

/** The end-of-session recap, shown in the conversation where the session ended. */
function showSummary(summary) {
  const card = document.createElement('section');
  card.className = 'summary';

  const heading = document.createElement('h3');
  heading.textContent = 'Session summary';
  card.append(heading);

  const stats = document.createElement('dl');
  stats.className = 'summary-stats';
  const rows = [
    ['Turns', summary.turnCount],
    ['Mistakes', summary.mistakeCount],
    ['Clean turns', summary.cleanTurnCount],
    ['Words spoken', summary.userWordCount],
    ['Words per turn', summary.wordsPerTurn],
    ['Talking time', formatDuration(summary.speakingSecondsEstimate)],
    ['Session length', formatDuration(summary.durationSeconds)],
  ];
  for (const [name, value] of rows) {
    // Each label and value are wrapped together, so a pair never splits across columns.
    const pair = document.createElement('div');
    const term = document.createElement('dt');
    term.textContent = name;
    const detail = document.createElement('dd');
    detail.textContent = String(value);
    pair.append(term, detail);
    stats.append(pair);
  }
  card.append(stats);

  const types = Object.entries(summary.mistakesByType || {});
  if (types.length) {
    const line = document.createElement('p');
    line.className = 'summary-line';
    line.textContent = `Most common: ${types
      .map(([type, count]) => `${MISTAKE_TYPE_LABEL[type] || type} (${count})`)
      .join(', ')}`;
    card.append(line);
  }

  if (summary.newVocabulary?.length) {
    const line = document.createElement('p');
    line.className = 'summary-line';
    line.textContent = `Words the AI used that you did not: ${summary.newVocabulary.map((entry) => entry.word).join(', ')}`;
    card.append(line);
  }

  const footer = document.createElement('p');
  footer.className = 'summary-line muted';
  footer.textContent = 'Every mistake above is kept in the mistake report.';
  card.append(footer);

  conversationEl.append(card);
  scrollToBottom();
}

async function endSession() {
  if (!state.sessionId || state.ended) return;

  stopConversation();

  endSessionButton.disabled = true;
  try {
    const result = await api(`/api/sessions/${state.sessionId}/end`, { method: 'POST' });
    state.ended = true;
    clearCorrections();
    showSummary(result.summary);
    setStatus('Session ended. Start a new session to keep practising.');
  } catch (error) {
    setStatus(error.message, true);
  }
  updateControls();
}

function showLiveTranscript(text) {
  liveTextEl.textContent = text;
  liveEl.hidden = !text;
}

/**
 * One button runs the whole conversation, so its label has to say what the
 * next tap does and what the app is doing right now.
 */
function micLabelText() {
  if (!recognition) return 'Mic unavailable';
  if (!state.handsFree) return 'Tap to talk';
  if (state.listening) return 'Listening — tap to stop';
  if (state.busy) return 'Thinking — tap to stop';
  if (state.speaking) return 'Speaking — tap to stop';
  return 'Tap to stop';
}

function updateControls() {
  const canTalk = Boolean(state.sessionId) && !state.ended;
  // Stays clickable while thinking or speaking, because it is also the stop control.
  micButton.disabled = !canTalk || !recognition;
  micButton.setAttribute('aria-pressed', String(state.handsFree));
  micLabel.textContent = micLabelText();
  typedInput.disabled = !canTalk || state.busy;
  endSessionButton.disabled = !state.sessionId || state.ended || state.busy;
  topicSelect.disabled = !state.sessionId || state.ended;
  difficultySelect.disabled = !state.sessionId || state.ended;

  repeatButton.disabled = !state.lastReply || !tts.isSupported;
  repeatButton.textContent = state.speaking ? 'Stop' : 'Repeat that';
}

/* ---------- speaking ---------- */

/** Rebuilds the bubble with the spoken word marked, so text tracks the audio. */
function paintSpokenWord(el, text, range) {
  if (!range) {
    el.textContent = text;
    return;
  }
  const mark = document.createElement('mark');
  mark.textContent = text.slice(range.start, range.end);
  el.replaceChildren(text.slice(0, range.start), mark, text.slice(range.end));
}

function speakReply(text, el) {
  if (!tts.isSupported || !text) return false;

  const started = tts.speak(text, {
    voice: tts.findVoice(state.voiceURI),
    rate: RATE_BY_DIFFICULTY[state.difficulty] ?? 1,
    // A downloaded voice is made on this machine, so there is a pause between
    // the reply appearing and the first sound. Said out loud, because silence
    // after a reply reads as a broken app.
    onPrepare: () => setStatus(MAKING_AUDIO),
    onStart: () => {
      state.speaking = true;
      // Only our own message is cleared, so a warning raised meanwhile stands.
      if (statusEl.textContent === MAKING_AUDIO) setStatus('');
      el?.classList.add('speaking');
      updateControls();
    },
    onWord: (range) => paintSpokenWord(el, text, range),
    // A downloaded voice can fail after speak() has already returned true: the
    // model is fetched and run in the background. Said out loud, because a
    // reply that stays silent otherwise looks like the app ignored it.
    onError: () => setStatus('That voice could not make the audio. Pick another one under Voices.', true),
    onEnd: () => {
      state.speaking = false;
      el?.classList.remove('speaking');
      paintSpokenWord(el, text, null);
      updateControls();
      // The reply has finished playing, so it is the user's turn again.
      if (!state.speechCancelled) resumeListening();
      state.speechCancelled = false;
    },
  });

  if (!started) setStatus('This browser could not speak the reply.', true);
  return started;
}

function stopSpeaking() {
  if (!state.speaking) return;
  state.speechCancelled = true;
  tts.stop();
  state.speaking = false;
  if (state.lastReplyEl) {
    state.lastReplyEl.classList.remove('speaking');
    paintSpokenWord(state.lastReplyEl, state.lastReply, null);
  }
  updateControls();
}

/* ---------- API ---------- */

const api = apiFetch;

async function startSession() {
  state.sessionId = null;
  state.ended = false;
  updateControls();
  setStatus('Starting a session…');
  try {
    const session = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ topic: state.topic, difficulty: state.difficulty }),
    });
    state.sessionId = session.id;
    state.topic = session.topic;
    state.difficulty = session.difficulty;
    setStatus('');
  } catch (error) {
    setStatus(`Could not start a session: ${error.message}`, true);
  }
  updateControls();
}

/* ---------- topic and difficulty ---------- */

function fillSelect(select, items, selected) {
  select.replaceChildren(...items.map((item) => new Option(item.label, item.id)));
  select.value = items.some((item) => item.id === selected) ? selected : items[0]?.id;
  return select.value;
}

/** Applies a picker change to the live session, so it takes effect next turn. */
async function applySessionChange(patch) {
  if (!state.sessionId) return;
  try {
    const session = await api(`/api/sessions/${state.sessionId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    state.topic = session.topic;
    state.difficulty = session.difficulty;
    setStatus('');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadConversationOptions() {
  try {
    const options = await api('/api/conversation/options');
    state.topic = fillSelect(topicSelect, options.topics, readStored(STORAGE_KEYS.topic, state.topic));
    state.difficulty = fillSelect(
      difficultySelect,
      options.difficulties,
      readStored(STORAGE_KEYS.difficulty, state.difficulty),
    );
  } catch {
    // Without the option list the pickers stay empty; the session still runs on defaults.
    setStatus('Could not load the topic list. Defaults are in use.', true);
  }
}

/** Sends one user turn and renders the reply. */
async function sendTurn(text) {
  const spoken = text.trim();
  if (!spoken || state.busy || !state.sessionId) return;

  stopSpeaking();
  // Speaking again is what clears the previous turn correction from this view.
  clearCorrections();
  const userTurnEl = addTurn('user', spoken);
  showLiveTranscript('');

  state.busy = true;
  updateControls();

  const pending = addTurn('ai pending', 'Thinking…');
  let handBackMic = false;

  try {
    const result = await api(`/api/sessions/${state.sessionId}/turns`, {
      method: 'POST',
      body: JSON.stringify({ text: spoken }),
    });
    pending.className = 'turn ai';
    pending.textContent = result.reply;
    state.lastReply = result.reply;
    state.lastReplyEl = pending;
    setStatus('');
    showCorrections(userTurnEl, result.corrections);
    // When a reply is spoken, the mic reopens when that speech ends. When it
    // is not, there is nothing to wait for.
    handBackMic = !(state.autoSpeak && speakReply(result.reply, pending));
  } catch (error) {
    pending.className = 'turn error';
    pending.textContent = error.message;
    // A missing or rejected key is a settings problem, not a speech problem.
    const guidance =
      error.code === 'MISSING_KEY' || error.code === 'INVALID_KEY'
        ? 'Open Settings and add a working API key, then tap to talk again.'
        : 'Tap to talk when you want to carry on.';
    // Stop rather than reopen the mic, so a broken key cannot spin in a loop.
    stopConversation(guidance, true);
  } finally {
    state.busy = false;
    updateControls();
    scrollToBottom();
    if (handBackMic) resumeListening();
  }
}

/* ---------- speech to text ---------- */

const SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;

const SPEECH_ERROR_MESSAGE = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser, then try again.',
  'service-not-allowed': 'The browser blocked speech recognition for this page.',
  'no-speech': 'I did not hear anything. Try again.',
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition could not reach its network service.',
};

/**
 * Silence that ends a turn. Learners pause mid-sentence, so this is longer
 * than a native speaker would need.
 */
const SILENCE_MS = 2000;

/**
 * Guard against a mic that hears nothing at all. Without it a broken or muted
 * microphone would restart forever with no sign of what is wrong.
 */
const MAX_EMPTY_RESTARTS = 20;

let recognition = null;
/** Final text collected across results, sent as one turn when the user pauses. */
let finalTranscript = '';
let silenceTimer = null;
let emptyRestarts = 0;

function clearSilenceTimer() {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = null;
}

/**
 * Ends the turn once the user has stopped talking.
 * Only fires when something was actually said: silence before the first word
 * means the user is still thinking, so the mic stays open.
 */
function armSilenceTimer() {
  clearSilenceTimer();
  silenceTimer = setTimeout(() => {
    if (finalTranscript.trim()) recognition?.stop();
  }, SILENCE_MS);
}

/** Opens the mic again for the next turn, unless the user has stopped. */
function resumeListening() {
  if (!state.handsFree || state.ended || !recognition) return;
  if (state.listening || state.busy) return;
  try {
    recognition.start();
  } catch {
    // start() throws while the previous run is still winding down.
    setTimeout(() => {
      if (state.handsFree && !state.listening && !state.busy) {
        try {
          recognition.start();
        } catch {
          stopConversation('The microphone could not be reopened. Tap to talk to start again.');
        }
      }
    }, 300);
  }
}

function setUpRecognition() {
  if (!SpeechRecognitionClass) {
    micButton.disabled = true;
    micLabel.textContent = 'Mic unavailable';
    setStatus('This browser has no speech recognition. Use Chrome, or type below.');
    return null;
  }

  const instance = new SpeechRecognitionClass();
  instance.lang = 'en-US';
  // Continuous, with our own pause detection, so a mid-sentence breath does
  // not end the turn the way the browser's own endpointing would.
  instance.continuous = true;
  instance.interimResults = true;

  instance.addEventListener('start', () => {
    state.listening = true;
    finalTranscript = '';
    setStatus('Listening…');
    updateControls();
  });

  instance.addEventListener('result', (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) finalTranscript += `${result[0].transcript} `;
      else interim += result[0].transcript;
    }
    showLiveTranscript(`${finalTranscript}${interim}`.trim());
    // Every word heard restarts the clock; the turn ends when the words stop.
    armSilenceTimer();
  });

  instance.addEventListener('error', (event) => {
    // `aborted` fires whenever we stop the mic ourselves. Not worth reporting.
    if (event.error === 'aborted') return;
    // Silence is expected while waiting for the user to begin, so it is not
    // an error worth showing during a hands-free conversation.
    if (event.error === 'no-speech' && state.handsFree) return;

    const message = SPEECH_ERROR_MESSAGE[event.error] || `Speech recognition error: ${event.error}`;
    // A blocked or missing microphone will not fix itself on a retry.
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
      stopConversation(message, true);
      return;
    }
    setStatus(message, true);
  });

  instance.addEventListener('end', () => {
    state.listening = false;
    clearSilenceTimer();
    updateControls();

    const text = finalTranscript.trim();
    finalTranscript = '';
    showLiveTranscript('');

    if (text) {
      emptyRestarts = 0;
      sendTurn(text);
      return;
    }

    if (!statusEl.classList.contains('error')) setStatus('');

    // The browser ends recognition on its own after a stretch of silence.
    // In a hands-free conversation that is just the user still thinking.
    if (state.handsFree) {
      emptyRestarts += 1;
      if (emptyRestarts > MAX_EMPTY_RESTARTS) {
        stopConversation('I stopped listening because I heard nothing. Check the microphone, then tap to talk.', true);
        return;
      }
      setTimeout(resumeListening, 300);
    }
  });

  return instance;
}

/**
 * Starts a hands-free conversation.
 *
 * One tap opens the mic and keeps it open: the turn ends when the user stops
 * talking, and the mic reopens once the reply has been spoken. The mic is
 * deliberately closed while the AI talks, so its own voice is never heard back
 * as the next thing the user said.
 */
function startConversation() {
  if (!recognition || !state.sessionId || state.ended) return;
  state.handsFree = true;
  emptyRestarts = 0;
  stopSpeaking();
  updateControls();
  resumeListening();
}

/** Ends the hands-free conversation. Nothing restarts until the user taps again. */
function stopConversation(message = '', isError = false) {
  state.handsFree = false;
  clearSilenceTimer();
  // Whatever was being said is dropped: stop means stop.
  finalTranscript = '';
  if (state.listening) recognition?.stop();
  stopSpeaking();
  showLiveTranscript('');
  setStatus(message, isError);
  updateControls();
}

function toggleMic() {
  if (!recognition) return;
  if (state.handsFree) stopConversation();
  else startConversation();
}

/* ---------- wiring ---------- */

micButton.addEventListener('click', toggleMic);

repeatButton.addEventListener('click', () => {
  if (state.speaking) stopSpeaking();
  else if (state.lastReply) speakReply(state.lastReply, state.lastReplyEl);
});

autoSpeakInput.addEventListener('change', () => {
  state.autoSpeak = autoSpeakInput.checked;
  writeStored(STORAGE_KEYS.autoSpeak, String(state.autoSpeak));
  if (!state.autoSpeak) stopSpeaking();
});


topicSelect.addEventListener('change', () => {
  writeStored(STORAGE_KEYS.topic, topicSelect.value);
  applySessionChange({ topic: topicSelect.value });
});

difficultySelect.addEventListener('change', () => {
  writeStored(STORAGE_KEYS.difficulty, difficultySelect.value);
  applySessionChange({ difficulty: difficultySelect.value });
});

endSessionButton.addEventListener('click', endSession);

typedForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = typedInput.value;
  typedInput.value = '';
  sendTurn(text);
});

newSessionButton.addEventListener('click', async () => {
  stopConversation();
  state.lastReply = null;
  state.lastReplyEl = null;
  clearConversation();
  showLiveTranscript('');
  await startSession();
});

// A tab closed mid-sentence otherwise keeps speaking in some browsers.
window.addEventListener('beforeunload', () => tts.stop());

/* ---------- screens ---------- */

const SCREENS = {
  conversation: { tab: document.getElementById('tab-conversation'), view: conversationEl },
  report: { tab: document.getElementById('tab-report'), view: document.getElementById('report-view'), load: () => report.load() },
  settings: { tab: document.getElementById('tab-settings'), view: document.getElementById('settings-view'), load: () => settings.load() },
};

const liveControls = [sessionBar, liveEl, statusEl, document.querySelector('.controls')];

/**
 * Switching screens hides the conversation instead of navigating away, so the
 * current session survives a look at the report or the settings.
 */
function showScreen(name) {
  for (const [key, screen] of Object.entries(SCREENS)) {
    const active = key === name;
    screen.view.hidden = !active;
    screen.tab.setAttribute('aria-selected', String(active));
  }

  const onConversation = name === 'conversation';
  // Leaving the conversation screen closes the mic: listening on a screen with
  // no mic button and no transcript would be invisible.
  if (!onConversation && state.handsFree) stopConversation();
  for (const el of liveControls) el.hidden = !onConversation;
  // The live transcript strip has its own empty rule; do not force it back on.
  if (onConversation) showLiveTranscript(liveTextEl.textContent);

  SCREENS[name].load?.();
}

for (const [name, screen] of Object.entries(SCREENS)) {
  screen.tab.addEventListener('click', () => showScreen(name));
}

document.getElementById('report-refresh').addEventListener('click', () => report.load());
document.getElementById('settings-refresh').addEventListener('click', () => settings.load());

/* ---------- voice setup ---------- */

/** The voices this device offers, refreshed when the browser reports them. */
let voices = [];

function chooseVoice(voiceURI) {
  state.voiceURI = voiceURI;
  writeStored(STORAGE_KEYS.voice, voiceURI);
  drawVoiceButton();
  drawVoiceGrid();
}

/**
 * A photograph when one is shipped for this voice, a drawn face otherwise.
 *
 * The image carries its own fallback: if the file is missing or fails to load,
 * it is replaced by the drawn face rather than leaving a broken tile.
 */
function faceFor(voice, size) {
  if (!voice) return defaultMark(size);

  const source = portraitFor(voice);
  if (!source) return avatar(voice.name, size);

  const image = document.createElement('img');
  image.className = 'avatar';
  image.src = source;
  image.width = size;
  image.height = size;
  image.alt = '';
  // Not lazy: these are a few KB each, and a lazy image inside a modal that
  // starts hidden can sit unloaded until something forces a layout.
  image.decoding = 'async';
  image.addEventListener('error', () => {
    image.replaceWith(avatar(voice.name, size));
  });
  return image;
}

function drawVoiceButton() {
  const chosen = tts.findVoice(state.voiceURI);
  voiceButtonLabel.textContent = chosen ? shortName(chosen.name) : 'Voices';
  // A small face on the button says which voice is set without opening anything.
  voiceButtonFace.replaceChildren(chosen ? faceFor(chosen, 24) : document.createTextNode(''));
  voiceButtonFace.hidden = !chosen;
}

/** Hearing it is the whole point, so a tile speaks when it is picked. */
function previewVoice(voice) {
  tts.speak(`Hello. I am ${voice ? shortName(voice.name) : 'the default voice'}.`, {
    voice,
    rate: RATE_BY_DIFFICULTY[state.difficulty] ?? 1,
  });
}

/**
 * Picks a downloaded voice, fetching the model first when this device has
 * never used one.
 *
 * The download starts here and nowhere else, so nobody spends 92MB of someone
 * else's data without having asked for it.
 */
async function chooseNeuralVoice(voice) {
  if (tts.neuralStatus().phase !== 'ready') {
    try {
      await tts.loadNeural();
    } catch {
      // drawNeuralStatus already puts the failure on screen.
      return;
    }
    // A download runs for a minute or more, and the window may be long closed
    // by the time it lands. Changing the voice then would be a surprise.
    if (voiceModal.hidden) return;
  }

  chooseVoice(voice.voiceURI);
  previewVoice(voice);
}

/** One tile per voice: a face, the short name, and the accent underneath. */
function makeVoiceTile(voice) {
  const value = voice ? voice.voiceURI : '';

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'voice-tile';
  tile.setAttribute('aria-pressed', String(state.voiceURI === value));
  if (state.voiceURI === value) tile.classList.add('picked');

  const face = document.createElement('span');
  face.className = 'voice-face';
  face.append(faceFor(voice, 84));

  const label = document.createElement('span');
  label.className = 'voice-name';
  label.textContent = voice ? shortName(voice.name) : 'Default';

  const detail = document.createElement('span');
  detail.className = 'voice-detail';
  detail.textContent = voice ? voice.lang : "Your browser's choice";

  tile.append(face, label, detail);
  tile.addEventListener('click', () => {
    if (voice && tts.isNeural(voice.voiceURI)) {
      chooseNeuralVoice(voice);
      return;
    }
    chooseVoice(value);
    previewVoice(voice);
  });
  return tile;
}

function drawVoiceGrid() {
  const tiles = [makeVoiceTile(null)];
  for (const voice of voices) tiles.push(makeVoiceTile(voice));
  voiceGrid.replaceChildren(...tiles);

  const neural = tts.neuralVoices();
  neuralGroup.hidden = neural.length === 0;
  if (neural.length > 0) neuralGrid.replaceChildren(...neural.map(makeVoiceTile));
}

/**
 * What the downloadable voices say about themselves.
 *
 * The size is stated before anything is spent, not after, because a number
 * that only appears once the download is running is not a choice.
 */
const NEURAL_NOTES = {
  idle:
    'Made on this device, so they sound the same on every computer and phone, and keep working ' +
    'offline. Picking one downloads it: about 92MB, once per device.',
  loading: 'Downloading the voices. This happens once on this device, and you can keep talking meanwhile.',
  ready: 'Made on this device, so they sound the same everywhere and keep working offline.',
  failed: 'The voices could not be downloaded. Check the connection, then pick one again to retry.',
};

function drawNeuralStatus(status) {
  neuralNote.textContent = NEURAL_NOTES[status.phase] || '';
  neuralNote.classList.toggle('error', status.phase === 'failed');

  // Left visible but unclickable while loading: hiding the tiles would make
  // the window jump and lose sight of what is being waited for.
  neuralGrid.classList.toggle('waiting', status.phase === 'loading');

  neuralProgress.hidden = status.phase !== 'loading';
  neuralProgress.firstElementChild.style.width = `${status.percent}%`;
}

// Subscribed out here rather than in setUpVoices, which waits for a signed-in
// user: the voices window has its own button and must describe itself
// correctly whenever it opens.
tts.onNeuralStatus((status) => {
  drawNeuralStatus(status);
  if (status.phase === 'ready' && !voiceModal.hidden) drawVoiceGrid();
});

function openVoices() {
  drawVoiceGrid();
  voiceModal.hidden = false;
  document.getElementById('voice-close').focus();
}

function closeVoices() {
  voiceModal.hidden = true;
  // Stop a sample mid-sentence rather than talking to a closed window.
  if (!state.speaking) tts.stop();
  voiceButton.focus();
}

voiceButton.addEventListener('click', openVoices);
document.getElementById('voice-close').addEventListener('click', closeVoices);
voiceModal.addEventListener('click', (event) => {
  if (event.target === voiceModal) closeVoices();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !voiceModal.hidden) closeVoices();
});

function setUpVoices() {
  if (!tts.isSupported) {
    autoSpeakInput.checked = false;
    autoSpeakInput.disabled = true;
    voiceButton.disabled = true;
    state.autoSpeak = false;
    // Said in the label, not the status line, so a later status update cannot hide it.
    document.getElementById('auto-speak-label').textContent = 'Speech not supported here';
    return;
  }

  state.autoSpeak = readStored(STORAGE_KEYS.autoSpeak, 'true') !== 'false';
  state.voiceURI = readStored(STORAGE_KEYS.voice, '');
  autoSpeakInput.checked = state.autoSpeak;

  // A downloaded voice is already on this device, so fetching it now means the
  // first reply is not held up while the model loads. This costs no bytes: the
  // browser serves it from its cache.
  if (tts.isNeural(state.voiceURI)) tts.loadNeural().catch(() => {});

  tts.onVoicesReady((ready) => {
    voices = ready;
    // Keep the stored choice only while that voice still exists on this machine.
    if (!tts.findVoice(state.voiceURI)) state.voiceURI = '';
    drawVoiceButton();
    if (!voiceModal.hidden) drawVoiceGrid();
  });

  drawVoiceButton();
}

/* ---------- sign in ---------- */

const authOverlay = document.getElementById('auth-overlay');
const signInMount = document.getElementById('clerk-sign-in');
const signUpMount = document.getElementById('clerk-sign-up');
const mounted = { 'sign-in': false, 'sign-up': false };
const authError = document.getElementById('auth-error');
const signInTab = document.getElementById('tab-sign-in');
const signUpTab = document.getElementById('tab-sign-up');
const signOutButton = document.getElementById('sign-out');

/** Swaps between the sign-in and the create-account form, both from Clerk. */
function showAuthForm(mode) {
  const signingUp = mode === 'sign-up';

  signInTab.setAttribute('aria-selected', String(!signingUp));
  signUpTab.setAttribute('aria-selected', String(signingUp));
  signInMount.hidden = signingUp;
  signUpMount.hidden = !signingUp;

  // Mounted on first view and then left alone.
  if (signingUp && !mounted['sign-up']) {
    auth.mountSignUp(signUpMount);
    mounted['sign-up'] = true;
  }
  if (!signingUp && !mounted['sign-in']) {
    auth.mountSignIn(signInMount);
    mounted['sign-in'] = true;
  }
}

signInTab.addEventListener('click', () => showAuthForm('sign-in'));
signUpTab.addEventListener('click', () => showAuthForm('sign-up'));

signOutButton.addEventListener('click', async () => {
  stopConversation();
  await auth.signOut();
  // A full reload is the simplest way to be sure nothing from the previous
  // account is left on screen or in memory.
  window.location.reload();
});

/** Everything that needs a signed-in user. */
async function startApp() {
  authOverlay.hidden = true;
  recognition = setUpRecognition();
  setUpVoices();
  updateControls();
  await loadConversationOptions();
  await startSession();
}

async function boot() {
  // Before anything else: the theme applies to the sign-in screen too, and
  // works whether or not sign-in is switched on.
  initTheme(document.getElementById('theme-toggle'));

  const result = await auth.initAuth();

  if (result.error) {
    authOverlay.hidden = false;
    authError.hidden = false;
    authError.textContent = result.error;
    return;
  }

  if (!result.enabled) {
    // No sign-in configured: a single local user, as in development.
    signOutButton.hidden = true;
    await startApp();
    return;
  }

  signOutButton.hidden = false;

  // Signing in or out from Clerk's own form lands here.
  auth.onAuthChange((signedIn) => {
    if (signedIn && authOverlay.hidden === false) window.location.reload();
  });

  if (!result.signedIn) {
    authOverlay.hidden = false;
    showAuthForm('sign-in');
    return;
  }

  await startApp();
}

boot();
