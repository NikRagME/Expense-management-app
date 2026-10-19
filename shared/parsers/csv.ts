/** Generic CSV → rows, driven by a per-account column mapping (spec §4.1). */
import { parseDate } from '../dates';
import { parseAmount } from '../money';
import type { CsvMapping, ParsedRow, ParsedStatement } from '../types';

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const has = (h: string, ...words: string[]) => words.some((w) => h.includes(w));

/** Guess a mapping from the header row. The user confirms it on first import. */
export function guessMapping(rows: string[][]): CsvMapping {
  // Find the header: the first row that contains something date-like and something amount-like.
  let skipRows = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = rows[i].map((c) => c.toLowerCase());
    if (h.some((c) => has(c, 'date')) && h.some((c) => has(c, 'amount', 'debit', 'credit', 'withdrawal', 'deposit'))) {
      skipRows = i;
      break;
    }
  }
  const header = (rows[skipRows] ?? []).map((c) => c.trim().toLowerCase());
  const find = (pred: (h: string) => boolean) => {
    const i = header.findIndex(pred);
    return i >= 0 ? i : undefined;
  };
  const dateCol = find((h) => h === 'date' || h === 'posted date' || h === 'post date' || h === 'transaction date') ?? find((h) => has(h, 'date')) ?? 0;
  const descriptionCol = find((h) => has(h, 'description', 'payee', 'memo', 'merchant', 'name', 'details')) ?? 1;
  const amountCol = find((h) => h === 'amount' || has(h, 'amount'));
  const debitCol = find((h) => has(h, 'debit', 'withdrawal'));
  const creditCol = find((h) => has(h, 'credit', 'deposit'));
  const balanceCol = find((h) => has(h, 'balance'));
  const useSplit = amountCol === undefined && debitCol !== undefined && creditCol !== undefined;
  return {
    skipRows,
    hasHeader: header.length > 0,
    dateCol,
    descriptionCol,
    amountCol: useSplit ? undefined : (amountCol ?? 2),
    debitCol: useSplit ? debitCol : undefined,
    creditCol: useSplit ? creditCol : undefined,
    sign: 'normal',
    balanceCol,
    dateFormat: 'auto',
  };
}

export function parseCsv(text: string, mapping: CsvMapping): ParsedStatement {
  const all = parseCsvText(text);
  const body = all.slice(mapping.skipRows + (mapping.hasHeader ? 1 : 0));
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  let balance: ParsedStatement['balance'];

  body.forEach((r, i) => {
    const line = i + mapping.skipRows + (mapping.hasHeader ? 2 : 1);
    const date = parseDate(r[mapping.dateCol] ?? '', mapping.dateFormat);
    const description = (r[mapping.descriptionCol] ?? '').trim();
    let amount: number | null;
    if (mapping.amountCol !== undefined) {
      amount = parseAmount(r[mapping.amountCol]);
    } else {
      const debit = parseAmount(r[mapping.debitCol ?? -1]);
      const credit = parseAmount(r[mapping.creditCol ?? -1]);
      amount = debit == null && credit == null ? null : (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!date || amount == null) {
      // Totals/footer lines are common; only report rows that look like data.
      if (r.filter((c) => c.trim()).length >= 3) errors.push(`Line ${line}: couldn't read date or amount`);
      return;
    }
    if (mapping.sign === 'inverted') amount = -amount;
    if (amount === 0) return;
    rows.push({ date, amountCents: amount, description });
    if (mapping.balanceCol !== undefined) {
      const b = parseAmount(r[mapping.balanceCol]);
      if (b != null && (!balance || date >= balance.asOf)) balance = { asOf: date, cents: b };
    }
  });

  return { format: 'csv', rows, balance, errors };
}
