/**
 * Citibank PDF statements (checking + savings combined).
 *
 * Input is the positioned text pdf.js extracts from each page. One PDF
 * produces one statement per section (Regular Checking, Citi Savings), each
 * with the bank's own beginning and ending balances.
 *
 * Amount columns are told apart by where the number sits on the line,
 * relative to the "Amount Subtracted / Amount Added / Balance" headers.
 */
import { addDays } from '../dates';
import { parseAmount } from '../money';
import type { ParsedRow, ParsedStatement } from '../types';

export interface PdfTextItem {
  str: string;
  x: number;
  y: number;
}

export type PdfPage = PdfTextItem[];

interface Line {
  y: number;
  items: PdfTextItem[];
  text: string;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const AMOUNT_RE = /^-?\$?[\d,]+\.\d{2}$/;
const DATE_RE = /^(\d{2})\/(\d{2})$/;

/** Merchant-category lines Citi prints under card purchases, mapped to Pocket categories. */
const MCC_HINTS: [RegExp, string | null][] = [
  [/^restaurant\/bar$|^fast food/i, 'eating_out'],
  [/^grocery|supermarket/i, 'groceries'],
  [/^phones, cable & utilities$/i, 'phone_internet'],
  [/^misc transportation$|^transportation/i, null],
  [/^specialty retail stores$|^misc business services$|^department stores|^clothing/i, null],
];

export function looksLikeCitiPdf(pages: PdfPage[]): boolean {
  const first = (pages[0] ?? []).map((i) => i.str).join(' ');
  return /citibank/i.test(first) && /statement period/i.test(pages.flat().map((i) => i.str).join(' '));
}

function toLines(page: PdfPage): Line[] {
  const byY = new Map<number, PdfTextItem[]>();
  for (const it of page) {
    if (!it.str.trim()) continue;
    const y = Math.round(it.y);
    // Merge items within 1pt vertically into the same line.
    const key = byY.has(y) ? y : byY.has(y - 1) ? y - 1 : byY.has(y + 1) ? y + 1 : y;
    byY.set(key, [...(byY.get(key) ?? []), it]);
  }
  return [...byY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, items]) => {
      const sorted = items.sort((a, b) => a.x - b.x);
      return { y, items: sorted, text: sorted.map((i) => i.str.trim()).join(' ') };
    });
}

