/** Recurring costs paid by the parent (spec §4.3, S9). */
import { Hono } from 'hono';
import { z } from 'zod';
import { todayIso } from '../../../shared/dates';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, first, stmt, uuid } from '../lib/db';
import { HttpError, insertTxStatements, type NewTx } from '../lib/pipeline';
import { isoDate, nullableId, parseBody } from '../lib/validate';

export const recurring = new Hono<AppEnv>();

interface ItemRow {
  id: string;
  account_id: string;
  name: string;
  amount_cents: number;
  category_id: string | null;
  frequency: 'weekly' | 'monthly' | 'yearly';
  interval: number;
  next_date: string;
  paused: number;
}

const serialize = (r: ItemRow) => ({
  id: r.id,
  name: r.name,
  amountCents: r.amount_cents,
  categoryId: r.category_id,
  frequency: r.frequency,
  interval: r.interval,
  nextDate: r.next_date,
  paused: !!r.paused,
});

recurring.get('/', async (c) => c.json((await all<ItemRow>(c.env.DB, 'SELECT * FROM recurring_items ORDER BY paused, next_date')).map(serialize)));

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  amountCents: z.number().int().positive(),
  categoryId: nullableId.default(null),
  frequency: z.enum(['weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(12).default(1),
  nextDate: isoDate,
  paused: z.boolean().default(false),
});

recurring.post('/', async (c) => {
  const body = parseBody(schema, await c.req.json());
  const id = uuid();
  const user = c.get('user');
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      `INSERT INTO recurring_items (id, account_id, name, amount_cents, category_id, frequency, interval, next_date, paused, created_by)
       VALUES (?, 'parent_paid', ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      body.name,
      body.amountCents,
      body.categoryId,
      body.frequency,
      body.interval,
      body.nextDate,
      body.paused ? 1 : 0,
      user.id,
    ),
    auditStmt(c.env.DB, user.id, 'recurring', id, 'create', undefined, body),
  ]);
  await generateRecurring(c.env.DB, user.id);
  return c.json({ id }, 201);
});

recurring.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const before = await first<ItemRow>(c.env.DB, 'SELECT * FROM recurring_items WHERE id = ?', id);
  if (!before) throw new HttpError(404, 'Not found');
  const body = parseBody(schema.partial(), await c.req.json());
  const n = { ...serialize(before), ...body };
  const user = c.get('user');
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      'UPDATE recurring_items SET name = ?, amount_cents = ?, category_id = ?, frequency = ?, interval = ?, next_date = ?, paused = ? WHERE id = ?',
      n.name,
      n.amountCents,
      n.categoryId,
      n.frequency,
      n.interval,
      n.nextDate,
      n.paused ? 1 : 0,
      id,
    ),
    auditStmt(c.env.DB, user.id, 'recurring', id, 'update', serialize(before), body),
  ]);
  await generateRecurring(c.env.DB, user.id);
  return c.json({ ok: true });
});

recurring.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  await c.env.DB.batch([
    stmt(c.env.DB, 'UPDATE transactions SET recurring_item_id = NULL WHERE recurring_item_id = ?', id),
    stmt(c.env.DB, 'DELETE FROM recurring_items WHERE id = ?', id),
    auditStmt(c.env.DB, user.id, 'recurring', id, 'delete'),
  ]);
  return c.json({ ok: true });
});

export function advance(date: string, frequency: ItemRow['frequency'], interval: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d + 7 * interval));
    return dt.toISOString().slice(0, 10);
  }
  const months = frequency === 'monthly' ? interval : 12 * interval;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** Create any due entries (catching up if the job missed days). Safe to run repeatedly. */
export async function generateRecurring(db: D1Database, userId: string | null, today = todayIso()): Promise<number> {
  const items = await all<ItemRow>(db, 'SELECT * FROM recurring_items WHERE paused = 0 AND next_date <= ?', today);
  let created = 0;
  for (const item of items) {
    const txs: NewTx[] = [];
    let next = item.next_date;
    while (next <= today && txs.length < 60) {
      txs.push({
        id: uuid(),
        accountId: item.account_id,
        importId: null,
        source: 'recurring',
        externalId: `recurring:${item.id}:${next}`,
        dedupeKey: null,
        date: next,
        amountCents: -item.amount_cents,
        rawDescription: item.name,
        merchantName: item.name,
        description: item.name,
        note: '',
        kind: 'parent_paid',
        categoryId: item.category_id,
        counterparty: null,
        paymentNote: null,
        fundingSource: null,
        needsAttention: item.category_id ? null : 'uncategorized',
        recurringItemId: item.id,
      });
      next = advance(next, item.frequency, item.interval);
    }
    await db.batch([
      ...(await insertTxStatements(db, txs, userId)),
      stmt(db, 'UPDATE recurring_items SET next_date = ? WHERE id = ? AND next_date = ?', next, item.id, item.next_date),
    ]);
    created += txs.length;
  }
  return created;
}
