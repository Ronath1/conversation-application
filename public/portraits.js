/**
 * Photographs for the voices this project ships pictures for.
 *
 * Only a handful of voices are covered, and which voices a machine has is
 * decided by the operating system: a Windows PC offers David, Mark and Zira,
 * an Android phone offers an entirely different set. So a miss here is normal
 * rather than an error — anything unmatched falls back to the face drawn from
 * the voice's own name in avatar.js.
 *
 * Matching is on the voice name, not its voiceURI, because the URI differs
 * between browsers for the same voice.
 *
 * The people in these photographs do not exist. They were generated to stand
 * for synthesised voices, which are themselves not people.
 */

const DIRECTORY = '/avatars';

/**
 * The downloadable voices, which are the same six everywhere.
 *
 * Matched on voiceURI rather than on the name, because these are chosen by
 * this project rather than reported by the operating system: the pairing is
 * fixed and there is nothing to guess. Each voice takes the portrait whose
 * accent and gender match it, so the picture never contradicts the sound.
 */
const NEURAL_PORTRAITS = {
  'kokoro:af_heart': 'zira',
  'kokoro:af_bella': 'us-english',
  'kokoro:am_michael': 'david',
  'kokoro:am_fenrir': 'mark',
  'kokoro:bf_emma': 'uk-female',
  'kokoro:bm_george': 'uk-male',
};

/**
 * Checked in order, first match wins.
 *
 * Named voices come first, because "Microsoft Zira - English (United States)"
 * should get Zira's own portrait rather than a generic American one. A rule
 * resolving to null means "no picture shipped, draw one instead" — better an
 * obvious placeholder than the wrong person's face.
 */
const RULES = [
  [/\bdavid\b/, () => 'david'],
  [/\bmark\b/, () => 'mark'],
  [/\bzira\b/, () => 'zira'],
  // Gendered names, as Google labels its voices: "Google UK English Female".
  // Female is tested before male, since "male" is a substring of "female".
  [/\bfemale\b/, (british) => (british ? 'uk-female' : 'us-english')],
  [/\bmale\b/, (british) => (british ? 'uk-male' : null)],
  // "Google US English" names no gender at all.
  [/\bgoogle us english\b/, () => 'us-english'],
];

/** en-GB, en_GB, "Great Britain" and "United Kingdom" all mean British here. */
function isBritish(name, lang) {
  return /^en[-_]gb/i.test(lang || '') || /\b(uk|united kingdom|great britain|british)\b/i.test(name);
}

/**
 * The portrait for one voice, or null when none is shipped for it.
 *
 * @param {{name?: string, lang?: string}|null} voice
 * @returns {string|null} A URL, or null to fall back to a drawn face.
 */
export function portraitFor(voice) {
  if (!voice?.name) return null;

  const fixed = NEURAL_PORTRAITS[voice.voiceURI];
  if (fixed) return `${DIRECTORY}/${fixed}.webp`;

  const name = String(voice.name).toLowerCase();
  const lang = String(voice.lang || '');

  // Only English voices have portraits; a Spanish voice should not borrow one.
  if (lang && !/^en/i.test(lang)) return null;

  const match = RULES.find(([pattern]) => pattern.test(name));
  if (!match) return null;

  const file = match[1](isBritish(name, lang));
  return file ? `${DIRECTORY}/${file}.webp` : null;
}
