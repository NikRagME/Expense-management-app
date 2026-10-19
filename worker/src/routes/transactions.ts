import { Hono } from 'hono';
import { z } from 'zod';
import { addDays } from '../../../shared/dates';
import { merchantKey } from '../../../shared/merchant';
import { computeTotals, type ReportLine } from '../../../shared/reports';
import { validateSplit } from '../../../shared/splits';
import type { AttentionReason, Kind } from '../../../shared/types';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, first, stmt, uuid, type Bind } from '../lib/db';
import { HttpError, insertTxStatements, rematchTransfers, type NewTx } from '../lib/pipeline';
import { getTx, getTxs, linesFor, TX_SELECT, serializeTx, type TxDto, type TxRow } from '../lib/queries';
import { cents, isoDate, kind, nullableId, parseBody } from '../lib/validate';
import { upsertRuleStatements } from './rules';

export const transactions = new Hono<AppEnv>();

const SPENDY: Kind[] = ['spend', 'refund', 'repayment', 'parent_paid'];

// ---- List -----------------------------------------------------------------

transactions.get('/', async (c) => {
  const q = c.req.query();
  const where: string[] = ['1 = 1'];
  const params: Bind[] = [];
  const add = (sql: string, ...p: Bind[]) => {
    where.push(sql);
    params.push(...p);
  };
  if (q.from) add('t.posted_date >= ?', q.from);
  if (q.to) add('t.posted_date <= ?', q.to);
  if (q.accountId) add('t.account_id = ?', q.accountId);
  if (q.kind) add('t.kind = ?', q.kind);
  if (q.needsAttention === '1') add('t.needs_attention IS NOT NULL');
  if (q.parentPaid === '1') add("a.type = 'parent_paid'");
  if (q.categoryId === 'none') add("t.kind IN ('spend','refund','repayment','parent_paid') AND EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id AND l.category_id IS NULL)");
  else if (q.categoryId) add('EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = t.id AND l.category_id = ?)', q.categoryId);
  if (q.groupId)
    add('EXISTS (SELECT 1 FROM transaction_lines l JOIN categories ca ON ca.id = l.category_id WHERE l.transaction_id = t.id AND ca.group_id = ?)', q.groupId);
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    add(
      "(t.description LIKE ? ESCAPE '\\' OR t.raw_description LIKE ? ESCAPE '\\' OR t.note LIKE ? ESCAPE '\\' OR t.payment_note LIKE ? ESCAPE '\\' OR t.counterparty LIKE ? ESCAPE '\\')",
      like,
      like,
      like,
      like,
      like,
    );
  }
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
  const offset = Math.max(Number(q.offset) || 0, 0);

  const rows = await all<TxRow>(c.env.DB, `${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.posted_date DESC, t.created_at DESC LIMIT ? OFFSET ?`, ...params, limit + 1, offset);
  const page = rows.slice(0, limit);
  const lines = await linesFor(c.env.DB, page.map((r) => r.id));

  // Totals over the whole filter (not just this page).
  const totalRows = await all<ReportLineRow>(
    c.env.DB,
    `SELECT t.id AS transaction_id, t.posted_date AS date, t.kind, t.account_id, a.type AS account_type, l.category_id, l.amount_cents, t.excluded
     FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN transaction_lines l ON l.transaction_id = t.id
     WHERE ${where.join(' AND ')}`,
    ...params,
  );
  const reportLines = totalRows.map(toReportLine).filter((l) => !q.categoryId || q.categoryId === 'none' ? true : l.categoryId === q.categoryId);
  const totals = computeTotals(reportLines, { includeParentPaidInCategories: true });
  const count = new Set(totalRows.map((r) => r.transaction_id)).size;

  return c.json({
    items: page.map((r) => serializeTx(r, lines)),
    hasMore: rows.length > limit,
    count,
    spendingCents: totals.spendingCents,
    parentPaidCents: totals.parentPaidCents,
    moneyInCents: totals.moneyInCents,
  });
});

