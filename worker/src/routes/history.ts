/**
 * Spreadsheet history import (spec §12.3 step 3 and §12.4): match her tracking
 * sheet's rows to bank lines, copy her categories/notes/descriptions across,
 * add rows with no bank line, and send the rest to Review. Undo is exact.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { classify } from '../../../shared/classify';
import { addDays } from '../../../shared/dates';
import { matchRows, type MatchCandidate, type MatchResult } from '../../../shared/history';
import { merchantKey } from '../../../shared/merchant';
import type { AccountType, AttentionReason, Kind } from '../../../shared/types';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, first, parseJson, stmt, uuid } from '../lib/db';
import { HttpError, insertTxStatements, rematchTransfers, type NewTx } from '../lib/pipeline';
import { getTx, getTxs, type TxDto } from '../lib/queries';
import { loadRules, loadSettings } from '../lib/settings';
import { cents, isoDate, parseBody } from '../lib/validate';
import { upsertRuleStatements } from './rules';

export const history = new Hono<AppEnv>();

const SPENDY: Kind[] = ['spend', 'refund', 'repayment', 'parent_paid'];

const rowSchema = z.object({
  sheet: z.string().max(100),
  rowNumber: z.number().int().min(1),
  date: isoDate,
  amountCents: cents.refine((n) => n !== 0),
  description: z.string().max(300),
  categoryLabel: z.string().max(100).default(''),
  accountLabel: z.string().max(100).default(''),
  note: z.string().max(500).default(''),
  accountIds: z.array(z.string()).max(20),
});
type SheetRowIn = z.infer<typeof rowSchema>;

const inputSchema = z.object({
  fileName: z.string().max(200),
  fileHash: z.string().min(8).max(128),
  rows: z.array(rowSchema).max(5000),
  /** Her category label → Pocket category id, or 'auto' / 'parent_pays' / 'skip'. */
  categoryMap: z.record(z.string(), z.string()),
  /** Her account label → Pocket account id (saved for next time). */
  accountAliases: z.record(z.string(), z.string()).default({}),
});
type Input = z.infer<typeof inputSchema>;

interface Change {
  kind: Kind;
  description: string;
  note: string;
  needsAttention: AttentionReason | null;
  dismissed: string | null;
  categoryId: string | null | undefined; // undefined = leave lines alone
  budgetScope: 'outside' | null | undefined;
}

/** What her row changes on a matched bank line (spec §12.4). Never touches what a person set in Pocket. */
export function changeFor(tx: TxDto & { dismissedAttention?: string | null }, row: SheetRowIn, target: string): Change | null {
  if (tx.userEdited) return null;
  const c: Change = {
    kind: tx.kind,
    description: row.description && row.description !== '(no description)' ? row.description : tx.description,
    note: row.note || tx.note,
    needsAttention: tx.needsAttention,
    dismissed: tx.dismissedAttention ?? null,
    categoryId: undefined,
    budgetScope: undefined,
  };
  const single = tx.lines.length === 1;
  if (target === 'parent_pays') {
    if (tx.amountCents < 0) {
      // Out of budget / Pop pays: her account paid, the parent covers it.
      if (tx.kind === 'spend') c.kind = 'parent_paid';
      if (c.kind === 'parent_paid') c.budgetScope = 'outside';
    } else {
      // e.g. "Pay off CC" paid by Pop: money into her account from the parent.
      c.kind = 'transfer';
      c.categoryId = null;
      c.dismissed = [c.dismissed, 'transfer_unmatched'].filter(Boolean).join(',');
      if (!c.note) c.note = 'Paid by parent';
    }
  } else if (target !== 'auto' && target !== 'skip' && single && SPENDY.includes(tx.kind)) {
    c.categoryId = target;
  }
  // Questions her row answers.
  const hasCategory = c.categoryId !== undefined ? !!c.categoryId : tx.lines.every((l) => l.categoryId);
  if (c.needsAttention === 'uncategorized' && (hasCategory || c.kind === 'transfer')) c.needsAttention = null;
  if (target === 'parent_pays' && (c.needsAttention === 'unknown_inflow' || c.needsAttention === 'venmo_incoming')) c.needsAttention = null;
  return c;
}

