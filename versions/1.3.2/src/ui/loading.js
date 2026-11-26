// The loading screen: covers the page while a level loads (opening a simulation, making a new one,
// travelling to another cell of the world grid), with what it's doing and how far along it is.
// The page itself shows it straight away when it was reloaded to open a simulation (index.html).

const root = () => document.getElementById('loading');

/** Let the browser draw the screen before the next stretch of work (which blocks it). (A tab in
 * the background draws no frames, so it goes on after a moment regardless.) */
const paint = () => new Promise((r) => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(r, 0); } };
  requestAnimationFrame(go);
  setTimeout(go, 50);
});

/** Show the loading screen (or update it): a title, the step it's on, and progress 0…1. */
export async function showLoading(title, step = '', progress = 0) {
  const L = root();
  if (!L) return;
  L.hidden = false;
  L.classList.remove('ld-out');
  if (title) L.querySelector('.ld-title').textContent = title;
  await loadingStep(step, progress);
}

/** The step it's on now (and how far along, 0…1). */
export async function loadingStep(step, progress) {
  const L = root();
  if (!L || L.hidden) return;
  L.querySelector('.ld-step').textContent = step || '';
  if (progress !== undefined) L.querySelector('.ld-bar i').style.width = `${Math.round(Math.max(0.03, Math.min(1, progress)) * 100)}%`;
  await paint();
}

/** Hide it, once the level has been drawn (a fade). */
export async function hideLoading() {
  const L = root();
  try { sessionStorage.removeItem('loadingName'); } catch { /* no storage */ }
  if (!L || L.hidden) return;
  L.querySelector('.ld-bar i').style.width = '100%';
  await paint(); await paint(); // (two frames: the map is on screen underneath)
  L.classList.add('ld-out');
  setTimeout(() => { if (L.classList.contains('ld-out')) { L.hidden = true; L.classList.remove('ld-out'); } }, 250);
}
