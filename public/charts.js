/**
 * The report's charts, drawn as plain SVG.
 *
 * No chart library: this app has no build step, and both shapes here are a few
 * dozen lines of geometry. Colours come from CSS custom properties so the two
 * charts and the rest of the screen stay one palette.
 *
 * Three of the categorical colours sit below 3:1 against a white panel, so
 * every value on both charts is also written out in text — the donut's legend
 * carries the counts, and each heatmap square names its own day. Colour is
 * never the only way to read either chart.
 */

const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];

/** Part-to-whole reads at a glance up to six slices, so the tail is folded in. */
const MAX_SLICES = 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attributes = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  return el;
}

function titled(el, text) {
  const title = svgEl('title');
  title.textContent = text;
  el.append(title);
  return el;
}

/**
 * Groups the error types into at most six slices, newest colour assignments
 * following the fixed slot order so a type keeps its colour as counts change.
 *
 * @param {{type: string, count: number}[]} byType Sorted by count, descending.
 * @param {(type: string) => string} label
 */
export function toSlices(byType, label) {
  const head = byType.slice(0, MAX_SLICES - 1);
  const tail = byType.slice(MAX_SLICES - 1);

  const slices = head.map((row, index) => ({
    key: row.type,
    name: label(row.type),
    count: row.count,
    color: `var(${SERIES[index]})`,
  }));

  if (tail.length === 1) {
    slices.push({
      key: tail[0].type,
      name: label(tail[0].type),
      count: tail[0].count,
      color: `var(${SERIES[slices.length]})`,
    });
  } else if (tail.length > 1) {
    // The remainder is not a category, so it does not take a category's colour.
    // A neutral keeps the several types inside it from reading as one thing.
    slices.push({
      key: '__other__',
      name: `${tail.length} other types`,
      count: tail.reduce((total, row) => total + row.count, 0),
      color: 'var(--chart-other)',
    });
  }

  return slices;
}

/**
 * A ring showing what share each error type is of the whole, with the total in
 * the middle. Ranking and exact counts are the legend's job, not the ring's.
 *
 * @param {{name: string, count: number, color: string}[]} slices
 */
export function donut(slices) {
  const size = 180;
  const radius = 62;
  const thickness = 26;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);

  const svg = svgEl('svg', {
    class: 'donut',
    viewBox: `0 0 ${size} ${size}`,
    role: 'img',
    'aria-label': `${total} mistakes, split by type. The counts are listed beside the chart.`,
  });

  svg.append(
    svgEl('circle', {
      cx: size / 2,
      cy: size / 2,
      r: radius,
      fill: 'none',
      stroke: 'var(--chart-empty)',
      'stroke-width': thickness,
    }),
  );

  if (total > 0) {
    // A gap of surface between neighbouring arcs, so two similar hues never
    // touch. Measured in degrees, then taken off each arc's own length.
    const gap = slices.length > 1 ? (2 / circumference) * 360 : 0;
    let angle = -90;

    for (const slice of slices) {
      const sweep = (slice.count / total) * 360;
      const drawn = Math.max(sweep - gap, 0.6);
      const arc = svgEl('circle', {
        cx: size / 2,
        cy: size / 2,
        r: radius,
        fill: 'none',
        stroke: slice.color,
        'stroke-width': thickness,
        'stroke-dasharray': `${(drawn / 360) * circumference} ${circumference}`,
        transform: `rotate(${angle} ${size / 2} ${size / 2})`,
      });
      const share = Math.round((slice.count / total) * 100);
      svg.append(titled(arc, `${slice.name}: ${slice.count} of ${total} (${share}%)`));
      angle += sweep;
    }
  }

  const value = svgEl('text', {
    class: 'donut-total',
    x: size / 2,
    y: size / 2 - 2,
    'text-anchor': 'middle',
  });
  value.textContent = String(total);

  const caption = svgEl('text', {
    class: 'donut-caption',
    x: size / 2,
    y: size / 2 + 18,
    'text-anchor': 'middle',
  });
  caption.textContent = total === 1 ? 'mistake' : 'mistakes';

  svg.append(value, caption);
  return svg;
}

/* ---------- practice heatmap ---------- */

const DAY_MS = 86_400_000;

/** Local, not UTC: a practice day is the day it was where the person was. */
function toKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function fromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Squares by day, darker for more turns spoken.
 *
 * Shade follows turns rather than mistakes, because this chart answers "did I
 * practise" — colouring by mistakes would paint a day of hard work as a bad one.
 *
 * @param {{date: string, turns: number, mistakes: number}[]} days
 * @param {object} options
 * @param {number} [options.weeks] How far back to draw.
 * @param {string|null} [options.from] Currently selected range, to mark.
 * @param {string|null} [options.to]
 * @param {(day: string) => void} [options.onPick]
 */
export function heatmap(days, { weeks = 26, from = null, to = null, onPick } = {}) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const busiest = Math.max(1, ...days.map((day) => day.turns));

  const cell = 13;
  const gap = 3;
  const step = cell + gap;
  const padLeft = 28;
  const padTop = 16;

  // Start on the Sunday at or before the first day drawn, so every column is a
  // full week and the rows line up with the weekday labels.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today.getTime() - (weeks * 7 - 1) * DAY_MS);
  start.setDate(start.getDate() - start.getDay());

  const columns = Math.ceil((today.getTime() - start.getTime()) / (7 * DAY_MS)) + 1;
  const width = padLeft + columns * step;
  const height = padTop + 7 * step;

  const svg = svgEl('svg', {
    class: 'heatmap',
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: 'img',
    'aria-label': 'Practice by day. Darker squares are days with more turns spoken.',
  });

  for (const [row, name] of [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ]) {
    const text = svgEl('text', { class: 'heat-label', x: 0, y: padTop + row * step + cell - 2 });
    text.textContent = name;
    svg.append(text);
  }

  let lastMonth = -1;

  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < 7; row += 1) {
      const date = new Date(start.getTime() + (column * 7 + row) * DAY_MS);
      if (date > today) continue;

      const key = toKey(date);
      const entry = byDate.get(key);
      const turns = entry?.turns || 0;

      // Four steps of one hue. Any practice at all leaves a visible mark, so a
      // short day never disappears into the empty colour.
      let fill = 'var(--chart-empty)';
      if (turns > 0) {
        const share = turns / busiest;
        const level = share > 0.66 ? 4 : share > 0.33 ? 3 : share > 0.12 ? 2 : 1;
        fill = `var(--heat-${level})`;
      }

      const square = svgEl('rect', {
        class: 'heat-cell',
        x: padLeft + column * step,
        y: padTop + row * step,
        width: cell,
        height: cell,
        rx: 3,
        fill,
      });

      const selected = from && key >= from && key <= (to || from);
      if (selected) square.classList.add('picked');
      if (entry) square.classList.add('has-data');

      const readable = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      titled(
        square,
        entry
          ? `${readable}: ${entry.turns} turns, ${entry.mistakes} mistakes`
          : `${readable}: no practice`,
      );

      if (onPick && entry) {
        square.classList.add('clickable');
        square.addEventListener('click', () => onPick(key));
      }

      svg.append(square);

      if (row === 0 && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        const text = svgEl('text', { class: 'heat-label', x: padLeft + column * step, y: 10 });
        text.textContent = date.toLocaleDateString(undefined, { month: 'short' });
        svg.append(text);
      }
    }
  }

  return svg;
}

export { toKey, fromKey };
