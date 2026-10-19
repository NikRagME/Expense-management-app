import { Hono } from 'hono';
import { z } from 'zod';
import { checkBalance } from '../../../shared/balance';
import { addDays, todayIso } from '../../../shared/dates';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, first, parseJson, stmt, uuid } from '../lib/db';
import { HttpError } from '../lib/pipeline';
import { accountBalances } from '../lib/queries';
import { accountType, cents, csvMapping, isoDate, parseBody } from '../lib/validate';

interface AccountRow {
  id: string;
  name: string;
  institution: string;
  type: z.infer<typeof accountType>;
  import_mapping: string | null;
  sort_order: number;
  archived_at: string | null;
  opened_on: string | null;
}

export const accounts = new Hono<AppEnv>();

accounts.get('/', async (c) => {
  const rows = await all<AccountRow & { last_import_at: string | null; through: string | null; tx_count: number }>(
    c.env.DB,
    `SELECT a.*,
            (SELECT MAX(created_at) FROM imports i WHERE i.account_id = a.id AND i.undone_at IS NULL) AS last_import_at,
            (SELECT MAX(posted_date) FROM transactions t WHERE t.account_id = a.id) AS through,
            (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id) AS tx_count
     FROM accounts a ORDER BY a.archived_at IS NOT NULL, a.sort_order, a.created_at`,
  );
  const balances = await accountBalances(c.env.DB);
  return c.json(
    rows.map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.institution,
      type: a.type,
      importMapping: parseJson(a.import_mapping, null),
      archived: !!a.archived_at,
      openedOn: a.opened_on,
      lastImportAt: a.last_import_at,
      transactionsThrough: a.through,
      transactionCount: a.tx_count,
      ...(balances.get(a.id) ?? { balanceCents: null, asOf: null, balanced: null, lastDifferenceCents: null }),
    })),
  );
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  institution: z.string().trim().max(60).default(''),
  type: accountType.refine((t) => t !== 'parent_paid', 'only one Paid by parent account exists'),
  startingBalance: z.object({ cents, asOf: isoDate }).optional(),
});

accounts.post('/', async (c) => {
  const body = parseBody(createSchema, await c.req.json());
  const user = c.get('user');
  const id = uuid();
  const max = await first<{ m: number }>(c.env.DB, "SELECT COALESCE(MAX(sort_order), 0) AS m FROM accounts WHERE type != 'parent_paid'");
  const statements = [
    stmt(c.env.DB, 'INSERT INTO accounts (id, name, institution, type, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?)', id, body.name, body.institution, body.type, (max?.m ?? 0) + 1, user.id),
    auditStmt(c.env.DB, user.id, 'account', id, 'create', undefined, body),
  ];
  if (body.startingBalance) {
    statements.push(
      stmt(
        c.env.DB,
        `INSERT INTO balance_snapshots (id, account_id, as_of_date, balance_cents, source, created_by) VALUES (?, ?, ?, ?, 'manual', ?)`,
        uuid(),
        id,
        body.startingBalance.asOf,
        body.startingBalance.cents,
        user.id,
      ),
    );
  }
  await c.env.DB.batch(statements);
  return c.json({ id }, 201);
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  institution: z.string().trim().max(60).optional(),
  type: accountType.optional(),
  archived: z.boolean().optional(),
  importMapping: csvMapping.nullable().optional(),
});

accounts.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = parseBody(patchSchema, await c.req.json());
  const before = await first<AccountRow>(c.env.DB, 'SELECT * FROM accounts WHERE id = ?', id);
  if (!before) throw new HttpError(404, 'Account not found');
  if (before.type === 'parent_paid' && (body.type || body.archived)) throw new HttpError(400, "Paid by parent can't be changed");
  if (body.type === 'parent_paid' && before.type !== 'parent_paid') throw new HttpError(400, 'Only one Paid by parent account exists');
  const user = c.get('user');
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      `UPDATE accounts SET name = ?, institution = ?, type = ?, archived_at = ?, import_mapping = ? WHERE id = ?`,
      body.name ?? before.name,
      body.institution ?? before.institution,
      body.type ?? before.type,
      body.archived === undefined ? before.archived_at : body.archived ? new Date().toISOString() : null,
      body.importMapping === undefined ? before.import_mapping : body.importMapping && JSON.stringify(body.importMapping),
      id,
    ),
    auditStmt(c.env.DB, user.id, 'account', id, 'update', before, body),
  ]);
  return c.json({ ok: true });
});

