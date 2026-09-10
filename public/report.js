/**
 * Mistake report screen.
 *
 * Everything here is derived from stored sessions, so this view is the
 * permanent record: it never clears between turns or sessions.
 */

import { apiFetch } from './api.js';

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

let activeType = '';

function label(type) {
  return MISTAKE_LABEL[type] || MISTAKE_LABEL.other;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

/** Bar list of error types. The widest bar is the habit worth working on. */
function renderByType(byType) {
  const section = element('section', 'panel');
  section.append(element('h3', null, 'Common error types'));

  if (byType.length === 0) {
    section.append(element('p', 'empty-note', 'No mistakes logged yet.'));
    return section;
  }

  const max = byType[0].count;
  const list = element('ul', 'bars');

  for (const row of byType) {
    const item = document.createElement('li');
    const head = element('div', 'bar-head');
    head.append(element('span', null, label(row.type)), element('span', 'bar-count', String(row.count)));
    const track = element('div', 'bar-track');
    const fill = element('div', 'bar-fill');
    fill.style.width = `${Math.round((row.count / max) * 100)}%`;
    track.append(fill);
    item.append(head, track);
    list.append(item);
  }

  section.append(list);
  return section;
}

function renderRecurring(recurring) {
  const section = element('section', 'panel');
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

function renderLog(report, onFilterChange) {
  const section = element('section', 'panel');

  const head = element('div', 'panel-head');
  head.append(element('h3', null, 'Every mistake'));

  const filter = document.createElement('select');
  filter.setAttribute('aria-label', 'Filter by mistake type');
  filter.append(new Option('All types', ''));
  for (const row of report.byType) {
    filter.append(new Option(`${label(row.type)} (${row.count})`, row.type));
  }
  filter.value = activeType;
  filter.addEventListener('change', () => onFilterChange(filter.value));
  head.append(filter);
  section.append(head);

  if (report.mistakes.length === 0) {
    section.append(
      element('p', 'empty-note', activeType ? 'No mistakes of this type.' : 'No mistakes logged yet. Have a conversation first.'),
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
  fragment.append(
    renderTiles(report.totals),
    renderByType(report.byType),
    renderRecurring(report.recurring),
    renderTrend(report.trend),
    renderLog(report, (type) => {
      activeType = type;
      load();
    }),
  );
  bodyEl.replaceChildren(fragment);
}

/** Fetches and draws the report. Safe to call whenever the screen is shown. */
export async function load() {
  bodyEl.replaceChildren(element('p', 'empty', 'Loading…'));
  try {
    const query = activeType ? `?type=${encodeURIComponent(activeType)}` : '';
    render(await apiFetch(`/api/report${query}`));
  } catch (error) {
    bodyEl.replaceChildren(element('p', 'empty-note', error.message));
  }
}
