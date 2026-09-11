/**
 * Mistake report screen.
 *
 * Everything here is derived from stored sessions, so this view is the
 * permanent record: it never clears between turns or sessions.
 */

import { apiFetch } from './api.js';
import { donut, heatmap, toSlices, fromKey } from './charts.js';
import { calendar } from './calendar.js';

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

const bodyEl = document.getElementById('report-body');

/** The log's filters. Kept here so a refresh does not throw them away. */
const filter = { type: '', from: null, to: null };

let calendarOpen = false;

function label(type) {
  return MISTAKE_LABEL[type] || MISTAKE_LABEL.other;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDay(key) {
  return fromKey(key).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** What the date button says, so the current filter is readable without opening it. */
function dateLabel() {
  if (!filter.from) return 'By date';
  if (!filter.to || filter.to === filter.from) return formatDay(filter.from);
  return `${formatDay(filter.from)} – ${formatDay(filter.to)}`;
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderTiles(totals) {
  const tiles = [
    ['Mistakes logged', totals.mistakes],
    ['Turns spoken', totals.turns],
    ['Clean turns', totals.cleanTurns],
    ['Mistakes per turn', totals.mistakesPerTurn],
    ['Sessions', totals.sessions],
  ];

  const wrap = element('div', 'tiles');
  for (const [name, value] of tiles) {
    const tile = element('div', 'tile');
    tile.append(element('span', 'tile-value', String(value)), element('span', 'tile-name', name));
    wrap.append(tile);
  }
  return wrap;
}

/**
 * Error types as a ring beside a bar list.
 *
 * The ring answers "how much of my trouble is this one thing", the bars answer
 * "which is worst and by how much". The bars double as the ring's legend, so
 * the colours are never the only way to read it.
 */
function renderByType(byType) {
  const section = element('section', 'panel');
  section.append(element('h3', null, 'Common error types'));

  if (byType.length === 0) {
    section.append(element('p', 'empty-note', 'No mistakes logged yet.'));
    return section;
  }

  const slices = toSlices(byType, label);
  const max = byType[0].count;

  const layout = element('div', 'type-split');
  layout.append(donut(slices));

  const list = element('ul', 'bars');
  const colorOf = new Map(slices.map((slice) => [slice.key, slice.color]));
  const tailColor = colorOf.get('__other__');

  for (const row of byType) {
    const item = document.createElement('li');
    const head = element('div', 'bar-head');
    const name = element('span', 'bar-name');
    const swatch = element('i', 'swatch');
    swatch.style.background = colorOf.get(row.type) || tailColor || 'var(--chart-empty)';
    name.append(swatch, document.createTextNode(label(row.type)));
    head.append(name, element('span', 'bar-count', String(row.count)));

    const track = element('div', 'bar-track');
    const fill = element('div', 'bar-fill');
    fill.style.width = `${Math.round((row.count / max) * 100)}%`;
    fill.style.background = colorOf.get(row.type) || tailColor || 'var(--accent)';
    track.append(fill);

    item.append(head, track);
    list.append(item);
  }

  layout.append(list);
  section.append(layout);
  return section;
}

/** A square per day, so streaks and gaps show without reading any number. */
function renderHeatmap(report) {
  // Full width: a six-month strip in half a screen would only scroll more.
  const section = element('section', 'panel wide');
  section.append(element('h3', null, 'Practice by day'));

  if (report.calendar.length === 0) {
    section.append(element('p', 'empty-note', 'No practice days recorded yet.'));
    return section;
  }

  const scroller = element('div', 'heatmap-scroll');
  scroller.append(
    heatmap(report.calendar, {
      from: filter.from,
      to: filter.to,
      onPick: (day) => {
        filter.from = day;
        filter.to = null;
        load();
      },
    }),
  );
  section.append(scroller);

  const key = element('div', 'heat-key');
  key.append(element('span', 'hint', 'Fewer turns'));
  for (const level of ['--chart-empty', '--heat-1', '--heat-2', '--heat-3', '--heat-4']) {
    const box = element('i', 'heat-swatch');
    box.style.background = `var(${level})`;
    key.append(box);
  }
  key.append(element('span', 'hint', 'More'));
  section.append(key);

  section.append(element('p', 'hint', 'Click a day to see the mistakes you made on it.'));
  return section;
}

/** Mistakes per turn by day. Talking more should not look like getting worse. */
function renderTrend(trend) {
  const section = element('section', 'panel');
  section.append(element('h3', null, 'Mistakes per turn, by day'));

  if (trend.length === 0) {
    section.append(element('p', 'empty-note', 'No practice days recorded yet.'));
    return section;
  }

  const max = Math.max(...trend.map((day) => day.mistakesPerTurn), 0.5);
  const chart = element('div', 'trend');

  for (const day of trend) {
    const column = element('div', 'trend-col');
    column.title = `${day.date}: ${day.mistakes} mistakes in ${day.turns} turns`;
    const bar = element('div', 'trend-bar');
    bar.style.height = `${Math.max(3, Math.round((day.mistakesPerTurn / max) * 100))}%`;
    column.append(element('span', 'trend-value', String(day.mistakesPerTurn)), bar, element('span', 'trend-date', day.date.slice(5)));
    chart.append(column);
  }

  section.append(chart);
  return section;
}

function renderRecurring(recurring) {
  const section = element('section', 'panel wide');
  section.append(element('h3', null, 'Repeated mistakes'));

  if (recurring.length === 0) {
    section.append(element('p', 'empty-note', 'Nothing repeated yet. A mistake appears here once you make it twice.'));
    return section;
  }

  const list = element('ul', 'recurring');
  for (const row of recurring) {
    const item = document.createElement('li');
    const line = element('p', 'fix');
    line.append(element('s', null, row.original), ' ', element('strong', null, row.corrected));
    item.append(element('span', 'badge', label(row.type)), line, element('span', 'times', `${row.count} times`));
    list.append(item);
  }

  section.append(list);
  return section;
}

/** The date button and the calendar that drops out of it. */
function renderDatePicker(report) {
  const wrap = element('div', 'date-picker');

  const button = element('button', 'ghost date-button', dateLabel());
  button.type = 'button';
  button.setAttribute('aria-expanded', String(calendarOpen));
  if (filter.from) button.classList.add('active');
  button.addEventListener('click', () => {
    calendarOpen = !calendarOpen;
    render(report);
  });
  wrap.append(button);

  if (filter.from) {
    const clear = element('button', 'chip-clear', '×');
    clear.type = 'button';
    clear.title = 'Show every date';
    clear.setAttribute('aria-label', 'Show every date');
    clear.addEventListener('click', () => {
      filter.from = null;
      filter.to = null;
      calendarOpen = false;
      load();
    });
    wrap.append(clear);
  }

  if (calendarOpen) {
    wrap.append(
      calendar({
        days: report.calendar,
        from: filter.from,
        to: filter.to,
        onChange: (from, to) => {
          filter.from = from;
          filter.to = to;
          // An unfinished range keeps the calendar open for the second click.
          calendarOpen = Boolean(from) && !to;
          load();
        },
      }),
    );
  }

  return wrap;
}

function renderLog(report) {
  const section = element('section', 'panel wide');

  const head = element('div', 'panel-head');
  head.append(element('h3', null, 'Every mistake'));

  const controls = element('div', 'log-controls');

  const types = document.createElement('select');
  types.setAttribute('aria-label', 'Filter by mistake type');
  types.append(new Option('All types', ''));
  for (const row of report.byType) {
    types.append(new Option(`${label(row.type)} (${row.count})`, row.type));
  }
  types.value = filter.type;
  types.addEventListener('change', () => {
    filter.type = types.value;
    load();
  });

  controls.append(types, renderDatePicker(report));
  head.append(controls);
  section.append(head);

  if (report.mistakes.length === 0) {
    const narrowed = filter.type || filter.from;
    section.append(
      element(
        'p',
        'empty-note',
        narrowed ? 'No mistakes match this filter.' : 'No mistakes logged yet. Have a conversation first.',
      ),
    );
    return section;
  }

  const list = element('ul', 'log');
  for (const mistake of report.mistakes) {
    const item = document.createElement('li');

    const meta = element('div', 'log-meta');
    meta.append(element('span', 'badge', label(mistake.type)), element('span', 'when', formatDate(mistake.at)));

    const line = element('p', 'fix');
    line.append(element('s', null, mistake.original), ' ', element('strong', null, mistake.corrected));

    item.append(meta, line);
    if (mistake.explanation) item.append(element('p', 'why', mistake.explanation));
    if (mistake.said) item.append(element('p', 'said', `You said: ${mistake.said}`));

    list.append(item);
  }

  section.append(list);

  if (report.filtered.count > report.mistakes.length) {
    section.append(
      element('p', 'empty-note', `Showing the newest ${report.mistakes.length} of ${report.filtered.count}.`),
    );
  }

  return section;
}

function render(report) {
  const fragment = document.createDocumentFragment();
  // Order matters once these sit in two columns: the two compact charts pair
  // up on the first row, and everything long runs full width beneath them.
  fragment.append(
    renderTiles(report.totals),
    renderByType(report.byType),
    renderTrend(report.trend),
    renderHeatmap(report),
    renderRecurring(report.recurring),
    renderLog(report),
  );
  bodyEl.replaceChildren(fragment);
}

/** Fetches and draws the report. Safe to call whenever the screen is shown. */
export async function load() {
  // Changing a filter must not throw away where you were reading. The screen
  // stays put and dims, rather than collapsing to "Loading…" and jumping up.
  const scroller = bodyEl.closest('.report') || document.scrollingElement;
  const keepScroll = scroller.scrollTop;
  const drawn = Boolean(bodyEl.querySelector('.panel'));

  if (drawn) bodyEl.classList.add('busy');
  else bodyEl.replaceChildren(element('p', 'empty', 'Loading…'));

  const query = new URLSearchParams();
  // Days are bucketed in this browser's zone, so an evening's practice counts
  // on the evening it happened rather than the next UTC date.
  query.set('tzOffset', String(new Date().getTimezoneOffset()));
  if (filter.type) query.set('type', filter.type);
  if (filter.from) {
    query.set('from', filter.from);
    // A single day is a range of one. Sending only "from" would ask the server
    // for that day onwards, which is not what one click on a calendar means.
    query.set('to', filter.to || filter.from);
  }

  try {
    render(await apiFetch(`/api/report?${query}`));
    if (drawn) scroller.scrollTop = keepScroll;
  } catch (error) {
    bodyEl.replaceChildren(element('p', 'empty-note', error.message));
  } finally {
    bodyEl.classList.remove('busy');
  }
}