async function plan(db: D1Database, input: Input) {
  const accounts = await all<{ id: string; type: AccountType }>(db, "SELECT id, type FROM accounts WHERE type != 'parent_paid'");
  const known = new Set(accounts.map((a) => a.id));
  const target = (label: string) => input.categoryMap[label] ?? 'auto';
  const rows = input.rows.map((r, index) => ({ ...r, index, accountIds: r.accountIds.filter((id) => known.has(id)) }));
  const active = rows.filter((r) => target(r.categoryLabel) !== 'skip');

  const periods = await all<{ account_id: string; date_from: string; date_to: string }>(
    db,
    'SELECT account_id, date_from, date_to FROM imports WHERE undone_at IS NULL AND date_from IS NOT NULL',
  );
  const covered = (accountId: string, date: string) => periods.some((p) => p.account_id === accountId && p.date_from <= date && date <= p.date_to);

  const dates = active.map((r) => r.date).sort();
  const candidates: MatchCandidate[] = dates.length
    ? await all<MatchCandidate>(
        db,
        `SELECT t.id, t.account_id AS accountId, t.posted_date AS date, t.amount_cents AS amountCents, t.description || ' ' || t.raw_description AS description
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE a.type != 'parent_paid' AND t.excluded = 0 AND t.history_import_id IS NULL
           AND t.posted_date BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM history_matches m JOIN history_imports h ON h.id = m.history_import_id
                           WHERE m.transaction_id = t.id AND h.undone_at IS NULL)`,
        addDays(dates[0], -5),
        addDays(dates[dates.length - 1], 5),
      )
    : [];

  const results = new Map<number, MatchResult>(
    matchRows(
      active.map((r) => ({ index: r.index, sheet: r.sheet, date: r.date, amountCents: r.amountCents, description: r.description, accountIds: r.accountIds })),
      candidates,
      covered,
    ).map((m) => [m.index, m]),
  );
  const matchedIds = [...results.values()].flatMap((m) => (m.status === 'matched' ? [m.transactionId] : []));
  const matchedTxs = new Map(
    (matchedIds.length ? await getTxs(db, `t.id IN (${matchedIds.map(() => '?').join(',')})`, ...matchedIds) : []).map((t) => [t.id, t]),
  );
  const dismissed = new Map(
    (matchedIds.length ? await all<{ id: string; dismissed_attention: string | null }>(db, `SELECT id, dismissed_attention FROM transactions WHERE id IN (${matchedIds.map(() => '?').join(',')})`, ...matchedIds) : []).map(
      (r) => [r.id, r.dismissed_attention],
    ),
  );

  return {
    rows: rows.map((r) => {
      const t = target(r.categoryLabel);
      if (t === 'skip') return { row: r, target: t, result: { index: r.index, status: 'skipped' as const }, tx: null, change: null };
      const result = results.get(r.index)!;
      const tx = result.status === 'matched' ? (matchedTxs.get(result.transactionId) ?? null) : null;
      const change = tx ? changeFor({ ...tx, dismissedAttention: dismissed.get(tx.id) }, r, t) : null;
      return { row: r, target: t, result, tx, change };
    }),
    accountTypes: new Map(accounts.map((a) => [a.id, a.type])),
  };
}

type Plan = Awaited<ReturnType<typeof plan>>;

