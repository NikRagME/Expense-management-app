/**
 * History setup (spec §12): read her tracking spreadsheet and match its rows to
 * bank lines. Statements are the source of truth for amounts; the spreadsheet
 * adds her categories, notes and descriptions.
 */
import { daysBetween, parseDate } from './dates';
import { merchantKey } from './merchant';
import { parseAmount } from './money';
import type { Sheet } from './parsers/xlsx';

// ---- Finding tables in a sheet ------------------------------------------------

export const ROLES = ['date', 'amount', 'debit', 'credit', 'direction', 'description', 'category', 'account', 'note'] as const;
export type Role = (typeof ROLES)[number];

export interface SheetTable {
  key: string;
  sheet: string;
  headerRow: number; // 0-based row index of the header
  headers: { col: number; label: string }[];
  rows: { rowNumber: number; cells: Record<number, string> }[]; // rowNumber is 1-based, as in the spreadsheet
  roles: Partial<Record<Role, number>>;
  expensesPositive: boolean;
}

const norm = (s: string) => s.trim().toLowerCase();

function guessRole(label: string): Role | null {
  const h = norm(label);
  if (/^(date|day|when)\b/.test(h)) return 'date';
  if (/^(amount|amt|cost|price|value|\$)/.test(h)) return 'amount';
  if (/debit|money out|withdraw|spent|paid out/.test(h)) return 'debit';
  if (/credit|money in|deposit|received/.test(h)) return 'credit';
  if (/desc|what|item|merchant|payee|details|^name|^for$/.test(h)) return 'description';
  if (/categ|^type$|^tag/.test(h)) return 'category';
  if (/account|bank|card|paid with|source|^from$/.test(h)) return 'account';
  if (/note|memo|comment/.test(h)) return 'note';
  return null;
}

const DIRECTION_RE = /^(payment )?(in|out)$|^(money )?(in|out)$|^income$|^expense$|^payment (in|out)$/i;

export function directionOf(value: string): 'in' | 'out' | null {
  const v = norm(value);
  if (/\bin\b|income|deposit|received/.test(v)) return 'in';
  if (/\bout\b|expense|spent|paid/.test(v)) return 'out';
  return null;
}

/**
 * Find tables: a header row with a date column and an amount-like column, then
 * the rows below it until the data runs out. Side tables (e.g. "Recurring
 * Bills") are dropped when their rows don't contain real dates and amounts.
 */
export function findTables(sheet: Sheet): SheetTable[] {
  const tables: SheetTable[] = [];
  const used = new Set<string>();
  sheet.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (guessRole(cell) !== 'date' || used.has(`${r}:${c}`)) return;
      // Contiguous header cells to the right of the date column.
      const headers: { col: number; label: string }[] = [];
      for (let k = c; k < row.length && row[k]?.trim(); k++) headers.push({ col: k, label: row[k].trim() });
      const roles: Partial<Record<Role, number>> = {};
      for (const h of headers) {
        const role = guessRole(h.label);
        if (role && roles[role] === undefined) roles[role] = h.col;
      }
      if (roles.amount === undefined && (roles.debit === undefined || roles.credit === undefined)) return;
      headers.forEach((h) => used.add(`${r}:${h.col}`));

      const rows: SheetTable['rows'] = [];
      let blanks = 0;
      for (let rr = r + 1; rr < sheet.rows.length && blanks < 3; rr++) {
        const cells: Record<number, string> = {};
        for (const h of headers) cells[h.col] = sheet.rows[rr]?.[h.col]?.trim() ?? '';
        const hasData = parseDate(cells[c] ?? '') && headers.some((h) => h.col !== c && parseAmount(cells[h.col]) != null);
        if (!hasData) {
          blanks++;
          continue;
        }
        blanks = 0;
        rows.push({ rowNumber: rr + 1, cells });
      }
      if (!rows.length) return;

      // A "Category" column holding only PAYMENT IN / PAYMENT OUT is really the direction.
      if (roles.category !== undefined) {
        const values = rows.map((x) => x.cells[roles.category!]).filter(Boolean);
        if (values.length && values.every((v) => DIRECTION_RE.test(v))) {
          roles.direction = roles.category;
          delete roles.category;
        }
      }
      const amounts = roles.amount !== undefined ? rows.map((x) => parseAmount(x.cells[roles.amount!]) ?? 0) : [];
      const positives = amounts.filter((a) => a > 0).length;
      tables.push({
        key: `${sheet.name}#${r + 1}`,
        sheet: sheet.name,
        headerRow: r,
        headers,
        rows,
        roles,
        expensesPositive: amounts.length ? positives >= amounts.length / 2 : true,
      });
    });
  });
  return tables;
}

// ---- Turning rows into history rows --------------------------------------------

