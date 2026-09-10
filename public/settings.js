/**
 * Settings screen: provider, API key and today's usage.
 *
 * The key is write-only from here. The backend returns a masked form, so this
 * screen can show which key is in use without ever holding the key itself.
 */

const bodyEl = document.getElementById('settings-body');

let cache = { settings: null, usage: null };

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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    ...options,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${response.status}).`);
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

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

  const active = settings.providers.find((provider) => provider.id === settings.activeProvider);
  if (active) {
    panel.append(element('p', 'hint', `Model: ${active.model}`));
  }
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
  fragment.append(note, renderProvider(cache.settings), renderKey(cache.settings), renderUsage(cache.usage));
  bodyEl.replaceChildren(fragment);
}

/** Fetches settings and usage, then draws the screen. */
export async function load() {
  const previousNote = document.getElementById('settings-note')?.textContent;
  const previousClass = document.getElementById('settings-note')?.className;

  try {
    const [settings, usage] = await Promise.all([
      api('/api/settings'),
      api('/api/usage').catch(() => null),
    ]);
    cache = { settings, usage };
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