function summarize(p: Plan) {
  const count = (s: string) => p.rows.filter((x) => x.result.status === s).length;
  return {
    total: p.rows.length,
    matched: count('matched'),
    added: count('added'),
    unmatched: count('unmatched'),
    skipped: count('skipped'),
    amountDiffers: p.rows.filter((x) => x.result.status === 'matched' && x.result.amountDiffers).length,
    categoriesApplied: p.rows.filter((x) => x.change && (x.change.categoryId || x.change.kind !== x.tx?.kind)).length,
    keptPocketChoices: p.rows.filter((x) => x.tx && !x.change).length,
  };
}

function previewOf(p: Plan) {
  return {
    summary: summarize(p),
    rows: p.rows.map((x) => ({
      sheet: x.row.sheet,
      rowNumber: x.row.rowNumber,
      date: x.row.date,
      amountCents: x.row.amountCents,
      description: x.row.description,
      categoryLabel: x.row.categoryLabel,
      target: x.target,
      status: x.result.status,
      reason: x.result.status === 'unmatched' ? x.result.reason : null,
      amountDiffers: x.result.status === 'matched' ? x.result.amountDiffers : false,
      bank: x.tx ? { id: x.tx.id, date: x.tx.date, amountCents: x.tx.amountCents, description: x.tx.description, accountName: x.tx.accountName } : null,
      keptPocketChoice: !!x.tx && !x.change,
    })),
  };
}

/** A transaction for a row with no bank line (cash, or a period no statement covers). */
async function newTxFor(db: D1Database, row: SheetRowIn, accountId: string, target: string, historyImportId: string): Promise<NewTx> {
  const account = await first<{ type: AccountType }>(db, 'SELECT type FROM accounts WHERE id = ?', accountId);
  if (!account) throw new HttpError(400, 'Unknown account');
  const c = classify(
    { date: row.date, amountCents: row.amountCents, description: row.description },
    { accountId, accountType: account.type, rules: await loadRules(db), settings: await loadSettings(db) },
  );
  let kind = c.kind;
  let categoryId = c.categoryId;
  let needsAttention = c.needsAttention;
  let budgetScope: 'outside' | null = null;
  if (target === 'parent_pays') {
    kind = row.amountCents < 0 ? 'parent_paid' : 'transfer';
    budgetScope = row.amountCents < 0 ? 'outside' : null;
    if (kind === 'transfer') categoryId = null;
    needsAttention = null;
  } else if (target !== 'auto' && SPENDY.includes(kind)) {
    categoryId = target;
    if (needsAttention === 'uncategorized') needsAttention = null;
  }
  return {
    id: uuid(),
    accountId,
    importId: null,
    source: 'import',
    externalId: null,
    dedupeKey: null,
    date: row.date,
    amountCents: row.amountCents,
    rawDescription: row.description,
    merchantName: c.merchant,
    description: row.description,
    note: row.note,
    kind,
    categoryId,
    counterparty: null,
    paymentNote: null,
    fundingSource: null,
    needsAttention,
    historyImportId,
    budgetScope,
    dismissedAttention: kind === 'transfer' ? 'transfer_unmatched' : null,
  };
}