function statementPeriod(text: string): { start: { y: number; m: number; d: number }; end: { y: number; m: number; d: number } } | null {
  const m = /([A-Z][a-z]{2})[a-z]*\.? (\d{1,2})(?:, (\d{4}))? - ([A-Z][a-z]{2})[a-z]*\.? (\d{1,2}), (\d{4})/.exec(text);
  if (!m) return null;
  const endY = Number(m[6]);
  const sm = MONTHS[m[1].toLowerCase()];
  const em = MONTHS[m[4].toLowerCase()];
  const startY = m[3] ? Number(m[3]) : sm > em ? endY - 1 : endY;
  return { start: { y: startY, m: sm, d: Number(m[2]) }, end: { y: endY, m: em, d: Number(m[5]) } };
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

interface Section {
  kind: 'checking' | 'savings';
  label: string;
  last4: string | null;
  beginning: number | null;
  ending: number | null;
  rows: ParsedRow[];
}

interface RawTx {
  date: string;
  first: string;
  more: string[];
  subtracted: number | null;
  added: number | null;
}

export function parseCitiPdf(pages: PdfPage[]): ParsedStatement[] {
  const allText = pages.map((p) => toLines(p).map((l) => l.text).join('\n')).join('\n');
  const period = statementPeriod(allText);
  if (!period) return [{ format: 'pdf', rows: [], errors: ["Couldn't find the statement period"] }];
  const yearFor = (month: number) => (period.start.y !== period.end.y && month >= period.start.m ? period.start.y : period.end.y);

  const sections: Section[] = [];
  let section: Section | null = null;
  let cols: { added: number; balance: number } | null = null;
  let current: RawTx | null = null;
  const errors: string[] = [];

  const flush = () => {
    if (current && section) {
      const row = buildRow(current);
      if (row) section.rows.push(row);
      else errors.push(`Couldn't read the transaction on ${current.date}: ${current.first}`);
    }
    current = null;
  };

  for (const page of pages) {
    flush();
    for (const line of toLines(page)) {
      const t = line.text;
      if (/^CHECKING ACTIVITY/.test(t) || /^SAVINGS ACTIVITY/.test(t)) {
        flush();
        const kind = t.startsWith('CHECKING') ? 'checking' : 'savings';
        if (/Continued/i.test(t) && (section as Section | null)?.kind === kind) continue;
        section = { kind, label: kind === 'checking' ? 'Checking' : 'Savings', last4: null, beginning: null, ending: null, rows: [] };
        sections.push(section);
        continue;
      }
      if (!section) continue;
      if (/^(Regular Checking|Citi® Savings|Citi Savings|.*Checking$|.*Savings$)/.test(t) && !section.rows.length && !/ACTIVITY/.test(t)) {
        if (!DATE_RE.test(line.items[0]?.str ?? '')) section.label = t.replace(/\s+/g, ' ');
      }
      const acct = /^(\d{8,})$/.exec(line.items[0]?.str.trim() ?? '');
      if (acct) section.last4 = acct[1].slice(-4);
      const beg = /Beginning Balance:\s*\$?(-?[\d,]+\.\d{2})/.exec(t);
      if (beg) section.beginning = parseAmount(beg[1]);
      const end = /Ending Balance:\s*\$?(-?[\d,]+\.\d{2})/.exec(t);
      if (end) section.ending = parseAmount(end[1]);
      if (/Amount Subtracted/.test(t) && /Amount Added/.test(t)) {
        flush();
        const added = line.items.find((i) => /Amount Added/.test(i.str));
        const balance = line.items.find((i) => /^Balance$/.test(i.str.trim()));
        cols = { added: added?.x ?? 419, balance: balance?.x ?? 526 };
        continue;
      }
      if (/^Total Subtracted\/Added/.test(t) || /^All transaction times/.test(t)) {
        flush();
        continue;
      }
      if (!cols) continue;

      const dm = DATE_RE.exec(line.items[0]?.str.trim() ?? '');
      if (dm) {
        flush();
        const month = Number(dm[1]);
        const day = Number(dm[2]);
        const words: string[] = [];
        let subtracted: number | null = null;
        let added: number | null = null;
        for (const it of line.items.slice(1)) {
          const s = it.str.trim();
          if (AMOUNT_RE.test(s) && it.x >= cols.added - 120) {
            const v = parseAmount(s);
            if (it.x >= cols.balance - 10) continue; // running balance column
            if (it.x >= cols.added) added = v;
            else subtracted = v;
          } else words.push(s);
        }
        current = { date: iso(yearFor(month), month, day), first: words.join(' '), more: [], subtracted, added };
      } else if (current && line.items[0] && line.items[0].x > 60 && !/Page \d+ of/.test(t)) {
        current.more.push(t);
      }
    }
  }
  flush();

  if (!sections.length) return [{ format: 'pdf', rows: [], errors: ['No checking or savings activity found'] }];
  const opening = addDays(iso(period.start.y, period.start.m, period.start.d), -1);
  const closing = iso(period.end.y, period.end.m, period.end.d);
  return sections.map((s) => ({
    format: 'pdf' as const,
    rows: s.rows,
    openingBalance: s.beginning != null ? { asOf: opening, cents: s.beginning } : undefined,
    balance: s.ending != null ? { asOf: closing, cents: s.ending } : undefined,
    section: { kind: s.kind, label: `Citi ${s.label.replace(/^Citi®?\s*/i, '')}`, last4: s.last4 },
    errors: errors.filter(() => s === sections[0]),
  }));
}

/** Turn Citi's multi-line entry into a clean row. */
function buildRow(tx: RawTx): ParsedRow | null {
  const cents = tx.added != null ? tx.added : tx.subtracted != null ? -tx.subtracted : null;
  if (cents == null || cents === 0) return null;
  const first = tx.first.replace(/\s+/g, ' ').trim();
  const more = tx.more.filter((l) => !/^ONLINE\b/.test(l));
  let description = first;
  let counterparty: string | undefined;
  let categoryHint: string | undefined;

  const zelle = /^Zelle (Credit|Debit).*NAME:\s*(.+)$/i.exec(first);
  const card = /^(Mobile Purchase Returns|Debit Card Return|Debit Card Purchase|Mobile Purchase(?: Sign Based| PIN Based)?|Debit PIN Purchase|POS Purchase)\b(.*)$/i.exec(first);
  if (zelle) {
    counterparty = titleName(zelle[2]);
    description = `Zelle ${zelle[1].toLowerCase() === 'credit' ? 'from' : 'to'} ${zelle[2].trim()}`;
  } else if (card) {
    const isReturn = /return/i.test(card[1]);
    // "Debit PIN Purchase WAL-MART #2280 …" has the merchant on the first line; others on the next.
    const rest = card[2].replace(/\b\d{2}\/\d{2}\b|\b\d{1,2}:\d{2}[ap]\b|#\d{4}\b/gi, '').trim();
    const merchant = rest || more[0] || first;
    description = `${isReturn ? 'Return: ' : ''}${merchant}`;
    const mccLine = more.find((l, i) => (rest ? i >= 0 : i >= 1) && !/\d{3,}/.test(l));
    if (mccLine) categoryHint = MCC_HINTS.find(([re]) => re.test(mccLine))?.[1] ?? undefined;
  } else if (/^ACH Electronic (Debit|Credit)\s+/i.test(first)) {
    description = `ACH ${first.replace(/^ACH Electronic (Debit|Credit)\s+/i, '').replace(/\s+[A-Z0-9]{8,}$/, '')}`;
  } else if (/^Transfer (From|to) /i.test(first)) {
    description = first.replace(/\s+\d{2}\/\d{2}\b/, '').replace(/\s+\d{1,2}:\d{2}[ap]\b.*$/i, '').trim();
  } else if (/^Interest paid/i.test(first)) {
    description = 'Interest paid';
  }

  return {
    date: tx.date,
    amountCents: cents,
    description: description.replace(/\s+/g, ' ').trim(),
    ...(counterparty ? { counterparty } : {}),
    ...(categoryHint ? { categoryHint } : {}),
  };
}

function titleName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
