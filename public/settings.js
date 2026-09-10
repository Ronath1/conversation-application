/**
 * Settings screen: provider, API key and today's usage.
 *
 * The key is write-only from here. The backend returns a masked form, so this
 * screen can show which key is in use without ever holding the key itself.
 */

import { apiFetch } from './api.js';

const bodyEl = document.getElementById('settings-body');

let cache = { settings: null, usage: null, models: null };

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function setNote(message, kind = 'note') {
  const note = document.getElementById('settings-note');
  if (!note) return;
  note.textContent = message || '';
  note.className = `settings-note ${kind}`;
}

const api = apiFetch;

/* ---------- sections ---------- */

function renderProvider(settings) {
  const panel = element('section', 'panel');
  panel.append(element('h3', null, 'Provider'));

  const row = element('div', 'field-row');
  const select = document.createElement('select');
  select.id = 'provider-select';
  select.setAttribute('aria-label', 'AI provider');
  for (const provider of settings.providers) {
    select.append(new Option(`${provider.label}${provider.hasKey ? '' : ' (no key)'}`, provider.id));
  }
  select.value = settings.activeProvider;

  select.addEventListener('change', async () => {
    try {
      await api('/api/settings/provider', { method: 'PUT', body: JSON.stringify({ provider: select.value }) });
      setNote(`Switched to ${select.value}.`, 'ok');
      await load();
    } catch (error) {
      setNote(error.message, 'error');
    }
  });

  row.append(select);
  panel.append(row);

  return panel;
}

/**
 * The model picker.
 *
 * The list comes from the provider, asked with this user's own key, so it
 * shows what that key can reach rather than everything that exists. Any model
 * can still be typed in by hand, because a list can always be behind.
 */
function renderModel(settings) {
  const active = settings.providers.find((provider) => provider.id === settings.activeProvider);
  const models = cache.models;

  const panel = element('section', 'panel');
  panel.append(element('h3', null, 'Model'));

  const row = element('div', 'field-row');
  const select = document.createElement('select');
  select.id = 'model-select';
  select.setAttribute('aria-label', 'Model');

  const rows = models?.models || [{ id: active?.model, label: active?.model }];
  for (const model of rows) {
    let label = model.label || model.id;
    if (model.free === true) label += '  (free)';
    if (model.unlisted) label += '  (not listed by your key)';
    select.append(new Option(label, model.id));
  }
  select.append(new Option('Other model…', '__custom__'));
  select.value = rows.some((model) => model.id === active?.model) ? active.model : rows[0]?.id;

  const custom = document.createElement('input');
  custom.type = 'text';
  custom.placeholder = 'Type a model id, then press Enter';
  custom.hidden = true;
  custom.setAttribute('aria-label', 'Custom model id');

  async function save(model) {
    if (!model || model === '__custom__') return;
    setNote(`Switching to ${model}…`);
    try {
      await api('/api/settings/model', { method: 'PUT', body: JSON.stringify({ provider: settings.activeProvider, model }) });
      setNote(`Model set to ${model}. It applies to your next turn.`, 'ok');
      await load();
    } catch (error) {
      setNote(error.message, 'error');
    }
  }

  select.addEventListener('change', () => {
    const choosingCustom = select.value === '__custom__';
    custom.hidden = !choosingCustom;
    if (choosingCustom) custom.focus();
    else save(select.value);
  });

  custom.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    save(custom.value.trim());
  });

  row.append(select);
  panel.append(row, custom);

  // Where the list came from matters: a fallback list is not a promise that
  // anything on it will work.
  if (models?.source === 'provider') {
    panel.append(element('p', 'hint', `${rows.length} models your ${active?.label} key can see.`));
  } else if (models?.reason) {
    panel.append(element('p', 'hint', models.reason));
  }

  const warning = element('div', 'model-warning');
  warning.append(
    element(
      'p',
      null,
      'Not every model will work with every key. Access and cost depend on the provider and on what your account has paid for: a free key usually reaches only the cheaper models, and an expensive model may be refused or may charge your credit. If a model does not answer, choose another one here.',
    ),
  );
  panel.append(warning);

  return panel;
}

