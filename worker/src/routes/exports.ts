/** Data export (spec S10): the data is never locked in. */
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { all } from '../lib/db';

export const exportsRoute = new Hono<AppEnv>();

const TABLES = [
  'users',
  'settings',
  'accounts',
  'category_groups',
  'categories',
  'merchants',
  'imports',
  'recurring_items',
  'transactions',
  'transaction_lines',
  'transaction_links',
  'balance_snapshots',
  'rules',
  'audit_log',
] as const;

/** Every table as JSON (sessions excluded). Used by the nightly backup too. */
export async function fullBackup(db: D1Database) {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await all(db, `SELECT * FROM ${t}`);
  return { version: 1, exportedAt: new Date().toISOString(), tables: data };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

exportsRoute.get('/transactions.csv', async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT t.posted_date AS date, a.name AS account, t.description, t.raw_description AS bank_description,
            t.kind, cat.name AS category, l.amount_cents, t.amount_cents AS transaction_amount_cents,
            (SELECT COUNT(*) FROM transaction_lines x WHERE x.transaction_id = t.id) > 1 AS is_split,
            t.note, t.counterparty, t.payment_note, t.excluded, t.source, t.id AS transaction_id
     FROM transactions t JOIN accounts a ON a.id = t.account_id
     JOIN transaction_lines l ON l.transaction_id = t.id LEFT JOIN categories cat ON cat.id = l.category_id
     ORDER BY t.posted_date, t.created_at, l.sort_order`,
  );
  const header = ['date', 'account', 'description', 'bank_description', 'kind', 'category', 'amount', 'transaction_amount', 'is_split', 'note', 'counterparty', 'payment_note', 'excluded', 'source', 'transaction_id'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.account,
        r.description,
        r.bank_description,
        r.kind,
        r.category,
        ((r.amount_cents as number) / 100).toFixed(2),
        ((r.transaction_amount_cents as number) / 100).toFixed(2),
        r.is_split ? 'yes' : '',
        r.note,
        r.counterparty,
        r.payment_note,
        r.excluded ? 'yes' : '',
        r.source,
        r.transaction_id,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return c.body(lines.join('\n') + '\n', 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

exportsRoute.get('/backup.json', async (c) => {
  return c.body(JSON.stringify(await fullBackup(c.env.DB)), 200, {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="expense-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  });
});
