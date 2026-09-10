# English Conversation Practice

A web app for practising spoken English with an AI conversation partner. You talk into the microphone, the AI answers out loud, and any mistake you make is flagged on screen for that turn and kept permanently in a mistake report you can review later.

The conversation is hands free: one tap on the microphone starts it, and the microphone reopens by itself after every reply until you tap stop.

## What it does

**Conversation**

- Tap the mic once and talk. A turn ends when you stop speaking for two seconds.
- The AI reply is shown as text and read aloud, with the word being spoken highlighted as it plays.
- The mic is closed while the AI is talking, so its own voice is never picked up as your next turn.
- Eight scenarios (free chat, job interview, ordering food, small talk, travel, doctor visit, shopping, phone call) and three difficulty levels, changeable mid-conversation. Difficulty affects both the vocabulary the AI uses and how fast it speaks.
- A typed input as a fallback for browsers without speech recognition.

**Corrections**

- A mistake in your turn appears as a card under it: what you said, the correction, a one-line explanation, and the type of error.
- Say something correct and nothing appears at all.
- The card clears as soon as you speak again, so the screen stays clean.
- Punctuation, capitalisation and spelling are never flagged. Speech recognition does not produce reliable punctuation, and casual spoken English is not a mistake.

**Mistake report**

- A permanent record of every mistake, independent of what is on the conversation screen.
- Totals, a breakdown by error type, repeated mistakes (the same slip made more than once), and a per-day trend.
- The trend is mistakes *per turn*, not a raw count, so talking more does not look like getting worse.

**Settings**

- Provider selector, API key field, and a usage estimate for the day.
- The key can be swapped at any time and applies to the next turn, with no restart and no redeploy.

**Session summary**

- Turn and mistake counts, most common error types, rough talk time, and words the AI used that you did not.

## Requirements

- Node.js 18 or newer
- Google Chrome for speech recognition. Firefox and Safari support is inconsistent; the app detects this, disables the mic, and falls back to the typed input.
- An API key for one provider (see below)

## Getting an API key

