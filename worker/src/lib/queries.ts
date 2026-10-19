import { balanceAt } from '../../../shared/balance';
import type { AccountType, AttentionReason, Kind, Source } from '../../../shared/types';
import { all, allIn, type Bind } from './db';

export interface TxRow {
  id: string;
  account_id: string;
  account_name: string;
  account_type: AccountType;
  import_id: string | null;
  source: Source;
  posted_date: string;
  amount_cents: number;
  raw_description: string;
  description: string;
  note: string;
  kind: Kind;
  counterparty: string | null;
  payment_note: string | null;
  funding_source: string | null;
  excluded: number;
  needs_attention: AttentionReason | null;
  dismissed_attention: string | null;
  merchant_id: string | null;
  merchant_name: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
  transfer_linked: number;
  user_edited: number;
  history_import_id: string | null;
}

export interface LineRow {
  id: string;
  transaction_id: string;
  amount_cents: number;
  category_id: string | null;
  note: string;
  sort_order: number;
  budget_scope: 'in' | 'outside' | 'unsure' | null;
}

export const TX_SELECT = `
  SELECT t.id, t.account_id, a.name AS account_name, a.type AS account_type, t.import_id, t.source, t.posted_date,
         t.amount_cents, t.raw_description, t.description, t.note, t.kind, t.counterparty, t.payment_note,
         t.funding_source, t.excluded, t.needs_attention, t.dismissed_attention, t.merchant_id, m.name AS merchant_name,
         cu.name AS created_by_name, uu.name AS updated_by_name, t.created_at, t.updated_at, t.user_edited, t.history_import_id,
         EXISTS (SELECT 1 FROM transaction_links l WHERE l.type = 'transfer' AND (l.from_id = t.id OR l.to_id = t.id)) AS transfer_linked
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id
  LEFT JOIN merchants m ON m.id = t.merchant_id
  LEFT JOIN users cu ON cu.id = t.created_by
  LEFT JOIN users uu ON uu.id = t.updated_by`;

export function serializeTx(t: TxRow, lines: LineRow[]) {
  return {
    id: t.id,
    accountId: t.account_id,
    accountName: t.account_name,
    accountType: t.account_type,
    importId: t.import_id,
    source: t.source,
    date: t.posted_date,
    amountCents: t.amount_cents,
    rawDescription: t.raw_description,
    description: t.description,
    merchantName: t.merchant_name,
    note: t.note,
    kind: t.kind,
    counterparty: t.counterparty,
    paymentNote: t.payment_note,
    fundingSource: t.funding_source,
    excluded: !!t.excluded,
    needsAttention: t.needs_attention,
    transferLinked: !!t.transfer_linked,
    userEdited: !!t.user_edited,
    fromSpreadsheet: !!t.history_import_id,
    createdByName: t.created_by_name,
    updatedByName: t.updated_by_name,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    lines: lines
      .filter((l) => l.transaction_id === t.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => ({ id: l.id, amountCents: l.amount_cents, categoryId: l.category_id, note: l.note, budgetScope: l.budget_scope })),
  };
}

export type TxDto = ReturnType<typeof serializeTx>;

export async function linesFor(db: D1Database, txIds: string[]): Promise<LineRow[]> {
  if (!txIds.length) return [];
  return allIn<LineRow>(db, (ph) => `SELECT * FROM transaction_lines WHERE transaction_id IN (${ph})`, txIds);
}

export async function getTx(db: D1Database, id: string): Promise<TxDto | null> {
  const rows = await all<TxRow>(db, `${TX_SELECT} WHERE t.id = ?`, id);
  if (!rows[0]) return null;
  return serializeTx(rows[0], await linesFor(db, [id]));
}

export async function getTxs(db: D1Database, where: string, ...params: Bind[]): Promise<TxDto[]> {
  const rows = await all<TxRow>(db, `${TX_SELECT} WHERE ${where}`, ...params);
  const lines = await linesFor(db, rows.map((r) => r.id));
  return rows.map((r) => serializeTx(r, lines));
}

/** Current balances for every account (roll-forward from the latest known balance). */
export async function accountBalances(db: D1Database) {
  const snaps = await all<{ account_id: string; as_of_date: string; balance_cents: number; difference_cents: number | null; created_at: string }>(
    db,
    'SELECT account_id, as_of_date, balance_cents, difference_cents, created_at FROM balance_snapshots ORDER BY as_of_date, created_at',
  );
  const byAccount = new Map<string, typeof snaps>();
  for (const s of snaps) byAccount.set(s.account_id, [...(byAccount.get(s.account_id) ?? []), s]);

  const result = new Map<string, { balanceCents: number | null; asOf: string | null; balanced: boolean | null; lastDifferenceCents: number | null }>();
  for (const [accountId, list] of byAccount) {
    const latest = list[list.length - 1];
    const moves = await all<{ posted_date: string; amount_cents: number }>(
      db,
      'SELECT posted_date, amount_cents FROM transactions WHERE account_id = ? AND posted_date > ?',
      accountId,
      latest.as_of_date,
    );
    // "As of" = the latest day we know about: the snapshot or the newest transaction after it.
    const asOf = moves.reduce((m, x) => (x.posted_date > m ? x.posted_date : m), latest.as_of_date);
    const balance = balanceAt(
      list.map((s) => ({ asOf: s.as_of_date, cents: s.balance_cents })),
      moves.map((m) => ({ date: m.posted_date, amountCents: m.amount_cents })),
      '9999-12-31',
    );
    result.set(accountId, {
      balanceCents: balance,
      asOf,
      balanced: latest.difference_cents == null ? null : latest.difference_cents === 0,
      lastDifferenceCents: latest.difference_cents,
    });
  }
  return result;
}
