// Warning when the browser won't let the level be saved: some browsers (or a site setting, a
// private window, or a full disk) block this page from storing data, so the autosave silently fails
// and a reload loses the level. When that happens a banner says so over the map, offers to save the
// level to a file instead, and the browser asks before the page is closed or reloaded.

export class SaveWarning {
  constructor(app, parent) {
    this.app = app;
    this.blocked = false;
    const el = (this.el = document.createElement('div'));
    el.className = 'save-warning';
    el.hidden = true;
    this.text = document.createElement('div');
    this.text.className = 'save-warning-text';
    const save = document.createElement('button');
    save.textContent = 'Save level to a file';
    save.addEventListener('click', () => app.saveLevelFile());
    const close = document.createElement('button');
    close.className = 'save-warning-close';
    close.textContent = '✕';
    close.title = 'Hide this warning (the browser will still ask before you leave or reload)';
    close.addEventListener('click', () => { el.hidden = true; this.dismissed = true; });
    el.append(this.text, save, close);
    parent.append(el);
    this.guard = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };
  }

  /** Check whether this page may store data at all (localStorage and IndexedDB). */
  async check() {
    let reason = null;
    try { localStorage.setItem('geo.storageTest', '1'); localStorage.removeItem('geo.storageTest'); } catch (err) { reason = err.message; }
    if (!reason) {
      reason = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve('the browser did not answer'), 4000);
        try {
          const req = indexedDB.open('geology-toolbox', 1);
          req.onupgradeneeded = () => { try { req.result.createObjectStore('levels'); } catch { /* exists */ } };
          req.onsuccess = () => { clearTimeout(timer); req.result.close(); resolve(null); };
          req.onerror = () => { clearTimeout(timer); resolve(req.error ? req.error.message : 'unknown error'); };
        } catch (err) { clearTimeout(timer); resolve(err.message); }
      });
    }
    if (reason) this.show(`This browser is blocking this page from saving, so your level will be lost if you reload or close the page. Allow this site to store data (click the icon at the left of the address bar → Site settings → allow on-device site data / cookies), then reload; or save the level to a file now.`, reason);
    return !reason;
  }

  /** Show the warning and ask before the page is left. */
  show(message, detail) {
    this.blocked = true;
    this.text.textContent = `⚠ ${message}`;
    this.el.title = detail ? `Reason: ${detail}` : '';
    if (!this.dismissed) this.el.hidden = false;
    if (!this.guarding) { addEventListener('beforeunload', this.guard); this.guarding = true; }
  }

  /** An autosave failed (storage blocked or full). */
  saveFailed(err) {
    this.show('Autosave failed, so your level will be lost if you reload or close the page. Save it to a file, or free up space / allow this site to store data and it will autosave again.', err && err.message);
  }

  /** An autosave worked: all is well again. */
  saved() {
    if (!this.blocked) return;
    this.blocked = false;
    this.el.hidden = true;
    if (this.guarding) { removeEventListener('beforeunload', this.guard); this.guarding = false; }
  }
}
