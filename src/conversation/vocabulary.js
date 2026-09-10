/**
 * New vocabulary for the session recap.
 *
 * A word counts as new when the AI used it in this session and the user never
 * did. That is a heuristic, not a claim about what the user knows: it costs no
 * extra provider call, and it surfaces the words worth trying out next time.
 */

/** Words too common to be worth showing. Kept short on purpose. */
const STOPWORDS = new Set(
  `a about after all also am an and any are as ask at back be because been before being but by
   can come could day did do does doing done down each even every few find first for from get give
   go going good got had has have having he her here hers him his how i if in into is it its just
   know like little long look made make man many may me might more most much must my need never new
   no not now of off often on once one only or other our out over own people put right said same
   say see she should since so some still such take tell than that the their them then there these
   they thing think this those though through time to too two up us use very want was way we well
   were what when where which while who why will with work would year you your yours yes okay ok
   really something someone anything nothing everyone maybe sure thanks thank hello hi oh great
   nice lot bit sounds sound tell told feel felt let lets going gonna wanna`
    .split(/\s+/)
    .filter(Boolean),
);

const MAX_WORDS = 12;
const MIN_LENGTH = 4;

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter(Boolean);
}

/** Treats plurals and simple verb endings as the same word, so "photos" does not follow "photo". */
function stem(word) {
  return word
    .replace(/(ies)$/, 'y')
    .replace(/(sses|shes|ches|xes)$/, '')
    .replace(/([^s])s$/, '$1')
    .replace(/(ing|ed)$/, '');
}

/**
 * @param {object} session
 * @returns {Array<{word: string, count: number, example: string}>}
 */
export function findNewVocabulary(session) {
  const turns = session.turns || [];

  const spokenByUser = new Set();
  for (const turn of turns) {
    for (const word of words(turn.user)) spokenByUser.add(stem(word));
  }

  const candidates = new Map();
  for (const turn of turns) {
    for (const word of words(turn.reply)) {
      if (word.length < MIN_LENGTH) continue;
      if (STOPWORDS.has(word)) continue;

      const key = stem(word);
      if (spokenByUser.has(key)) continue;

      const entry = candidates.get(key) || { word, count: 0, example: turn.reply };
      entry.count += 1;
      candidates.set(key, entry);
    }
  }

  return [...candidates.values()]
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, MAX_WORDS)
    .map((entry) => ({ word: entry.word, count: entry.count, example: entry.example }));
}
