'use strict';

// Theme resolution, loaded from <head> so it runs before the first paint:
// the page is never painted in the wrong theme and then corrected.
//
// The preference is one of system/light/dark. Only the *resolved* value
// (light or dark) ever reaches the CSS, as data-theme on <html>, so the
// stylesheet needs a single dark block rather than one for the media
// query and another for the manual override.

(() => {
  const ORDER = ['system', 'light', 'dark'];
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const listeners = [];

  // The stored preference arrives synchronously from the main process
  // (see preload.js) — an async read would be too late to beat the paint.
  const stored = window.wave && window.wave.initialTheme;
  let preference = ORDER.includes(stored) ? stored : 'system';

  function resolve() {
    if (preference !== 'system') return preference;
    return media.matches ? 'dark' : 'light';
  }

  function apply() {
    document.documentElement.dataset.theme = resolve();
    for (const fn of listeners) fn(preference, resolve());
  }

  // Following the desktop live is the whole point of the system setting.
  media.addEventListener('change', () => {
    if (preference === 'system') apply();
  });

  window.WFTheme = {
    ORDER,
    get preference() { return preference; },
    get resolved() { return resolve(); },
    set(next) {
      if (!ORDER.includes(next) || next === preference) return;
      preference = next;
      apply();
      // Persisting is fire-and-forget: a failed write costs the user the
      // preference next launch, which is not worth interrupting them for.
      if (window.wave && window.wave.setTheme) {
        window.wave.setTheme(next);
      }
    },
    cycle() {
      this.set(ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length]);
    },
    onChange(fn) { listeners.push(fn); },
  };

  apply();
})();
