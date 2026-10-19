/** Dates are plain calendar days as "YYYY-MM-DD" strings (no time zones). */

const pad = (n: number) => String(n).padStart(2, '0');

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type DateFormat = 'auto' | 'MDY' | 'YMD' | 'DMY';

/**
 * Parse common bank date formats into ISO. US banks use M/D/Y, so "auto"
 * treats slash dates as month-first.
 */
export function parseDate(input: string, format: DateFormat = 'auto'): string | null {
  const s = input.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m && (format === 'auto' || format === 'YMD')) return build(+m[1], +m[2], +m[3]);
  // OFX: 20261012 or 20261012120000[-5:EST]
  m = /^(\d{4})(\d{2})(\d{2})(\d{6})?(\.\d+)?(\[.*\])?$/.exec(s);
  if (m) return build(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(\s.*)?$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return format === 'DMY' ? build(year, +m[2], +m[1]) : build(year, +m[1], +m[2]);
  }
  // Venmo ISO datetime "2026-10-12T18:22:01"
  m = /^(\d{4})-(\d{2})-(\d{2})T/.exec(s);
  if (m) return build(+m[1], +m[2], +m[3]);
  return null;
}

function build(y: number, mo: number, d: number): string | null {
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  return isIsoDate(iso) ? iso : null;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
