/**
 * The month calendar behind the "By date" button.
 *
 * Only days you actually practised can be picked. A day you never spoke on has
 * nothing to show, and letting it be chosen would answer "no mistakes" to a
 * question that was really "were you even here" — two different things.
 *
 * One click sets a single day. A second click extends that day into a range, so
 * the simple case stays one click and the wider view costs one more.
 */

import { toKey, fromKey } from './charts.js';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

/**
 * @param {object} options
 * @param {{date: string, turns: number, mistakes: number}[]} options.days
 * @param {string|null} options.from Selected first day, as YYYY-MM-DD.
 * @param {string|null} options.to Selected last day. Null means a single day.
 * @param {(from: string|null, to: string|null) => void} options.onChange
 * @returns {HTMLElement}
 */
export function calendar({ days, from, to, onChange }) {
  const byDate = new Map(days.map((day) => [day.date, day]));

  // Open on the month being looked at, or the last month with any practice in
  // it, so the calendar does not open on an empty page.
  const anchor = from || days.at(-1)?.date || toKey(new Date());
  let month = fromKey(anchor);
  month.setDate(1);

  const root = element('div', 'calendar');

  function pick(key) {
    // A finished range starts the next selection over; an open one closes.
    if (!from || to) onChange(key, null);
    else if (key < from) onChange(key, from);
    else onChange(from, key);
  }

  function draw() {
    const head = element('div', 'calendar-head');

    const previous = element('button', 'ghost calendar-step', '‹');
    previous.type = 'button';
    previous.setAttribute('aria-label', 'Previous month');
    previous.addEventListener('click', () => {
      month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
      draw();
    });

    const next = element('button', 'ghost calendar-step', '›');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next month');
    next.addEventListener('click', () => {
      month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
      draw();
    });

    head.append(
      previous,
      element('span', 'calendar-month', month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      next,
    );

    const grid = element('div', 'calendar-grid');
    for (const day of WEEKDAYS) grid.append(element('span', 'calendar-weekday', day));

    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();

    for (let blank = 0; blank < first.getDay(); blank += 1) grid.append(element('span', 'calendar-blank'));

    for (let dayNumber = 1; dayNumber <= lastDay; dayNumber += 1) {
      const key = toKey(new Date(month.getFullYear(), month.getMonth(), dayNumber));
      const entry = byDate.get(key);

      const cell = element('button', 'calendar-day', String(dayNumber));
      cell.type = 'button';

      if (!entry) {
        cell.disabled = true;
        cell.title = 'No practice on this day';
      } else {
        cell.title = `${entry.turns} turns, ${entry.mistakes} mistakes`;
        if (entry.mistakes > 0) cell.classList.add('has-mistakes');
        else cell.classList.add('clean');
        cell.addEventListener('click', () => pick(key));
      }

      const end = to || from;
      if (from && key >= from && key <= end) cell.classList.add('picked');
      if (key === from || key === to) cell.classList.add('edge');
      // The half-made range needs to look unfinished, or the second click looks
      // like it undid the first.
      if (from && !to && key === from) cell.classList.add('pending');

      grid.append(cell);
    }

    const footer = element('div', 'calendar-foot');
    const legend = element('span', 'calendar-legend');
    legend.append(
      element('i', 'dot has-mistakes'),
      element('span', null, 'mistakes'),
      element('i', 'dot clean'),
      element('span', null, 'clean day'),
    );

    const clear = element('button', 'ghost', 'All dates');
    clear.type = 'button';
    clear.disabled = !from;
    clear.addEventListener('click', () => onChange(null, null));

    footer.append(legend, clear);

    const hint = element(
      'p',
      'calendar-hint',
      from && !to ? 'Pick a second day for a range, or reopen to start again.' : 'Pick a day. Pick a second for a range.',
    );

    root.replaceChildren(head, grid, hint, footer);
  }

  draw();
  return root;
}