/** Statements applying a change to a bank line, after saving how it looked for undo. */
function changeStatements(db: D1Database, userId: string, historyImportId: string, tx: TxDto, dismissedBefore: string | null, change: Change): D1PreparedStatement[] {
  const before = {
    kind: tx.kind,
    description: tx.description,
    note: tx.note,
    needsAttention: tx.needsAttention,
    dismissedAttention: dismissedBefore,
    lines: tx.lines,
  };
  const out = [
    stmt(db, 'INSERT INTO history_matches (history_import_id, transaction_id, before_json) VALUES (?, ?, ?)', historyImportId, tx.id, JSON.stringify(before)),
    stmt(
      db,
      `UPDATE transactions SET kind = ?, description = ?, note = ?, needs_attention = ?, dismissed_attention = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      change.kind,
      change.description,
      change.note,
      change.needsAttention,
      change.dismissed,
      userId,
      tx.id,
    ),
  ];
  if (change.categoryId !== undefined) out.push(stmt(db, 'UPDATE transaction_lines SET category_id = ? WHERE transaction_id = ?', change.categoryId, tx.id));
  if (change.budgetScope !== undefined) out.push(stmt(db, 'UPDATE transaction_lines SET budget_scope = ? WHERE transaction_id = ?', change.budgetScope, tx.id));
  return out;
}

history.post('/preview', async (c) => {
  const input = parseBody(inputSchema, await c.req.json());
  return c.json(previewOf(await plan(c.env.DB, input)));
});

history.post('/', async (c) => {
  const db = c.env.DB;
  const input = parseBody(inputSchema, await c.req.json());
  const user = c.get('user');
  const p = await plan(db, input);
  const s = summarize(p);
  const id = uuid();
  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      'INSERT INTO history_imports (id, file_name, file_hash, rows_total, rows_matched, rows_added, rows_unmatched, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      input.fileName,
      input.fileHash,
      s.total,
      s.matched,
      s.added,
      s.unmatched,
      user.id,
    ),
  ];
  const added: NewTx[] = [];
  const dismissed = new Map(
    (await all<{ id: string; dismissed_attention: string | null }>(db, 'SELECT id, dismissed_attention FROM transactions WHERE dismissed_attention IS NOT NULL')).map((r) => [
      r.id,
      r.dismissed_attention,
    ]),
  );
  for (const x of p.rows) {
    let txId: string | null = null;
    if (x.result.status === 'matched' && x.tx) {
      txId = x.tx.id;
      if (x.change) statements.push(...changeStatements(db, user.id, id, x.tx, dismissed.get(x.tx.id) ?? null, x.change));
      // Remember the link even when Pocket's own choices were kept, so the line isn't matched twice.
      else statements.push(stmt(db, 'INSERT INTO history_matches (history_import_id, transaction_id, before_json) VALUES (?, ?, ?)', id, x.tx.id, JSON.stringify({ unchanged: true })));
    } else if (x.result.status === 'added') {
      const tx = await newTxFor(db, x.row, x.result.accountId, x.target, id);
      added.push(tx);
      txId = tx.id;
    }
    statements.push(
      stmt(
        db,
        `INSERT INTO spreadsheet_rows (id, history_import_id, sheet, row_number, posted_date, amount_cents, description, category_label, account_ids, note, status, reason, transaction_id, amount_differs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        uuid(),
        id,
        x.row.sheet,
        x.row.rowNumber,
        x.row.date,
        x.row.amountCents,
        x.row.description,
        x.row.categoryLabel,
        JSON.stringify(x.row.accountIds),
        x.row.note,
        x.result.status,
        x.result.status === 'unmatched' ? x.result.reason : null,
        txId,
        x.result.status === 'matched' && x.result.amountDiffers ? 1 : 0,
      ),
    );
  }
  // Transactions must exist before rows point at them: insert added ones first.
  const addStatements = await insertTxStatements(db, added, user.id);
  for (const [label, target] of Object.entries(input.categoryMap)) {
    statements.push(stmt(db, 'INSERT INTO category_mappings (source_name, target) VALUES (?, ?) ON CONFLICT(source_name) DO UPDATE SET target = excluded.target', label, target));
  }
  for (const [label, accountId] of Object.entries(input.accountAliases)) {
    statements.push(stmt(db, 'INSERT INTO account_aliases (alias, account_id) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET account_id = excluded.account_id', label, accountId));
  }
  statements.push(auditStmt(db, user.id, 'history_import', id, 'create', undefined, { fileName: input.fileName, ...s }));
  await db.batch([statements[0], ...addStatements, ...statements.slice(1)]);
  await rematchTransfers(db, user.id);
  return c.json({ id, ...previewOf(p) }, 201);
});