**Gemini** (default) — create a key at [Google AI Studio](https://aistudio.google.com/apikey). It has a free tier.

> A Gemini consumer subscription through Gmail or Google One does **not** grant API access. You need a separate API key, and it is unrelated to that subscription.

**Claude** (optional) — create a key in the [Anthropic Console](https://console.anthropic.com/). Usage is paid; there is no free daily allowance.

## Running it

```bash
npm install
cp .env.example .env      # then put your key in .env
npm run dev
```

Open <http://localhost:3000> in Chrome, tap the mic, allow microphone access, and start talking.

The microphone needs `localhost` or HTTPS. A LAN address such as `http://192.168.1.5:3000` will not get microphone permission.

You can skip `.env` entirely and paste the key into the Settings screen instead. Either way it ends up in `data/config.json`, which is gitignored.

## Configuration

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Seeds the Gemini key on first boot. Optional if you use the Settings screen. |
| `ANTHROPIC_API_KEY` | Same, for Claude. |
| `GEMINI_MODEL` | Overrides the default model (`gemini-3.6-flash`). |
| `ANTHROPIC_MODEL` | Overrides the default model (`claude-opus-5`). |
| `PORT` | Defaults to `3000`. |

Environment variables only seed the store on first boot. After that `data/config.json` is the source of truth, so a key changed in Settings is not overwritten on the next restart.

## How it is built

Node and Express on the backend, plain HTML, CSS and JavaScript on the frontend, served by the same server. No TypeScript, no bundler, no build step. `npm run dev` is the whole toolchain.

### Provider-agnostic AI layer

The app calls one function, `getAiReply()`, and never learns which provider answered. Each provider is a single adapter file exposing the same interface, and options are expressed as intent rather than as one vendor's parameter names — `lowLatency: true` means "answer fast", and each adapter decides what that means for its own API.

The two adapters are deliberately built differently to prove the seam holds: Gemini talks to the REST API directly with `fetch`, Claude goes through the official Anthropic SDK. Adding a third provider means writing one adapter file and adding it to the registry in `src/providers/index.js`. Nothing else in the app changes.

Every provider failure is translated into a shared set of error codes, so a rejected key or an exhausted quota surfaces the same way whichever provider is active.

### One provider call per turn

The reply and the corrections come back together in a single structured JSON response, rather than as two calls. On a free tier with a daily request limit, two calls per turn would halve your practice time.

### Storage

Sessions, the API key and usage counts are JSON files under `data/`, written atomically. Every change to a session runs read, modify and write inside a per-session queue, so two overlapping requests cannot lose each other's work.

`data/` is gitignored. Deleting it resets the app.

### Usage tracking

Providers do not report live quota, so the app counts its own requests per day and compares them against the published free-tier limit. This is an estimate, and the Settings screen says so: requests made with the same key outside this app are invisible to it. A real rate-limit error from the provider is surfaced separately as a clear "key exhausted" message.

## Project layout

```
src/
  server.js               Express app, static files, error handling
  providers/
    index.js              Registry and getAiReply(); the adapter contract
    gemini.js             Gemini adapter (REST via fetch)
    claude.js             Claude adapter (Anthropic SDK)
    errors.js             Shared error codes
  conversation/
    service.js            One turn: history, provider call, storage
    prompt.js             System prompt, topics, difficulty, reply schema
    parseReply.js         Parses the structured reply, never fatally
    sessionStore.js       Session files and the per-session write queue
    vocabulary.js         New-word extraction for the summary
  report/reportService.js Mistake report aggregation
  usage/usageStore.js     Daily request counts
  config/keyStore.js      API key storage and masking
  routes/                 HTTP endpoints
public/
  index.html              All three screens
  app.js                  Conversation screen, mic loop, corrections
  speech.js               Text to speech
  report.js               Mistake report screen
  settings.js             Settings screen
  styles.css
```

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Active provider and whether a key is set |
| `GET` | `/api/settings` | Providers, models, key status (masked) |
| `PUT` | `/api/settings/key` | Store a key; validated with the provider first |
| `DELETE` | `/api/settings/key/:provider` | Forget a key |
| `PUT` | `/api/settings/provider` | Choose the active provider |
| `PUT` | `/api/settings/model` | Override a provider's model |
| `GET` | `/api/conversation/options` | Topics and difficulty levels |
| `POST` | `/api/sessions` | Start a session |
| `GET` | `/api/sessions` | Recent sessions |
| `GET` | `/api/sessions/:id` | One session with its turns |
| `PATCH` | `/api/sessions/:id` | Change topic or difficulty |
| `POST` | `/api/sessions/:id/turns` | Send a turn; returns the reply and corrections |
| `GET` | `/api/sessions/:id/summary` | Session recap |
| `POST` | `/api/sessions/:id/end` | End the session and return the recap |
| `DELETE` | `/api/sessions/:id` | Delete a session |
| `GET` | `/api/report` | Mistake report, filterable by type |
| `GET` | `/api/report/types` | The mistake types, for the filter control |
| `GET` | `/api/usage` | Today's request count against the free-tier limit |
| `POST` | `/api/ai/test` | One round trip through the active provider |

The stored API key is never returned. Responses carry a masked form such as `AIza••••••0000`, which is enough to tell two keys apart and useless for making requests.

## Known limits

- Chrome's speech recognition sends audio to Google's servers for transcription. This is unrelated to your API key and costs nothing, but it is not local processing.
- Correction quality varies by provider. This is expected rather than a bug.
- No live quota data is available from any provider; the usage figure is the app's own count.
- The free tier rate-limits per minute as well as per day. Several turns in quick succession can hit it; the app reports this as "key exhausted" rather than failing silently.

## Before deploying this anywhere

This is built to run locally and is not ready to be exposed on the internet as-is:

- **Everything persists to the filesystem.** Any serverless host (Vercel, Netlify Functions, Lambda) has a read-only or ephemeral filesystem, so the key, your sessions and the whole mistake report would silently reset. A host with a persistent disk runs it unchanged; a serverless host needs the three stores moved to a database first.
- **There is no authentication.** Anyone with the URL could spend your API key, replace it, or read and delete your history. A shared password or a single-user login is the minimum before it goes public.

## Project spec

The original brief is in [`english-conversation-app-spec.md`](english-conversation-app-spec.md), including the build order the app was written in.