export interface HistoryRow {
  sheet: string;
  rowNumber: number;
  date: string;
  /** Signed from the account's point of view: money out negative. */
  amountCents: number;
  description: string;
  categoryLabel: string;
  accountLabel: string;
  note: string;
}

export interface TableSettings {
  roles: Partial<Record<Role, number>>;
  expensesPositive: boolean;
}

export function tableRows(table: SheetTable, settings: TableSettings): { rows: HistoryRow[]; skipped: number } {
  const { roles } = settings;
  const out: HistoryRow[] = [];
  let skipped = 0;
  for (const r of table.rows) {
    const get = (role: Role) => (roles[role] !== undefined ? (r.cells[roles[role]!] ?? '') : '');
    const date = parseDate(get('date'));
    let cents: number | null;
    if (roles.amount !== undefined) {
      const v = parseAmount(get('amount'));
      const dir = roles.direction !== undefined ? directionOf(get('direction')) : null;
      if (v == null) cents = null;
      else if (dir) cents = dir === 'in' ? Math.abs(v) : -Math.abs(v);
      else cents = settings.expensesPositive ? -v : v;
    } else {
      const debit = parseAmount(get('debit'));
      const credit = parseAmount(get('credit'));
      cents = debit == null && credit == null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!date || !cents) {
      skipped++;
      continue;
    }
    out.push({
      sheet: table.sheet,
      rowNumber: r.rowNumber,
      date,
      amountCents: cents,
      description: get('description') || '(no description)',
      categoryLabel: get('category'),
      accountLabel: get('account'),
      note: get('note'),
    });
  }
  return { rows: out, skipped };
}

// ---- Category and account mapping suggestions --------------------------------------

/** 'auto' keeps Pocket's own category; 'parent_pays' = paid by parent / out of budget; 'skip' ignores the row. */
export type CategoryTarget = string;

const SPECIAL: [RegExp, CategoryTarget][] = [
  [/^(oob|out of budget|pp|pop pays|parent pays|paid by (pop|dad|mom|parent))$/i, 'parent_pays'],
  [/^(payment (in|out)|in|out|transfer)$/i, 'auto'],
];

export function suggestCategory(label: string, categories: { id: string; name: string }[], groupNames: string[] = []): CategoryTarget {
  const l = norm(label);
  if (!l) return 'auto';
  for (const [re, t] of SPECIAL) if (re.test(l)) return t;
  // A broad label like "Food" covers several Pocket categories: let Pocket pick per purchase.
  if (groupNames.some((g) => norm(g) === l)) return 'auto';
  const key = l.replace(/[^a-z]/g, '');
  const exact = categories.find((c) => c.name.toLowerCase().replace(/[^a-z]/g, '') === key);
  if (exact) return exact.id;
  // "Clothes/Jewellry" → Clothing, "Miscellanous" → Miscellaneous: shared first 5 letters.
  const first = l.split(/[^a-z]/).find((w) => w.length >= 4);
  const prefix = categories.find((c) => first && c.name.toLowerCase().split(/[^a-z]/).some((w) => w.length >= 4 && w.slice(0, 5) === first.slice(0, 5)));
  return prefix?.id ?? 'auto';
}

export function suggestAccount(label: string, accounts: { id: string; name: string; institution: string; type: string }[]): string | null {
  const l = norm(label);
  if (!l) return null;
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const lw = words(l);
  const isCard = /credit|card|visa/.test(l);
  const isSaving = /saving/.test(l);
  let best: { id: string; score: number } | null = null;
  for (const a of accounts) {
    const aw = words(`${a.name} ${a.institution}`);
    let score = [...lw].filter((w) => aw.has(w) || [...aw].some((x) => x.startsWith(w) || w.startsWith(x))).length;
    if (isCard) score += a.type === 'credit_card' ? 2 : -2;
    if (isSaving) score += a.type === 'savings' ? 2 : -2;
    if (!isCard && !isSaving && (a.type === 'credit_card' || a.type === 'savings')) score -= 1;
    if (score > 0 && (!best || score > best.score)) best = { id: a.id, score };
  }
  return best?.id ?? null;
}

// ---- Matching rows to bank lines ----------------------------------------------------

export interface MatchRow {
  index: number;
  /** Which tab it came from (the same expense written on two tabs is flagged). */
  sheet?: string;
  date: string;
  amountCents: number;
  description: string;
  /** Accounts this row may belong to; empty = any. */
  accountIds: string[];
}

export interface MatchCandidate {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  description: string;
}

export type MatchResult =
  | { index: number; status: 'matched'; transactionId: string; amountDiffers: boolean }
  | { index: number; status: 'added'; accountId: string }
  | { index: number; status: 'unmatched'; reason: 'not_on_statement' | 'ambiguous' | 'no_account' | 'duplicate_row'; duplicateOf?: number };