export interface ReportLineRow {
  transaction_id: string;
  date: string;
  kind: Kind;
  account_id: string;
  account_type: ReportLine['accountType'];
  category_id: string | null;
  amount_cents: number;
  excluded: number;
}

export const toReportLine = (r: ReportLineRow): ReportLine => ({
  transactionId: r.transaction_id,
  date: r.date,
  kind: r.kind,
  accountId: r.account_id,
  accountType: r.account_type,
  categoryId: r.category_id,
  amountCents: r.amount_cents,
  excluded: !!r.excluded,
});

// ---- Detail ---------------------------------------------------------------

async function requireTx(db: D1Database, id: string): Promise<TxDto> {
  const tx = await getTx(db, id);
  if (!tx) throw new HttpError(404, 'Transaction not found');
  return tx;
}

transactions.get('/:id', async (c) => {
  const tx = await requireTx(c.env.DB, c.req.param('id'));
  const linkRows = await all<{ id: string; type: string; from_id: string; to_id: string }>(
    c.env.DB,
    'SELECT id, type, from_id, to_id FROM transaction_links WHERE from_id = ? OR to_id = ?',
    tx.id,
    tx.id,
  );
  const otherIds = linkRows.map((l) => (l.from_id === tx.id ? l.to_id : l.from_id));
  const others = otherIds.length ? await getTxs(c.env.DB, `t.id IN (${otherIds.map(() => '?').join(',')})`, ...otherIds) : [];
  const history = await all<{ action: string; at: string; user_name: string | null; after_json: string | null }>(
    c.env.DB,
    `SELECT a.action, a.at, u.name AS user_name, a.after_json FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.entity = 'transaction' AND a.entity_id = ? ORDER BY a.at DESC, a.rowid DESC LIMIT 20`,
    tx.id,
  );

  // For incoming money (e.g. a friend paying her back): recent spends it might repay.
  let repaymentCandidates: TxDto[] = [];
  if (tx.amountCents > 0 && (tx.kind === 'repayment' || tx.needsAttention === 'venmo_incoming')) {
    repaymentCandidates = await getTxs(
      c.env.DB,
      `t.kind = 'spend' AND t.posted_date BETWEEN ? AND ? AND -t.amount_cents >= ? ORDER BY ABS(julianday(t.posted_date) - julianday(?)) LIMIT 8`,
      addDays(tx.date, -30),
      tx.date,
      tx.amountCents,
      tx.date,
    );
  }

  return c.json({
    ...tx,
    links: linkRows.map((l) => ({ id: l.id, type: l.type, direction: l.from_id === tx.id ? 'out' : 'in', other: others.find((o) => o.id === (l.from_id === tx.id ? l.to_id : l.from_id)) ?? null })),
    history: history.map((h) => ({ action: h.action, at: h.at, userName: h.user_name, details: h.after_json ? JSON.parse(h.after_json) : null })),
    repaymentCandidates,
  });
});

// ---- Manual entry ---------------------------------------------------------

const createSchema = z.object({
  accountId: z.string().min(1),
  date: isoDate,
  amountCents: cents.refine((n) => n !== 0, 'must not be 0'),
  description: z.string().trim().min(1).max(200),
  categoryId: nullableId.default(null),
  kind: kind.optional(),
  note: z.string().max(1000).default(''),
});

transactions.post('/', async (c) => {
  const body = parseBody(createSchema, await c.req.json());
  const account = await first<{ id: string; type: string }>(c.env.DB, 'SELECT id, type FROM accounts WHERE id = ? AND archived_at IS NULL', body.accountId);
  if (!account) throw new HttpError(400, 'Unknown account');
  const k: Kind = account.type === 'parent_paid' ? 'parent_paid' : (body.kind ?? (body.amountCents < 0 ? 'spend' : 'income'));
  const user = c.get('user');
  const tx: NewTx = {
    id: uuid(),
    accountId: account.id,
    importId: null,
    source: 'manual',
    externalId: null,
    dedupeKey: null,
    date: body.date,
    amountCents: body.amountCents,
    rawDescription: body.description,
    merchantName: body.description,
    description: body.description,
    note: body.note,
    kind: k,
    categoryId: body.categoryId,
    counterparty: null,
    paymentNote: null,
    fundingSource: null,
    needsAttention: SPENDY.includes(k) && !body.categoryId ? 'uncategorized' : null,
  };
  await c.env.DB.batch([...(await insertTxStatements(c.env.DB, [tx], user.id)), auditStmt(c.env.DB, user.id, 'transaction', tx.id, 'create', undefined, body)]);
  if (k === 'transfer') await rematchTransfers(c.env.DB, user.id);
  return c.json(await getTx(c.env.DB, tx.id), 201);
});

