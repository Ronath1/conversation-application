/**
 * Main conversation screen.
 *
 * Scope so far: mic, speech-to-text, the text conversation, spoken replies and
 * the correction shown beside the current turn.
 */

import * as speech from './speech.js';
import * as report from './report.js';
import * as settings from './settings.js';

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
const voiceSelect = document.getElementById('voice');
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
};

/** Beginners asked for a slower pace, so difficulty drives the speaking rate. */
const RATE_BY_DIFFICULTY = { beginner: 0.85, intermediate: 1, advanced: 1.05 };

const state = {
  sessionId: null,
  topic: 'free-chat',
  difficulty: 'intermediate',
  ended: false,
  listening: false,
  busy: false,
  speaking: false,
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
  hint.textContent = 'Tap the mic and start talking.';
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

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = MISTAKE_LABEL[correction.type] || MISTAKE_LABEL.other;

    const fix = document.createElement('p');
    fix.className = 'fix';
    const was = document.createElement('s');
    was.textContent = correction.original;
    const now = document.createElement('strong');
    now.textContent = correction.corrected;
    fix.append(was, ' ', now);

    card.append(badge, fix);

    if (correction.explanation) {
      const why = document.createElement('p');
      why.className = 'why';
      why.textContent = correction.explanation;
      card.append(why);
    }

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

  if (state.listening) recognition?.stop();
  stopSpeaking();

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

/** The mic is the only control that can start a request, so it gates on both flags. */
function updateControls() {
  const canTalk = Boolean(state.sessionId) && !state.busy && !state.ended;
  micButton.disabled = !canTalk || !recognition;
  micButton.setAttribute('aria-pressed', String(state.listening));
  if (!recognition) micLabel.textContent = 'Mic unavailable';
  else micLabel.textContent = state.listening ? 'Tap to stop' : 'Tap to talk';
  typedInput.disabled = !canTalk;
  endSessionButton.disabled = !state.sessionId || state.ended || state.busy;
  topicSelect.disabled = !state.sessionId || state.ended;
  difficultySelect.disabled = !state.sessionId || state.ended;

  repeatButton.disabled = !state.lastReply || !speech.isSupported;
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
  if (!speech.isSupported || !text) return;

  const started = speech.speak(text, {
    voice: speech.findVoice(state.voiceURI),
    rate: RATE_BY_DIFFICULTY[state.difficulty] ?? 1,
    onStart: () => {
      state.speaking = true;
      el?.classList.add('speaking');
      updateControls();
    },
    onWord: (range) => paintSpokenWord(el, text, range),
    onEnd: () => {
      state.speaking = false;
      el?.classList.remove('speaking');
      paintSpokenWord(el, text, null);
      updateControls();
    },
  });

  if (!started) setStatus('This browser could not speak the reply.', true);
}

function stopSpeaking() {
  if (!state.speaking) return;
  speech.stop();
  state.speaking = false;
  if (state.lastReplyEl) {
    state.lastReplyEl.classList.remove('speaking');
    paintSpokenWord(state.lastReplyEl, state.lastReply, null);
  }
  updateControls();
}

/* ---------- API ---------- */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
    error.code = payload?.error?.code || 'HTTP_ERROR';
    throw error;
  }
  return payload;
}

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
    if (state.autoSpeak) speakReply(result.reply, pending);
  } catch (error) {
    pending.className = 'turn error';
    pending.textContent = error.message;
    // A missing or rejected key is a settings problem, not a speech problem.
    setStatus(
      error.code === 'MISSING_KEY' || error.code === 'INVALID_KEY'
        ? 'Open Settings and add a working API key, then try again.'
        : '',
      true,
    );
  } finally {
    state.busy = false;
    updateControls();
    scrollToBottom();
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

let recognition = null;
/** Final text collected across results, sent as one turn when the user stops. */
let finalTranscript = '';

function setUpRecognition() {
  if (!SpeechRecognitionClass) {
    micButton.disabled = true;
    micLabel.textContent = 'Mic unavailable';
    setStatus('This browser has no speech recognition. Use Chrome, or type below.');
    return null;
  }

  const instance = new SpeechRecognitionClass();
  instance.lang = 'en-US';
  // Continuous so the user controls when the turn ends, not a silence timer.
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
  });

  instance.addEventListener('error', (event) => {
    // `aborted` fires whenever we stop the mic ourselves. Not worth reporting.
    if (event.error === 'aborted') return;
    setStatus(SPEECH_ERROR_MESSAGE[event.error] || `Speech recognition error: ${event.error}`, true);
  });

  instance.addEventListener('end', () => {
    state.listening = false;
    updateControls();
    const text = finalTranscript.trim();
    finalTranscript = '';
    showLiveTranscript('');
    if (text) sendTurn(text);
    else if (!statusEl.classList.contains('error')) setStatus('');
  });

  return instance;
}

function toggleMic() {
  if (!recognition || state.busy) return;
  if (state.listening) {
    recognition.stop();
    return;
  }
  // Talking over the AI should cut it off, the way it would in a real conversation.
  stopSpeaking();
  try {
    recognition.start();
  } catch {
    // start() throws if the previous run has not fully stopped. One retry is enough.
    setTimeout(() => recognition.start(), 250);
  }
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

voiceSelect.addEventListener('change', () => {
  state.voiceURI = voiceSelect.value;
  writeStored(STORAGE_KEYS.voice, state.voiceURI);
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
  if (state.listening) recognition?.stop();
  stopSpeaking();
  state.lastReply = null;
  state.lastReplyEl = null;
  clearConversation();
  showLiveTranscript('');
  await startSession();
});

// A tab closed mid-sentence otherwise keeps speaking in some browsers.
window.addEventListener('beforeunload', () => speech.stop());

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

function setUpVoices() {
  if (!speech.isSupported) {
    autoSpeakInput.checked = false;
    autoSpeakInput.disabled = true;
    voiceSelect.disabled = true;
    state.autoSpeak = false;
    // Said in the label, not the status line, so a later status update cannot hide it.
    document.getElementById('auto-speak-label').textContent = 'Speech not supported here';
    return;
  }

  state.autoSpeak = readStored(STORAGE_KEYS.autoSpeak, 'true') !== 'false';
  state.voiceURI = readStored(STORAGE_KEYS.voice, '');
  autoSpeakInput.checked = state.autoSpeak;

  speech.onVoicesReady((voices) => {
    const options = [new Option('Default voice', '')];
    for (const voice of voices) {
      options.push(new Option(`${voice.name} (${voice.lang})`, voice.voiceURI));
    }
    voiceSelect.replaceChildren(...options);
    // Keep the stored choice only while that voice still exists on this machine.
    voiceSelect.value = speech.findVoice(state.voiceURI) ? state.voiceURI : '';
    state.voiceURI = voiceSelect.value;
  });
}

recognition = setUpRecognition();
setUpVoices();
updateControls();
loadConversationOptions().then(startSession);
