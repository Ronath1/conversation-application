# English Conversation Practice App — Project Spec

## What this is
A web app for having spoken, back-and-forth English conversations with an AI, aimed at improving spoken fluency. You talk into the mic, the AI replies out loud like a real conversation partner, and any mistakes you make get flagged on screen in the moment — then saved to a report you can review later.

## Core conversation loop
1. User taps the mic button and speaks.
2. Speech is transcribed to text (browser Web Speech API, or a server-side speech-to-text service).
3. Transcript is sent to the AI provider along with conversation history (for context/continuity).
4. AI reply is returned as text, then converted to speech and played back automatically.
5. If the user's turn contained a grammar/word-choice/phrasing mistake, it's shown on screen alongside that turn. If the turn was correct, nothing is shown.
6. The correction is visible only for the current turn — it clears from the main view once the user speaks again.
7. Every flagged mistake is also logged permanently to a separate report section (see below), regardless of whether it's still shown on the main screen.
8. Conversation continues turn by turn, maintaining context, until the user ends the session.

## Frontend features

### Main conversation screen
- Mic button (tap to talk / tap to stop, or hold-to-talk — decide during build)
- Live transcript of user speech as they talk
- AI reply shown as text, synced with spoken audio playback
- Scrollable conversation history for the current session
- Inline correction display for the current turn only (clears on next turn)
- "Repeat that" button to replay the AI's last spoken response

### Mistake report (persistent)
- Separate screen/tab from the live conversation
- Full log of every flagged mistake: what was said, what was wrong, suggested correction
- Aggregated view over time (recurring mistake patterns, common error types)
- Not cleared between turns — this is the permanent record

### Conversation controls
- Topic/scenario picker (free chat, job interview, ordering food, small talk, etc.)
- Difficulty/pace setting (simpler vocabulary & slower pace vs. more advanced)
- Auto-speak toggle (AI replies play automatically vs. user taps to hear them)
- Voice selection for AI speech output, if multiple voices are available

### Settings panel
- API key field, with the ability to update/swap the key without reloading or redeploying the app
- Provider selector dropdown (Gemini / Claude / OpenAI / others — see backend section)
- Usage indicator: app-tracked estimate of requests used today vs. known free-tier limit (not a live number from the provider — see notes below)

### Session summary (end of session)
- Quick recap: number of mistakes, common error types, new vocabulary encountered, rough talk-time stats

## Backend features

### Provider-agnostic AI layer
- Adapter pattern: one function per provider (Gemini, Claude, OpenAI, etc.) that all expose the same interface — take conversation text in, return a reply out
- Rest of the app calls a single "get AI reply" function and doesn't know which provider is behind it
- Adding a new provider later = writing one new adapter, not rewriting app logic

### API key management
- Backend stores the currently active key (config file or small DB — not hardcoded)
- Endpoint to update the key from the frontend settings panel, applied immediately without redeploy
- Key is never exposed in frontend source/network responses beyond what the user themselves entered

### Speech handling
- Speech-to-text: browser-native (free, works best in Chrome) or a server-side STT API if better accuracy is needed later
- Text-to-speech: browser-native or a provider TTS API, depending on voice quality wanted

### Mistake detection & logging
- Each user turn is checked for grammar/phrasing issues (via the AI provider itself, prompted to return corrections alongside its conversational reply)
- Flagged mistakes are persisted (DB or file) tied to session/date, independent of the live conversation state

### Usage tracking
- Since providers generally don't expose real-time "requests remaining" via API, the app counts its own requests locally per day and compares against the known free-tier limit for the active provider
- On an actual rate-limit error from the provider, the app catches it and surfaces a clear "key exhausted" message rather than failing silently

## Known constraints
- Google's Gemini Pro consumer subscription (Gmail/Google One) does **not** grant API access — a separate free Gemini API key is required and is unrelated to that subscription
- Browser speech recognition works best in Chrome; Safari/Firefox support is inconsistent
- Correction quality/style will vary slightly by provider (this is expected, not a bug)
- No live "quota remaining" data is available from providers — usage shown is an app-side estimate

## Not needed yet (only relevant if publishing publicly later)
- User accounts/login
- Per-user API keys (not shared/hardcoded)
- Per-user rate limiting
- Public landing page

## Suggested build order (for Claude Code)
1. Backend: provider adapter layer + key management endpoint (get one provider, e.g. Gemini, fully working first)
2. Backend: conversation endpoint that maintains history and returns both a reply and any detected corrections
3. Frontend: mic button + speech-to-text + basic text conversation display (no audio yet)
4. Frontend: text-to-speech playback of AI replies
5. Frontend: inline per-turn correction display + clearing behavior
6. Backend + frontend: persistent mistake report/log screen
7. Frontend: settings panel (key swap, provider selector, usage indicator)
8. Frontend: topic/difficulty controls, session summary
9. Add second provider adapter (e.g. Claude) to validate the provider-agnostic design actually works