// ---- Edit -----------------------------------------------------------------

const patchSchema = z.object({
  kind: kind.optional(),
  categoryId: nullableId.optional(),
  note: z.string().max(1000).optional(),
  description: z.string().trim().min(1).max(200).optional(),
  excluded: z.boolean().optional(),
  date: isoDate.optional(),
  amountCents: cents.refine((n) => n !== 0).optional(),
  accountId: z.string().optional(),
  /** "Always put this merchant in this category?" */
  createRule: z.boolean().optional(),
});

function attentionAfterEdit(tx: TxDto, nextKind: Kind, categories: (string | null)[], kindDecided: boolean): AttentionReason | null {
  if (nextKind === 'transfer' || nextKind === 'income') return kindDecided ? null : tx.needsAttention === 'uncategorized' ? null : tx.needsAttention;
  const missing = SPENDY.includes(nextKind) && categories.some((c) => !c);
  let reason = tx.needsAttention;
  if (kindDecided && (reason === 'unknown_inflow' || reason === 'venmo_incoming' || reason === 'transfer_ambiguous' || reason === 'transfer_unmatched')) reason = null;
  if (reason === 'uncategorized' && !missing) reason = null;
  if (!reason && missing) reason = 'uncategorized';
  return reason;
}

transactions.patch('/:id', async (c) => {
  const tx = await requireTx(c.env.DB, c.req.param('id'));
  const body = parseBody(patchSchema, await c.req.json());
  return c.json(await updateTransaction(c.env.DB, c.get('user').id, tx, body));
});

export type TransactionPatch = z.infer<typeof patchSchema>;

