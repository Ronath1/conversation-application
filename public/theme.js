/**
 * Light and dark, chosen by the reader.
 *
 * Three states, not two. "System" is the starting point and follows the
 * device, so someone whose phone switches at dusk gets that for free. Picking
 * light or dark stores an explicit choice that beats the device in both
 * directions — the common failure is a toggle that only works one way, because
 * the stylesheet defines dark inside a media query with nothing to override it.
 *
 * The choice is per browser, kept in localStorage. It is a display preference,
 * not account data: it should apply before sign-in and without a round trip.
 */

const STORAGE_KEY = 'ecp.theme';

const LABEL = {
  system: 'Theme: auto',
  light: 'Theme: light',
  dark: 'Theme: dark',
};

/** A sun, a moon, and a half-filled circle for "follow the device". */
const ICON = {
  system: '◐',
  light: '☀',
  dark: '☾',
};

const TITLE = {
  system: 'Following your device. Click for light.',
  light: 'Light. Click for dark.',
  dark: 'Dark. Click to follow your device again.',
};

/** system is the middle state, so one button can reach all three. */
const NEXT = { system: 'light', light: 'dark', dark: 'system' };

let current = 'system';

function read() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    // A private window can refuse storage outright. Following the device is
    // the right answer then, not a crash.
    return 'system';
  }
}

function write(theme) {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* The theme still applies for this page view. */
  }
}

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

function paintButton(button) {
  if (!button) return;
  button.textContent = ICON[current];
  button.title = TITLE[current];
  button.setAttribute('aria-label', LABEL[current]);
}

/**
 * Reads the stored choice and wires the toggle.
 *
 * @param {HTMLElement|null} button
 */
export function initTheme(button) {
  current = read();
  apply(current);
  paintButton(button);

  button?.addEventListener('click', () => {
    current = NEXT[current];
    apply(current);
    write(current);
    paintButton(button);
  });
}
