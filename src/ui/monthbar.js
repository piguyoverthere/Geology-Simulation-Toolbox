// Month bar: a strip of the 12 months across the top of the view, with a marker at today's date.
// The simulation's year phase starts at the spring equinox (phase 0 ≈ 20 March), so the calendar
// is offset to match. Clicking a month jumps the year to the middle of it.

import { YEAR_KINDS, seasonParams } from '../sim/climate.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SEASON = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const EQUINOX = 78; // day of the year (0-based) of the spring equinox, where phase 0 sits

/** Day of the year (0..364, fractional) for a season phase. */
export function dayOfYear(phase) { return (phase * 365 + EQUINOX) % 365; }

/** { month 0..11, day 1..31, fraction through the year } for a season phase. */
export function dateOf(phase) {
  let d = dayOfYear(phase), m = 0;
  while (m < 11 && d >= DAYS[m]) { d -= DAYS[m]; m++; }
  return { month: m, day: Math.floor(d) + 1, year: dayOfYear(phase) / 365 };
}

export class MonthBar {
  constructor(el, app) {
    this.el = el;
    this.app = app;
    el.className = 'month-bar';
    const track = document.createElement('div');
    track.className = 'mb-track';
    let start = 0;
    MONTHS.forEach((name, m) => {
      const seg = document.createElement('button');
      seg.className = `mb-month mb-${SEASON[m]}`;
      seg.textContent = name;
      seg.style.flex = String(DAYS[m]);
      seg.title = `Jump to mid ${FULL[m]}`;
      const mid = start + DAYS[m] / 2;
      seg.addEventListener('click', () => this.jump(mid));
      track.append(seg);
      start += DAYS[m];
    });
    this.marker = document.createElement('div');
    this.marker.className = 'mb-marker';
    track.append(this.marker);
    this.label = document.createElement('div');
    this.label.className = 'mb-label';
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'mb-toggle';
    this.toggleBtn.textContent = 'Turn on seasons';
    this.toggleBtn.addEventListener('click', () => {
      seasonParams.enabled = true;
      app.climateChanged();
      app.toolbox.refresh();
    });
    el.append(this.label, track, this.toggleBtn);
    this.track = track;
    this.update();
  }

  /** Move the year to day-of-year `day` (and update everything that depends on the date). */
  jump(day) {
    if (!seasonParams.enabled) { seasonParams.enabled = true; this.app.toolbox.refresh(); }
    seasonParams.phase = (((day - EQUINOX) / 365) % 1 + 1) % 1;
    this.app.climateChanged();
    this.update();
  }

  update() {
    const on = seasonParams.enabled;
    this.el.classList.toggle('off', !on);
    this.toggleBtn.hidden = on;
    const { month, day, year } = dateOf(seasonParams.phase);
    this.marker.style.left = `${year * 100}%`;
    const part = day <= 10 ? 'Early' : day <= 20 ? 'Mid' : 'Late';
    const yk = YEAR_KINDS[seasonParams.yearKind] || YEAR_KINDS.normal;
    this.label.innerHTML = on
      ? `<b>${part} ${FULL[month]}</b> <span>${SEASON[month]} · year ${seasonParams.year || 1}</span>${yk.short ? ` <span class="mb-year mb-${seasonParams.yearKind}">${yk.short}</span>` : ''}`
      : '<b>Seasons off</b>';
  }
}
