// Full screen: the simulation fills the whole screen, the browser's own bars hidden. Browsers only
// allow a page to go full screen in answer to a click or key press, so it happens with your first
// one: opening or making a simulation on the home screen, or the first click on the map after the
// page loads. The setting (View → Go full screen automatically) is remembered in this browser.

export const fullscreenPrefs = { auto: true };
try { const v = localStorage.getItem('autoFullscreen'); if (v !== null) fullscreenPrefs.auto = v === 'true'; } catch { /* no storage */ }

export function saveFullscreenPref() { try { localStorage.setItem('autoFullscreen', String(fullscreenPrefs.auto)); } catch { /* no storage */ } }

export const isFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

/** Go full screen (call from a click or key press). */
export function enterFullscreen() {
  if (isFullscreen()) return;
  const el = document.documentElement;
  try {
    const p = (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' });
    if (p && p.catch) p.catch(() => {}); // (refused: e.g. not from a click, or inside a frame)
  } catch { /* not supported */ }
}

export function exitFullscreen() {
  if (!isFullscreen()) return;
  try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document); } catch { /* not supported */ }
}

export function toggleFullscreen() { if (isFullscreen()) exitFullscreen(); else enterFullscreen(); }

/** With the setting on: go full screen with this click or key press, if not already. */
export function autoFullscreen() { if (fullscreenPrefs.auto) enterFullscreen(); }

/** The first click or key press on the page after it loads goes full screen (with the setting on). */
export function armAutoFullscreen() {
  const go = (e) => {
    if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
    autoFullscreen();
    removeEventListener('pointerdown', go, true);
    removeEventListener('keydown', go, true);
  };
  addEventListener('pointerdown', go, true);
  addEventListener('keydown', go, true);
}