const DATE_WINDOW = 4;
const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'back', 'trip', 'purchase', 'debit', 'card', 'mobile', 'zelle', 'payment']);
const SYNONYMS: Record<string, string> = { icloud: 'apple', itunes: 'apple', walmart: 'walmart', vzw: 'verizon', vzwrlss: 'verizon', coupa: 'coupa', tj: 'trader' };

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w))
      .map((w) => SYNONYMS[w] ?? w),
  );
}

export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const w of ta) if ([...tb].some((x) => x === w || (w.length >= 4 && (x.startsWith(w) || w.startsWith(x))))) hits++;
  if (!hits && merchantKey(a).length >= 4 && merchantKey(b).includes(merchantKey(a).slice(0, 5))) hits = 1;
  return hits / Math.min(ta.size, tb.size);
}

/** Small differences from rounding when writing it down ($50.00 vs the bank's $50.24). */
const nearAmount = (a: number, b: number) => Math.sign(a) === Math.sign(b) && a !== b && Math.abs(a - b) <= Math.max(100, Math.abs(b) * 0.03);

/**
 * Match spreadsheet rows to bank lines one-to-one (spec §12.4): same amount
 * (or nearly, when the descriptions agree), same account when known, dates
 * within ±4 days. A row only matches when one candidate is clearly best.
 */
export function matchRows(
  rows: MatchRow[],
  candidates: MatchCandidate[],
  covered: (accountId: string, date: string) => boolean,
): MatchResult[] {
  type Pair = { row: MatchRow; tx: MatchCandidate; score: number; exact: boolean };
  const pairsFor = new Map<number, Pair[]>();
  for (const row of rows) {
    const list: Pair[] = [];
    for (const tx of candidates) {
      if (row.accountIds.length && !row.accountIds.includes(tx.accountId)) continue;
      const dd = Math.abs(daysBetween(row.date, tx.date));
      if (dd > DATE_WINDOW) continue;
      const exact = tx.amountCents === row.amountCents;
      const sim = similarity(row.description, tx.description);
      if (!exact && !(nearAmount(row.amountCents, tx.amountCents) && sim > 0)) continue;
      list.push({ row, tx, exact, score: (exact ? 100 : 60) - dd * 6 + sim * 25 });
    }
    pairsFor.set(row.index, list.sort((a, b) => b.score - a.score));
  }

  const taken = new Set<string>();
  const results = new Map<number, MatchResult>();
  // Most confident rows first.
  const order = [...rows].sort((a, b) => (pairsFor.get(b.index)?.[0]?.score ?? -1) - (pairsFor.get(a.index)?.[0]?.score ?? -1));
  for (const row of order) {
    const free = (pairsFor.get(row.index) ?? []).filter((p) => !taken.has(p.tx.id));
    if (free.length && (free.length === 1 || free[0].score - free[1].score >= 5)) {
      taken.add(free[0].tx.id);
      results.set(row.index, { index: row.index, status: 'matched', transactionId: free[0].tx.id, amountDiffers: !free[0].exact });
      continue;
    }
    if (free.length > 1) {
      results.set(row.index, { index: row.index, status: 'unmatched', reason: 'ambiguous' });
      continue;
    }
    // No bank line. Add it when no statement covers that account and date (e.g. cash).
    const accounts = row.accountIds;
    if (accounts.length === 1 && !covered(accounts[0], row.date)) results.set(row.index, { index: row.index, status: 'added', accountId: accounts[0] });
    else if (!accounts.length || (accounts.length > 1 && accounts.every((a) => !covered(a, row.date))))
      results.set(row.index, { index: row.index, status: 'unmatched', reason: 'no_account' });
    else results.set(row.index, { index: row.index, status: 'unmatched', reason: 'not_on_statement' });
  }

  // The same expense written on two tabs: keep the matched one, flag the other.
  const byIndex = new Map(rows.map((r) => [r.index, r]));
  for (const res of results.values()) {
    if (res.status === 'matched') continue;
    const row = byIndex.get(res.index)!;
    const twin = rows.find(
      (o) =>
        o.index !== row.index &&
        o.sheet !== row.sheet &&
        o.amountCents === row.amountCents &&
        Math.abs(daysBetween(o.date, row.date)) <= DATE_WINDOW &&
        (results.get(o.index)?.status === 'matched' || (o.index < row.index && results.get(o.index)?.status === 'added')),
    );
    if (twin) results.set(row.index, { index: row.index, status: 'unmatched', reason: 'duplicate_row', duplicateOf: twin.index });
  }

  return rows.map((r) => results.get(r.index)!);
}