history.get('/', async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    'SELECT h.*, u.name AS created_by_name FROM history_imports h LEFT JOIN users u ON u.id = h.created_by ORDER BY h.created_at DESC',
  );
  return c.json(
    rows.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      rowsTotal: r.rows_total,
      rowsMatched: r.rows_matched,
      rowsAdded: r.rows_added,
      rowsUnmatched: r.rows_unmatched,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      undone: !!r.undone_at,
    })),
  );
});

/** Saved mappings, to pre-fill the next import. */
history.get('/mappings', async (c) => {
  const cats = await all<{ source_name: string; target: string }>(c.env.DB, 'SELECT source_name, target FROM category_mappings');
  const accts = await all<{ alias: string; account_id: string }>(c.env.DB, 'SELECT alias, account_id FROM account_aliases');
  return c.json({
    categories: Object.fromEntries(cats.map((x) => [x.source_name, x.target])),
    accounts: Object.fromEntries(accts.map((x) => [x.alias, x.account_id])),
  });
});

/** Exact undo: restore every bank line it changed, remove what it added. */
history.post('/:id/undo', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const imp = await first<{ undone_at: string | null; file_name: string }>(db, 'SELECT undone_at, file_name FROM history_imports WHERE id = ?', id);
  if (!imp) throw new HttpError(404, 'Spreadsheet import not found');
  if (imp.undone_at) throw new HttpError(409, 'Already undone');
  const user = c.get('user');
  const matches = await all<{ transaction_id: string; before_json: string }>(db, 'SELECT transaction_id, before_json FROM history_matches WHERE history_import_id = ?', id);
  const statements: D1PreparedStatement[] = [];
  for (const m of matches) {
    const b = parseJson<{ unchanged?: boolean; kind: Kind; description: string; note: string; needsAttention: string | null; dismissedAttention: string | null; lines: TxDto['lines'] }>(m.before_json, {
      unchanged: true,
    } as never);
    if (b.unchanged) continue;
    statements.push(
      stmt(
        db,
        `UPDATE transactions SET kind = ?, description = ?, note = ?, needs_attention = ?, dismissed_attention = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
        b.kind,
        b.description,
        b.note,
        b.needsAttention,
        b.dismissedAttention,
        user.id,
        m.transaction_id,
      ),
      stmt(db, 'DELETE FROM transaction_lines WHERE transaction_id = ?', m.transaction_id),
      ...b.lines.map((l, i) =>
        stmt(
          db,
          'INSERT INTO transaction_lines (id, transaction_id, amount_cents, category_id, note, sort_order, budget_scope) VALUES (?, ?, ?, ?, ?, ?, ?)',
          uuid(),
          m.transaction_id,
          l.amountCents,
          l.categoryId,
          l.note,
          i,
          (l as { budgetScope?: string | null }).budgetScope ?? null,
        ),
      ),
    );
  }
  const removed = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM transactions WHERE history_import_id = ?', id);
  statements.push(
    stmt(db, 'DELETE FROM history_matches WHERE history_import_id = ?', id),
    stmt(db, 'UPDATE spreadsheet_rows SET transaction_id = NULL WHERE history_import_id = ?', id),
    stmt(db, 'DELETE FROM transactions WHERE history_import_id = ?', id),
    stmt(db, "UPDATE history_imports SET undone_at = datetime('now') WHERE id = ?", id),
    auditStmt(db, user.id, 'history_import', id, 'undo', undefined, { fileName: imp.file_name, restored: matches.length, removed: removed?.n ?? 0 }),
  );
  await db.batch(statements);
  await rematchTransfers(db, user.id);
  return c.json({ restored: matches.length, removed: removed?.n ?? 0 });
});

// ---- Rows that need a decision (shown in Review) --------------------------------

export async function unmatchedRows(db: D1Database) {
  const rows = await all<{
    id: string;
    history_import_id: string;
    sheet: string;
    row_number: number;
    posted_date: string;
    amount_cents: number;
    description: string;
    category_label: string;
    account_ids: string;
    note: string;
    reason: string | null;
  }>(
    db,
    `SELECT r.* FROM spreadsheet_rows r JOIN history_imports h ON h.id = r.history_import_id
     WHERE h.undone_at IS NULL AND r.status = 'unmatched' ORDER BY r.posted_date DESC LIMIT 200`,
  );
  return rows.map((r) => ({
    id: r.id,
    historyImportId: r.history_import_id,
    sheet: r.sheet,
    rowNumber: r.row_number,
    date: r.posted_date,
    amountCents: r.amount_cents,
    description: r.description,
    categoryLabel: r.category_label,
    accountIds: parseJson<string[]>(r.account_ids, []),
    note: r.note,
    reason: r.reason,
  }));
}

export async function unmatchedRowCount(db: D1Database): Promise<number> {
  const r = await first<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM spreadsheet_rows r JOIN history_imports h ON h.id = r.history_import_id WHERE h.undone_at IS NULL AND r.status = 'unmatched'",
  );
  return r?.n ?? 0;
}

/** Bank lines she might mean, for "pick the bank line by hand". */
history.get('/rows/:rowId/candidates', async (c) => {
  const row = (await unmatchedRows(c.env.DB)).find((r) => r.id === c.req.param('rowId'));
  if (!row) throw new HttpError(404, 'Row not found');
  const tolerance = Math.max(500, Math.round(Math.abs(row.amountCents) * 0.1));
  const accountFilter = row.accountIds.length ? `AND t.account_id IN (${row.accountIds.map(() => '?').join(',')})` : '';
  const txs = await getTxs(
    c.env.DB,
    `t.posted_date BETWEEN ? AND ? AND ABS(t.amount_cents - ?) <= ? AND (t.amount_cents > 0) = (? > 0) AND a.type != 'parent_paid' ${accountFilter}
     AND NOT EXISTS (SELECT 1 FROM history_matches m JOIN history_imports h ON h.id = m.history_import_id WHERE m.transaction_id = t.id AND h.undone_at IS NULL)
     ORDER BY ABS(t.amount_cents - ?), ABS(julianday(t.posted_date) - julianday(?)) LIMIT 8`,
    // Wider than automatic matching: her dates can be weeks off ("Initial Budget" written on the 1st).
    addDays(row.date, -31),
    addDays(row.date, 31),
    row.amountCents,
    tolerance,
    row.amountCents,
    ...row.accountIds,
    row.amountCents,
    row.date,
  );
  return c.json(txs);
});

const resolveSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), accountId: z.string().min(1) }),
  z.object({ action: z.literal('match'), transactionId: z.string().min(1) }),
  z.object({ action: z.literal('skip') }),
]);

history.post('/rows/:rowId/resolve', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const row = (await unmatchedRows(db)).find((r) => r.id === c.req.param('rowId'));
  if (!row) throw new HttpError(404, 'Row not found');
  const body = parseBody(resolveSchema, await c.req.json());
  const mapping = await first<{ target: string }>(db, 'SELECT target FROM category_mappings WHERE source_name = ?', row.categoryLabel);
  const target = mapping?.target ?? 'auto';
  const sheetRow: SheetRowIn = { ...row, accountLabel: '' };

  if (body.action === 'skip') {
    await db.batch([stmt(db, "UPDATE spreadsheet_rows SET status = 'skipped' WHERE id = ?", row.id), auditStmt(db, user.id, 'spreadsheet_row', row.id, 'skip')]);
  } else if (body.action === 'add') {
    const tx = await newTxFor(db, sheetRow, body.accountId, target, row.historyImportId);
    await db.batch([
      ...(await insertTxStatements(db, [tx], user.id)),
      stmt(db, "UPDATE spreadsheet_rows SET status = 'added', transaction_id = ? WHERE id = ?", tx.id, row.id),
      auditStmt(db, user.id, 'spreadsheet_row', row.id, 'add', undefined, { accountId: body.accountId }),
    ]);
    await rematchTransfers(db, user.id);
  } else {
    const tx = await getTx(db, body.transactionId);
    if (!tx) throw new HttpError(404, 'Transaction not found');
    const d = await first<{ dismissed_attention: string | null }>(db, 'SELECT dismissed_attention FROM transactions WHERE id = ?', tx.id);
    const change = changeFor({ ...tx, dismissedAttention: d?.dismissed_attention ?? null }, sheetRow, target);
    await db.batch([
      ...(change
        ? changeStatements(db, user.id, row.historyImportId, tx, d?.dismissed_attention ?? null, change)
        : [stmt(db, 'INSERT INTO history_matches (history_import_id, transaction_id, before_json) VALUES (?, ?, ?)', row.historyImportId, tx.id, JSON.stringify({ unchanged: true }))]),
      stmt(db, "UPDATE spreadsheet_rows SET status = 'matched', transaction_id = ?, amount_differs = ? WHERE id = ?", tx.id, tx.amountCents === row.amountCents ? 0 : 1, row.id),
      auditStmt(db, user.id, 'spreadsheet_row', row.id, 'match', undefined, { transactionId: tx.id }),
    ]);
  }
  return c.json({ ok: true, remaining: await unmatchedRowCount(db) });
});

// ---- Rules learned from the spreadsheet -----------------------------------------

/** Shops she always put in the same category (≥ 2 times), excluding people paid on Zelle/Venmo. */
history.get('/:id/rule-suggestions', async (c) => {
  const db = c.env.DB;
  const rows = await all<{ merchant: string | null; category_id: string | null; kind: string; account_type: string; description: string }>(
    db,
    `SELECT m.name AS merchant, l.category_id, t.kind, a.type AS account_type, t.raw_description AS description
     FROM history_matches hm JOIN transactions t ON t.id = hm.transaction_id JOIN accounts a ON a.id = t.account_id
     JOIN transaction_lines l ON l.transaction_id = t.id LEFT JOIN merchants m ON m.id = t.merchant_id
     WHERE hm.history_import_id = ?`,
    c.req.param('id'),
  );
  const existing = new Set((await all<{ pattern: string }>(db, "SELECT pattern FROM rules WHERE match_type = 'merchant'")).map((r) => merchantKey(r.pattern)));
  const groups = new Map<string, { merchant: string; categories: Map<string, number>; count: number }>();
  for (const r of rows) {
    if (!r.merchant || !r.category_id || r.account_type === 'payment_app' || /^zelle\b/i.test(r.description) || r.kind === 'transfer') continue;
    const key = merchantKey(r.merchant);
    if (existing.has(key)) continue;
    const g = groups.get(key) ?? { merchant: r.merchant, categories: new Map(), count: 0 };
    g.categories.set(r.category_id, (g.categories.get(r.category_id) ?? 0) + 1);
    g.count++;
    groups.set(key, g);
  }
  const suggestions = [...groups.values()]
    .filter((g) => g.count >= 2 && g.categories.size === 1)
    .map((g) => ({ merchant: g.merchant, categoryId: [...g.categories.keys()][0], count: g.count }))
    .sort((a, b) => b.count - a.count);
  return c.json(suggestions);
});

history.post('/:id/rules', async (c) => {
  const db = c.env.DB;
  const body = parseBody(z.object({ rules: z.array(z.object({ merchant: z.string().min(1), categoryId: z.string().min(1) })).max(200) }), await c.req.json());
  const user = c.get('user');
  const statements: D1PreparedStatement[] = [];
  for (const r of body.rules) {
    statements.push(
      ...(await upsertRuleStatements(db, user.id, { matchType: 'merchant', pattern: r.merchant, accountId: null, setKind: null, setCategoryId: r.categoryId, priority: 0 })).statements,
    );
  }
  if (statements.length) await db.batch(statements);
  return c.json({ created: body.rules.length });
});