function renderKey(settings) {
  const active = settings.providers.find((provider) => provider.id === settings.activeProvider);
  const panel = element('section', 'panel');
  panel.append(element('h3', null, 'API key'));

  const status = element('p', 'key-status');
  if (active?.hasKey) {
    status.append(element('span', 'pill ok', 'Key set'), ` ${active.maskedKey}`);
    if (active.keyUpdatedAt) {
      status.append(element('span', 'hint', ` updated ${new Date(active.keyUpdatedAt).toLocaleString()}`));
    }
  } else {
    status.append(element('span', 'pill warn', 'No key'), ' Add one below to start talking.');
  }
  panel.append(status);

  if (active?.keyUrl) {
    const getKey = element('div', 'get-key');
    getKey.append(element('p', 'get-key-title', `Do not have a ${active.label} key yet?`));

    const link = document.createElement('a');
    link.className = 'primary get-key-button';
    link.href = active.keyUrl;
    link.target = '_blank';
    // Stops the new tab from being able to reach back into this one.
    link.rel = 'noopener noreferrer';
    link.textContent = `Get a ${active.label} API key`;
    getKey.append(link);

    getKey.append(
      element(
        'p',
        'hint',
        'Opens in a new tab. Create the key there, copy it, then paste it below. The key is yours and is only used by your account.',
      ),
    );
    panel.append(getKey);
  }

  const form = document.createElement('form');
  form.className = 'field-row';

  const input = document.createElement('input');
  input.type = 'password';
  input.id = 'key-input';
  input.placeholder = active?.hasKey ? 'Paste a new key to replace it' : 'Paste your API key';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', 'API key');

  const save = element('button', 'primary', 'Save key');
  save.type = 'submit';

  form.append(input, save);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const apiKey = input.value.trim();
    if (!apiKey) return;

    save.disabled = true;
    setNote('Checking the key with the provider…');
    try {
      const result = await api('/api/settings/key', {
        method: 'PUT',
        body: JSON.stringify({ provider: settings.activeProvider, apiKey }),
      });
      input.value = '';
      setNote(result.warning || 'Key saved. It applies to your next turn, with no restart.', 'ok');
      await load();
    } catch (error) {
      setNote(error.message, 'error');
    } finally {
      save.disabled = false;
    }
  });

  panel.append(form);

  if (active?.keyHint) panel.append(element('p', 'hint', active.keyHint));

  if (active?.hasKey) {
    const remove = element('button', 'ghost danger', 'Forget this key');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await api(`/api/settings/key/${settings.activeProvider}`, { method: 'DELETE' });
        setNote('Key removed.', 'ok');
        await load();
      } catch (error) {
        setNote(error.message, 'error');
        remove.disabled = false;
      }
    });
    panel.append(remove);
  }

  return panel;
}

function renderUsage(usage) {
  const panel = element('section', 'panel');
  panel.append(element('h3', null, 'Usage today'));

  if (!usage) {
    panel.append(element('p', 'empty-note', 'No usage data.'));
    return panel;
  }

  const headline = usage.limit
    ? `${usage.used} of about ${usage.limit} free requests`
    : `${usage.used} requests`;
  panel.append(element('p', 'usage-head', headline));

  if (usage.limit) {
    const track = element('div', 'bar-track');
    const fill = element('div', 'bar-fill');
    fill.style.width = `${usage.percentUsed}%`;
    // Colour only warns near the limit; a normal day stays neutral.
    if (usage.percentUsed >= 90) fill.classList.add('danger');
    else if (usage.percentUsed >= 70) fill.classList.add('warn');
    track.append(fill);
    panel.append(track);
  }

  if (usage.exhausted) {
    panel.append(
      element('p', 'settings-note error', 'The provider rate limited this key today. Swap the key or wait for the daily reset.'),
    );
  }

  const days = element('ul', 'day-list');
  for (const day of usage.recentDays) {
    const item = document.createElement('li');
    item.append(element('span', null, day.date), element('span', 'bar-count', String(day.requests)));
    days.append(item);
  }
  panel.append(element('p', 'hint', 'Last 7 days'), days);

  panel.append(element('p', 'hint', usage.note));
  return panel;
}

function render() {
  const note = element('p', 'settings-note', '');
  note.id = 'settings-note';

  const fragment = document.createDocumentFragment();
  fragment.append(
    note,
    renderProvider(cache.settings),
    renderKey(cache.settings),
    renderModel(cache.settings),
    renderUsage(cache.usage),
  );
  bodyEl.replaceChildren(fragment);
}

/** Fetches settings and usage, then draws the screen. */
export async function load() {
  const previousNote = document.getElementById('settings-note')?.textContent;
  const previousClass = document.getElementById('settings-note')?.className;

  try {
    const [settings, usage, models] = await Promise.all([
      api('/api/settings'),
      api('/api/usage').catch(() => null),
      // Never fatal: the picker falls back to what is already selected.
      api('/api/models').catch(() => null),
    ]);
    cache = { settings, usage, models };
    render();
    if (previousNote) {
      const note = document.getElementById('settings-note');
      note.textContent = previousNote;
      note.className = previousClass;
    }
  } catch (error) {
    bodyEl.replaceChildren(element('p', 'settings-note error', error.message));
  }
}