/**
 * Opening day (spec §12.3 step 1): the day the account was opened and its balance then
 * (usually $0). Stored as a known balance at the end of the previous day.
 */
accounts.put('/:id/opening', async (c) => {
  const id = c.req.param('id');
  const body = parseBody(z.object({ openedOn: isoDate, cents: cents.default(0) }), await c.req.json());
  const account = await first<AccountRow>(c.env.DB, 'SELECT * FROM accounts WHERE id = ?', id);
  if (!account) throw new HttpError(404, 'Account not found');
  if (account.type === 'parent_paid') throw new HttpError(400, 'Paid by parent has no opening balance');
  const user = c.get('user');
  const asOf = addDays(body.openedOn, -1);
  await c.env.DB.batch([
    stmt(c.env.DB, 'UPDATE accounts SET opened_on = ? WHERE id = ?', body.openedOn, id),
    // Replace an opening balance typed earlier; statement balances are kept.
    stmt(c.env.DB, "DELETE FROM balance_snapshots WHERE account_id = ? AND source = 'manual' AND as_of_date = ?", id, account.opened_on ? addDays(account.opened_on, -1) : asOf),
    stmt(
      c.env.DB,
      `INSERT INTO balance_snapshots (id, account_id, as_of_date, balance_cents, source, created_by) VALUES (?, ?, ?, ?, 'manual', ?)`,
      uuid(),
      id,
      asOf,
      body.cents,
      user.id,
    ),
    auditStmt(c.env.DB, user.id, 'account', id, 'opening', { openedOn: account.opened_on }, body),
  ]);
  return c.json({ ok: true });
});

/** "Update balance": she types the bank's figure; we run the balance check (spec §4.5). */
accounts.post('/:id/balance', async (c) => {
  const id = c.req.param('id');
  const body = parseBody(z.object({ cents, asOf: isoDate.optional() }), await c.req.json());
  const account = await first<AccountRow>(c.env.DB, 'SELECT * FROM accounts WHERE id = ?', id);
  if (!account) throw new HttpError(404, 'Account not found');
  if (account.type === 'parent_paid') throw new HttpError(400, 'Paid by parent has no balance');
  const asOf = body.asOf ?? todayIso();

  const snaps = await all<{ as_of_date: string; balance_cents: number }>(
    c.env.DB,
    'SELECT as_of_date, balance_cents FROM balance_snapshots WHERE account_id = ? AND as_of_date <= ?',
    id,
    asOf,
  );
  const moves = await all<{ posted_date: string; amount_cents: number }>(
    c.env.DB,
    'SELECT posted_date, amount_cents FROM transactions WHERE account_id = ? AND posted_date <= ?',
    id,
    asOf,
  );
  const check = checkBalance(
    snaps.map((s) => ({ asOf: s.as_of_date, cents: s.balance_cents })),
    moves.map((m) => ({ date: m.posted_date, amountCents: m.amount_cents })),
    { asOf, cents: body.cents },
  );
  const user = c.get('user');
  const snapshotId = uuid();
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      `INSERT INTO balance_snapshots (id, account_id, as_of_date, balance_cents, source, computed_cents, difference_cents, created_by)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, ?)`,
      snapshotId,
      id,
      asOf,
      body.cents,
      check?.computedCents ?? null,
      check?.differenceCents ?? null,
      user.id,
    ),
    auditStmt(c.env.DB, user.id, 'account', id, 'balance', undefined, { asOf, cents: body.cents, ...check }),
  ]);
  return c.json({ asOf, cents: body.cents, computedCents: check?.computedCents ?? null, differenceCents: check?.differenceCents ?? null });
});
