// The app's version, shown on the home screen. Every release is also kept as it was in
// versions/<version>/ (listed in versions/versions.json), so an older one can be run from the home
// screen's menu if an update breaks something. Experimental prereleases (versions like
// 1.2.0-beta.1, marked "prerelease" in the list) are offered on the home screen to try out, with a
// warning that they may be unstable. Make a release with
//   python3 tools/release.py <version> "<what changed>" [--pre]
// after setting APP_VERSION (and IS_PRERELEASE) here.
//
// Saves record the version that made them (meta.appVersion). A newer version's save can be opened in
// an older version, after a warning that the older one may lose or break what the newer one added.
export const APP_VERSION = '1.4.0';
export const IS_PRERELEASE = false;

/** The top of the site, relative to this page: an archived version runs from versions/<version>/. */
export const SITE_ROOT = /\/versions\/[^/]+\/(index\.html)?$/.test(location.pathname) ? '../../' : './';

/** Compare versions like 1.2.0 and 1.2.0-beta.1: negative if a is older, positive if newer. */
export function compareVersions(a, b) {
  const parse = (v) => { const [main, pre] = String(v).split('-'); return { n: main.split('.').map((x) => +x || 0), pre }; };
  const A = parse(a), B = parse(b);
  for (let k = 0; k < 3; k++) if ((A.n[k] || 0) !== (B.n[k] || 0)) return (A.n[k] || 0) - (B.n[k] || 0);
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;   // (1.2.0 is newer than 1.2.0-beta.1)
  if (!B.pre) return -1;
  const pa = A.pre.split('.'), pb = B.pre.split('.');
  for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
    if (pa[k] === pb[k]) continue;
    if (pa[k] === undefined) return -1;
    if (pb[k] === undefined) return 1;
    const x = +pa[k], y = +pb[k];
    if (!isNaN(x) && !isNaN(y)) return x - y;
    return pa[k] < pb[k] ? -1 : 1;
  }
  return 0;
}

/** Whether a save made by `saved` is too new for this version to open. */
export function tooNew(saved) { return !!saved && compareVersions(saved, APP_VERSION) > 0; }