/** All edit rules (attention, rules, links, audit, rematch) live here. */
export async function updateTransaction(db: D1Database, userId: string, tx: TxDto, body: TransactionPatch): Promise<TxDto | null> {
  const user = { id: userId };
  const isManual = tx.source === 'manual' || tx.source === 'recurring';
  if (!isManual && (body.date || body.amountCents !== undefined || body.accountId)) {
    throw new HttpError(400, "Date, amount and account come from the bank and can't be edited (use Exclude instead)");
  }
  if (body.amountCents !== undefined && tx.lines.length > 1) throw new HttpError(400, 'Un-split before changing the amount');
  if (body.categoryId !== undefined && tx.lines.length > 1) throw new HttpError(400, 'This transaction is split; edit the split instead');
  if (body.accountId && !(await first(db, 'SELECT id FROM accounts WHERE id = ? AND archived_at IS NULL', body.accountId))) throw new HttpError(400, 'Unknown account');

  const nextKind = body.kind ?? tx.kind;
  const kindChanged = !!body.kind && body.kind !== tx.kind;
  const nextCategory = nextKind === 'transfer' ? null : body.categoryId !== undefined ? body.categoryId : tx.lines[0]?.categoryId ?? null;
  const categories = tx.lines.length > 1 ? tx.lines.map((l) => (nextKind === 'transfer' ? null : l.categoryId)) : [nextCategory];
  // Choosing a kind explicitly (even the same one) answers "what is this?" questions.
  const attention = body.excluded ? null : attentionAfterEdit(tx, nextKind, categories, !!body.kind);

  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `UPDATE transactions SET kind = ?, note = ?, description = ?, excluded = ?, posted_date = ?, amount_cents = ?, account_id = ?,
         needs_attention = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      nextKind,
      body.note ?? tx.note,
      body.description ?? tx.description,
      body.excluded === undefined ? (tx.excluded ? 1 : 0) : body.excluded ? 1 : 0,
      body.date ?? tx.date,
      body.amountCents ?? tx.amountCents,
      body.accountId ?? tx.accountId,
      attention,
      user.id,
      tx.id,
    ),
  ];
  if (tx.lines.length === 1) {
    statements.push(stmt(db, 'UPDATE transaction_lines SET category_id = ?, amount_cents = ? WHERE transaction_id = ?', nextCategory, body.amountCents ?? tx.amountCents, tx.id));
  } else if (nextKind === 'transfer') {
    statements.push(stmt(db, 'UPDATE transaction_lines SET category_id = NULL WHERE transaction_id = ?', tx.id));
  }
  if (kindChanged && tx.kind === 'transfer') statements.push(stmt(db, "DELETE FROM transaction_links WHERE type = 'transfer' AND (from_id = ? OR to_id = ?)", tx.id, tx.id));
  if (kindChanged && tx.kind === 'repayment') statements.push(stmt(db, "DELETE FROM transaction_links WHERE type = 'repayment' AND from_id = ?", tx.id));

  if (body.createRule && nextCategory) {
    const merchant = tx.merchantName ?? tx.description;
    const rule = await upsertRuleStatements(db, user.id, {
      matchType: 'merchant',
      pattern: merchant,
      accountId: null,
      setKind: null,
      setCategoryId: nextCategory,
      priority: 0,
    });
    statements.push(...rule.statements);
    // Apply to other uncategorised transactions from the same merchant.
    statements.push(
      stmt(
        db,
        `UPDATE transaction_lines SET category_id = ? WHERE category_id IS NULL AND transaction_id IN (
           SELECT t.id FROM transactions t JOIN merchants m ON m.id = t.merchant_id
           WHERE m.match_key = ? AND t.id != ? AND t.kind IN ('spend','refund','repayment','parent_paid')
             AND (SELECT COUNT(*) FROM transaction_lines x WHERE x.transaction_id = t.id) = 1)`,
        nextCategory,
        merchantKey(merchant),
        tx.id,
      ),
      stmt(
        db,
        `UPDATE transactions SET needs_attention = NULL WHERE needs_attention = 'uncategorized' AND id IN (
           SELECT t.id FROM transactions t JOIN merchants m ON m.id = t.merchant_id WHERE m.match_key = ?)
           AND NOT EXISTS (SELECT 1 FROM transaction_lines l WHERE l.transaction_id = transactions.id AND l.category_id IS NULL)`,
        merchantKey(merchant),
      ),
    );
  }
  statements.push(auditStmt(db, user.id, 'transaction', tx.id, 'update', pick(tx, Object.keys(body)), body));
  await db.batch(statements);
  if (kindChanged && (nextKind === 'transfer' || tx.kind === 'transfer')) await rematchTransfers(db, user.id);
  return getTx(db, tx.id);
}

function pick(tx: TxDto, keys: string[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in tx) out[k] = (tx as unknown as Record<string, unknown>)[k];
  if (keys.includes('categoryId')) out.categoryId = tx.lines[0]?.categoryId ?? null;
  return out;
}

transactions.delete('/:id', async (c) => {
  const tx = await requireTx(c.env.DB, c.req.param('id'));
  if (tx.source !== 'manual' && tx.source !== 'recurring') throw new HttpError(400, 'Imported transactions can be excluded, not deleted');
  const user = c.get('user');
  await c.env.DB.batch([stmt(c.env.DB, 'DELETE FROM transactions WHERE id = ?', tx.id), auditStmt(c.env.DB, user.id, 'transaction', tx.id, 'delete', tx)]);
  return c.json({ ok: true });
});

// ---- Splits ---------------------------------------------------------------

const splitSchema = z.object({
  parts: z.array(z.object({ amountCents: cents, categoryId: nullableId, note: z.string().max(200).default('') })).min(2).max(20),
});

transactions.put('/:id/splits', async (c) => {
  const db = c.env.DB;
  const tx = await requireTx(db, c.req.param('id'));
  if (tx.kind === 'transfer' || tx.kind === 'income') throw new HttpError(400, "Transfers and income can't be split");
  const { parts } = parseBody(splitSchema, await c.req.json());
  const error = validateSplit(tx.amountCents, parts);
  if (error) throw new HttpError(400, error);
  const user = c.get('user');
  const missing = parts.some((p) => !p.categoryId);
  const attention = tx.needsAttention === 'uncategorized' && !missing ? null : !tx.needsAttention && missing ? 'uncategorized' : tx.needsAttention;
  await db.batch([
    stmt(db, 'DELETE FROM transaction_lines WHERE transaction_id = ?', tx.id),
    ...parts.map((p, i) => stmt(db, 'INSERT INTO transaction_lines (id, transaction_id, amount_cents, category_id, note, sort_order) VALUES (?, ?, ?, ?, ?, ?)', uuid(), tx.id, p.amountCents, p.categoryId, p.note, i)),
    stmt(db, `UPDATE transactions SET needs_attention = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`, attention, user.id, tx.id),
    auditStmt(db, user.id, 'transaction', tx.id, 'split', tx.lines, parts),
  ]);
  return c.json(await getTx(db, tx.id));
});

transactions.delete('/:id/splits', async (c) => {
  const db = c.env.DB;
  const tx = await requireTx(db, c.req.param('id'));
  const user = c.get('user');
  const category = tx.lines[0]?.categoryId ?? null;
  await db.batch([
    stmt(db, 'DELETE FROM transaction_lines WHERE transaction_id = ?', tx.id),
    stmt(db, 'INSERT INTO transaction_lines (id, transaction_id, amount_cents, category_id) VALUES (?, ?, ?, ?)', uuid(), tx.id, tx.amountCents, category),
    auditStmt(db, user.id, 'transaction', tx.id, 'unsplit', tx.lines, { categoryId: category }),
  ]);
  return c.json(await getTx(db, tx.id));
});

// ---- Links, merges, dismissals -------------------------------------------

/** Mark incoming money as paying back a spend; it takes the spend's category. */
export async function linkRepayment(db: D1Database, userId: string, tx: TxDto, spendId: string) {
  const spend = await requireTx(db, spendId);
  if (spend.kind !== 'spend') throw new HttpError(400, 'Can only link to a spend');
  if (tx.amountCents <= 0) throw new HttpError(400, 'Only incoming money can be a repayment');
  const category = spend.lines[0]?.categoryId ?? null;
  await db.batch([
    stmt(db, "DELETE FROM transaction_links WHERE type = 'repayment' AND from_id = ?", tx.id),
    stmt(db, "INSERT INTO transaction_links (id, type, from_id, to_id, created_by) VALUES (?, 'repayment', ?, ?, ?)", uuid(), tx.id, spend.id, userId),
    stmt(db, `UPDATE transactions SET kind = 'repayment', needs_attention = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`, category ? null : 'uncategorized', userId, tx.id),
    stmt(db, 'DELETE FROM transaction_lines WHERE transaction_id = ?', tx.id),
    stmt(db, 'INSERT INTO transaction_lines (id, transaction_id, amount_cents, category_id) VALUES (?, ?, ?, ?)', uuid(), tx.id, tx.amountCents, category),
    auditStmt(db, userId, 'transaction', tx.id, 'repayment_link', undefined, { spendId: spend.id, spend: spend.description }),
  ]);
}

transactions.post('/:id/links', async (c) => {
  const tx = await requireTx(c.env.DB, c.req.param('id'));
  const body = parseBody(z.object({ type: z.literal('repayment'), toId: z.string().min(1) }), await c.req.json());
  await linkRepayment(c.env.DB, c.get('user').id, tx, body.toId);
  return c.json(await getTx(c.env.DB, tx.id));
});

transactions.delete('/:id/links/:linkId', async (c) => {
  const tx = await requireTx(c.env.DB, c.req.param('id'));
  const linkId = c.req.param('linkId');
  const link = await first<{ type: string }>(c.env.DB, 'SELECT type FROM transaction_links WHERE id = ? AND (from_id = ? OR to_id = ?)', linkId, tx.id, tx.id);
  if (!link) throw new HttpError(404, 'Link not found');
  const user = c.get('user');
  await c.env.DB.batch([stmt(c.env.DB, 'DELETE FROM transaction_links WHERE id = ?', linkId), auditStmt(c.env.DB, user.id, 'transaction', tx.id, 'unlink', link)]);
  return c.json({ ok: true });
});

/** Merge an imported line with the manual entry for the same purchase: keep the bank's line, carry over her categories and note. */
export async function mergeManual(db: D1Database, userId: string, imported: TxDto, manualId: string) {
  const manual = await requireTx(db, manualId);
  if (manual.source !== 'manual') throw new HttpError(400, 'Can only merge with a manual entry');
  if (manual.amountCents !== imported.amountCents || manual.accountId !== imported.accountId) throw new HttpError(400, 'Amounts or accounts differ');
  const missing = manual.lines.some((l) => !l.categoryId) && SPENDY.includes(manual.kind);
  await db.batch([
    stmt(db, 'DELETE FROM transaction_lines WHERE transaction_id = ?', imported.id),
    ...manual.lines.map((l, i) =>
      stmt(db, 'INSERT INTO transaction_lines (id, transaction_id, amount_cents, category_id, note, sort_order) VALUES (?, ?, ?, ?, ?, ?)', uuid(), imported.id, l.amountCents, l.categoryId, l.note, i),
    ),
    stmt(
      db,
      `UPDATE transactions SET kind = ?, note = ?, description = ?, needs_attention = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      manual.kind,
      [manual.note, imported.note].filter(Boolean).join(' · '),
      manual.description || imported.description,
      missing ? 'uncategorized' : null,
      userId,
      imported.id,
    ),
    stmt(db, 'DELETE FROM transactions WHERE id = ?', manual.id),
    auditStmt(db, userId, 'transaction', imported.id, 'merge', manual, undefined),
  ]);
}

