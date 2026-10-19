/**
 * Venmo statement CSV (venmo.com → Statements → Download CSV).
 *
 * A payment funded from a bank doesn't touch the Venmo balance, so we emit two
 * rows for it: a "funding" transfer into Venmo (matched later against the bank's
 * VENMO line) and the actual spend. That keeps the Venmo balance correct.
 *
 * Column names are based on Venmo's published format and will be tuned with a
 * real file (spec A2).
 */
import { parseDate } from '../dates';
import { parseAmount } from '../money';
import type { ParsedRow, ParsedStatement } from '../types';
import { parseCsvText } from './csv';

/** Detect by Venmo's own header columns (bank CSVs often mention "VENMO" in descriptions). */
export function looksLikeVenmo(text: string): boolean {
  const head = text.slice(0, 3000).toLowerCase();
  return head.includes('datetime') && (head.includes('amount (total)') || head.includes('funding source'));
}

export function parseVenmo(text: string): ParsedStatement {
  const all = parseCsvText(text);
  const errors: string[] = [];
  const headerIdx = all.findIndex((r) => r.some((c) => c.trim() === 'ID') && r.some((c) => c.trim() === 'Datetime'));
  if (headerIdx < 0) return { format: 'venmo', rows: [], errors: ["This doesn't look like a Venmo statement (no ID/Datetime header)"] };

  const header = all[headerIdx].map((c) => c.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const c = {
    id: col('ID'),
    datetime: col('Datetime'),
    type: col('Type'),
    status: col('Status'),
    note: col('Note'),
    from: col('From'),
    to: col('To'),
    amount: col('Amount (total)'),
    funding: col('Funding Source'),
    destination: col('Destination'),
    ending: col('Ending Balance'),
  };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const body = all.slice(headerIdx + 1);

  // The account owner is whoever appears most in From/To.
  const counts = new Map<string, number>();
  for (const r of body) for (const n of [get(r, c.from), get(r, c.to)]) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  const owner = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  const rows: ParsedRow[] = [];
  let balance: ParsedStatement['balance'];
  let lastDate = '';

  for (const r of body) {
    const id = get(r, c.id);
    const ending = parseAmount(get(r, c.ending));
    if (!id) {
      // Summary rows carry the beginning/ending balance.
      if (ending != null && lastDate) balance = { asOf: lastDate, cents: ending };
      continue;
    }
    const status = get(r, c.status).toLowerCase();
    if (status && !['complete', 'completed', 'issued'].includes(status)) continue;

    const date = parseDate(get(r, c.datetime));
    const amount = parseAmount(get(r, c.amount));
    if (!date || amount == null || amount === 0) {
      errors.push(`Venmo transaction ${id}: couldn't read date or amount`);
      continue;
    }
    if (date > lastDate) lastDate = date;
    const type = get(r, c.type).toLowerCase();
    const note = get(r, c.note);
    const from = get(r, c.from);
    const to = get(r, c.to);
    const counterparty = amount < 0 ? (to !== owner ? to : from) : from !== owner ? from : to;
    const funding = get(r, c.funding);
    const destination = get(r, c.destination);

    if (type.includes('transfer')) {
      // Cash-out to a bank (or top-up): money moving between her own accounts.
      rows.push({
        date,
        amountCents: amount,
        description: `Venmo ${type.includes('instant') ? 'instant' : 'standard'} transfer${destination ? ` to ${destination}` : ''}`,
        externalId: id,
        kindHint: 'transfer',
        fundingSource: destination || funding,
      });
      continue;
    }

    const fundedExternally = amount < 0 && funding && !/venmo balance/i.test(funding);
    if (fundedExternally) {
      rows.push({
        date,
        amountCents: -amount,
        description: `Funding from ${funding}`,
        externalId: `${id}:funding`,
        kindHint: 'transfer',
        fundingSource: funding,
      });
    }
    rows.push({
      date,
      amountCents: amount,
      description: `${counterparty}${note ? ` — ${note}` : ''}`,
      externalId: id,
      counterparty,
      paymentNote: note,
      fundingSource: funding || undefined,
    });
  }
  return { format: 'venmo', rows, balance, errors };
}
