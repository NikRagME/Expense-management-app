/**
 * Money is always integer cents. Amounts on transactions are signed from the
 * account's point of view: money out is negative, money in is positive.
 */

/** Parse a human/bank amount string into cents. Returns null if it isn't a number. */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  // (12.34) accounting negatives
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // Leading/trailing signs, possibly separated by spaces or a currency symbol: "- $18.00", "$-18", "18.00-"
  s = s.replace(/\s+/g, '');
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/^\+/, '');
  if (/^-/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/^\$/, '');
  if (/^-/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/^\+/, '').replace(/,/g, '');
  if (!/^\d*(\.\d+)?$/.test(s) || s === '' || s === '.') return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) + (frac.length > 2 && Number(frac[2]) >= 5 ? 1 : 0);
  return negative ? -cents : cents;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** Format cents as "$1,234.56". */
export function formatCents(cents: number, opts: { whole?: boolean; sign?: boolean } = {}): string {
  const text = (opts.whole ? usdWhole : usd).format(Math.abs(cents) / 100);
  if (cents < 0) return `-${text}`;
  return opts.sign && cents > 0 ? `+${text}` : text;
}

export function sumCents(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