transactions.post('/:id/merge', async (c) => {
  const tx = await requireTx(c.env.DB, c.req.param('id'));
  const { otherId } = parseBody(z.object({ otherId: z.string().min(1) }), await c.req.json());
  await mergeManual(c.env.DB, c.get('user').id, tx, otherId);
  return c.json(await getTx(c.env.DB, tx.id));
});

export async function dismissAttention(db: D1Database, userId: string, tx: TxDto, reason: AttentionReason) {
  const statements = [auditStmt(db, userId, 'transaction', tx.id, 'dismiss', undefined, { reason })];
  if (reason === 'possible_merge') statements.push(stmt(db, "DELETE FROM transaction_links WHERE type = 'merge_suggestion' AND from_id = ?", tx.id));
  if (reason === 'transfer_unmatched') {
    statements.push(stmt(db, "UPDATE transactions SET dismissed_attention = COALESCE(dismissed_attention || ',', '') || 'transfer_unmatched' WHERE id = ?", tx.id));
  } else {
    const missing = SPENDY.includes(tx.kind) && tx.lines.some((l) => !l.categoryId);
    statements.push(stmt(db, 'UPDATE transactions SET needs_attention = ? WHERE id = ?', missing && reason !== 'uncategorized' ? 'uncategorized' : null, tx.id));
  }
  await db.batch(statements);
}

transactions.post('/:id/dismiss', async (c) => {
  const tx = await requireTx(c.env.DB, c.req.param('id'));
  const { reason } = parseBody(z.object({ reason: z.string() }), await c.req.json());
  await dismissAttention(c.env.DB, c.get('user').id, tx, reason as AttentionReason);
  return c.json({ ok: true });
});

export { requireTx };
