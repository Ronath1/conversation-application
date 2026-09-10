/**
 * A drawn face for every voice.
 *
 * The voices on a machine are not people and have no portraits: "David" and
 * "Zira" are product names for synthesised speech. So the faces here are drawn
 * from the voice's own name rather than fetched — the same name always makes
 * the same face, no image files ship, and a voice this code has never heard of
 * still gets a portrait. That matters, because the voice list is different on
 * every device.
 *
 * The name is the only input. Where it says "Female" or "Male", or is a name
 * common enough to guess from, that steers the hair; otherwise the hash picks.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Steady across reloads and machines: the same string gives the same number. */
function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return Math.abs(value);
}

function pick(list, seed) {
  return list[seed % list.length];
}

/**
 * The short name to write under the face.
 *
 * "Microsoft David Desktop - English (United States)" is the machine's label,
 * not a name anyone would say. What is left is the part that identifies the
 * voice to a person.
 */
export function shortName(voiceName) {
  let name = String(voiceName || 'Default')
    .replace(/\s*[-–(].*$/, '')
    .replace(/^(Microsoft|Google|Apple|Samsung|Chrome OS|Android)\s+/i, '')
    .replace(/\s+(Desktop|Mobile|Online|Natural|Enhanced|Compact|Premium)\b/gi, '')
    .trim();

  // "Google UK English Female" reads better as "UK Female", but "Google US
  // English" must not shrink to a bare "US" — so the word only goes when
  // something recognisable is left standing.
  const withoutEnglish = name.replace(/\s*\bEnglish\b\s*/i, ' ').replace(/\s+/g, ' ').trim();
  if (withoutEnglish.split(' ').length >= 2) name = withoutEnglish;

  if (!name) name = String(voiceName || 'Default').trim();
  return name;
}

const FEMALE = new Set(
  'zira hazel susan linda heera catherine aria jenny michelle ana eva sonia samantha karen moira tessa fiona serena allison ava nicky kate victoria emma amy joanna salli kendra ivy'.split(
    ' ',
  ),
);
const MALE = new Set(
  'david mark george james ryan guy liam daniel alex fred oliver thomas aaron arthur gordon rishi ravi brian matthew joey justin russell geraint'.split(
    ' ',
  ),
);

/** female, male, or null when the name says nothing either way. */
function readGender(voiceName) {
  const text = String(voiceName || '').toLowerCase();
  if (/\bfemale\b/.test(text)) return 'female';
  if (/\bmale\b/.test(text)) return 'male';

  const first = shortName(voiceName).split(/\s+/)[0].toLowerCase();
  if (FEMALE.has(first)) return 'female';
  if (MALE.has(first)) return 'male';
  return null;
}

const SKIN_TONES = ['#f4d5bd', '#e8bc98', '#d19a72', '#a9714b', '#7d4f33', '#5a3825'];
const HAIR_COLORS = ['#2b2118', '#4a3423', '#7a4a1e', '#a6641f', '#6b6b6b', '#1a1a1a', '#c08a3e'];
const BACKGROUNDS = ['#dbeafe', '#dcfce7', '#fef3c7', '#fae8ff', '#ffe4e6', '#e0e7ff', '#ccfbf1', '#ffedd5'];
const SHIRTS = ['#2563eb', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#15803d', '#475569'];

function el(tag, attributes) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** Hair drawn behind the head, for the styles that fall past the jaw. */
function backHair(style, color) {
  if (style === 'long') {
    return el('path', { d: 'M24 40 q0 -22 24 -22 t24 22 l0 30 q0 8 -8 8 l-32 0 q-8 0 -8 -8 z', fill: color });
  }
  if (style === 'bob') {
    return el('path', { d: 'M25 40 q0 -21 23 -21 t23 21 l0 16 q0 7 -7 7 l-32 0 q-7 0 -7 -7 z', fill: color });
  }
  return null;
}

/** Hair drawn over the forehead. Every style needs one of these. */
function frontHair(style, color) {
  if (style === 'crop') return el('path', { d: 'M27 40 q1 -20 21 -20 t21 20 q-6 -9 -21 -9 t-21 9 z', fill: color });
  if (style === 'fringe') return el('path', { d: 'M26 41 q0 -21 22 -21 t22 21 q-4 -12 -22 -12 t-22 12 z', fill: color });
  if (style === 'buzz') return el('path', { d: 'M29 38 q2 -16 19 -16 t19 16 q-7 -7 -19 -7 t-19 7 z', fill: color });
  if (style === 'curly') {
    const group = el('g', { fill: color });
    for (const [cx, cy, r] of [
      [32, 30, 8],
      [41, 24, 9],
      [52, 23, 9],
      [62, 29, 8],
      [67, 37, 7],
      [28, 38, 7],
    ]) {
      group.append(el('circle', { cx, cy, r }));
    }
    return group;
  }
  // long and bob share the same fringe shape over the front.
  return el('path', { d: 'M26 41 q0 -21 22 -21 t22 21 q-5 -11 -22 -11 t-22 11 z', fill: color });
}

const FEMALE_STYLES = ['long', 'bob', 'curly', 'fringe'];
const MALE_STYLES = ['crop', 'buzz', 'curly', 'fringe'];
const ANY_STYLE = ['crop', 'buzz', 'curly', 'fringe', 'bob', 'long'];

/**
 * Draws one face.
 *
 * @param {string} voiceName The voice's full name, used as the seed.
 * @param {number} [size] Pixel width and height.
 * @returns {SVGElement}
 */
export function avatar(voiceName, size = 84) {
  const name = String(voiceName || 'Default voice');
  const seed = hash(name);
  const gender = readGender(name);

  const styles = gender === 'female' ? FEMALE_STYLES : gender === 'male' ? MALE_STYLES : ANY_STYLE;
  const style = pick(styles, seed >> 3);
  const skin = pick(SKIN_TONES, seed >> 7);
  const hair = pick(HAIR_COLORS, seed >> 11);
  const background = pick(BACKGROUNDS, seed >> 5);
  const shirt = pick(SHIRTS, seed >> 13);
  const glasses = (seed >> 17) % 4 === 0;

  const svg = el('svg', {
    class: 'avatar',
    viewBox: '0 0 96 96',
    width: size,
    height: size,
    role: 'img',
    'aria-label': `Illustration for the ${shortName(name)} voice`,
  });

  const clip = el('clipPath', { id: `avatar-clip-${seed}` });
  clip.append(el('circle', { cx: 48, cy: 48, r: 48 }));
  svg.append(clip);

  const scene = el('g', { 'clip-path': `url(#avatar-clip-${seed})` });
  scene.append(el('rect', { x: 0, y: 0, width: 96, height: 96, fill: background }));

  // Shoulders, drawn wide enough to reach the edges of the circle.
  scene.append(el('path', { d: 'M14 96 q0 -22 34 -22 t34 22 z', fill: shirt }));

  const back = backHair(style, hair);
  if (back) scene.append(back);

  scene.append(el('path', { d: 'M48 62 l0 14 l-8 0 l0 -14 z', fill: skin }));
  scene.append(el('ellipse', { cx: 30, cy: 44, rx: 4, ry: 5, fill: skin }));
  scene.append(el('ellipse', { cx: 66, cy: 44, rx: 4, ry: 5, fill: skin }));
  scene.append(el('ellipse', { cx: 48, cy: 42, rx: 21, ry: 24, fill: skin }));

  scene.append(frontHair(style, hair));

  scene.append(el('ellipse', { cx: 40, cy: 43, rx: 2.6, ry: 3.2, fill: '#2b2118' }));
  scene.append(el('ellipse', { cx: 56, cy: 43, rx: 2.6, ry: 3.2, fill: '#2b2118' }));
  scene.append(
    el('path', { d: 'M36 37 q4 -2.5 8 0', stroke: hair, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }),
  );
  scene.append(
    el('path', { d: 'M52 37 q4 -2.5 8 0', stroke: hair, 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' }),
  );

  scene.append(
    el('path', {
      d: 'M41 53 q7 6 14 0',
      stroke: '#8b4a3d',
      'stroke-width': 2.4,
      fill: 'none',
      'stroke-linecap': 'round',
    }),
  );

  if (glasses) {
    const frames = el('g', { stroke: '#3f4650', 'stroke-width': 2, fill: 'none' });
    frames.append(el('circle', { cx: 40, cy: 43, r: 7 }));
    frames.append(el('circle', { cx: 56, cy: 43, r: 7 }));
    frames.append(el('path', { d: 'M47 43 l2 0' }));
    scene.append(frames);
  }

  svg.append(scene);
  return svg;
}
