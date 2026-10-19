/**
 * Reporting periods. Every report works on an arbitrary from–to range so the
 * definition of a "month" can change later (spec A7). Today: calendar months.
 */
import { addDays } from './dates';

export interface Period {
  from: string; // inclusive YYYY-MM-DD
  to: string; // inclusive YYYY-MM-DD
  label: string;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function calendarMonth(ym: string): Period {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}`, label: `${MONTHS[m - 1]} ${y}` };
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The period immediately before `p` with the same length in days (used for comparisons). */
export function previousPeriod(p: Period): Period {
  // Calendar months compare to the previous calendar month.
  if (p.from.endsWith('-01') && calendarMonth(p.from.slice(0, 7)).to === p.to) {
    return calendarMonth(shiftMonth(p.from.slice(0, 7), -1));
  }
  const len = (Date.parse(p.to) - Date.parse(p.from)) / 86_400_000;
  const to = addDays(p.from, -1);
  return { from: addDays(to, -len), to, label: 'Previous period' };
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}
