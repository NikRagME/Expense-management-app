/**
 * Import pipeline (architecture §8): dedupe → clean merchant → classify →
 * merge suggestions → transfer matching → balance check.
 *
 * `planImport` is pure with respect to the database (reads only), so the
 * preview and the commit run exactly the same code; `commitPlan` writes the
 * plan atomically in one D1 batch.
 */
import { checkBalance } from '../../../shared/balance';
import { classify } from '../../../shared/classify';
import { addDays } from '../../../shared/dates';
import { dedupeKey, findMergeCandidate, findTransferPairs, splitDuplicates, type MatchTx } from '../../../shared/matching';
import { merchantKey } from '../../../shared/merchant';
import type { AccountType, AttentionReason, CsvMapping, Kind, ParsedRow, Rule, Settings, Source } from '../../../shared/types';
import { auditStmt } from './audit';
import { all, allIn, first, stmt, uuid } from './db';
import { loadRules, loadSettings } from './settings';

export interface NewTx {
  id: string;
  accountId: string;
  importId: string | null;
  source: Source;
  externalId: string | null;
  dedupeKey: string | null;
  date: string;
  amountCents: number;
  rawDescription: string;
  merchantName: string;
  description: string;
  note: string;
  kind: Kind;
  categoryId: string | null;
  counterparty: string | null;
  paymentNote: string | null;
  fundingSource: string | null;
  needsAttention: AttentionReason | null;
  recurringItemId?: string | null;
}

export interface PlannedLink {
  id: string;
  type: 'transfer' | 'merge_suggestion';
  fromId: string;
  toId: string;
}

export interface TxUpdate {
  id: string;
  kind?: Kind;
  needsAttention: AttentionReason | null;
}

export interface ImportInput {
  accountId: string;
  fileName: string;
  fileHash: string;
  format: 'csv' | 'ofx' | 'venmo';
  rows: ParsedRow[];
  balance?: { asOf: string; cents: number } | null;
  mapping?: CsvMapping | null;
}

export interface ImportPlan {
  importId: string;
  input: ImportInput;
  accountType: AccountType;
  newTxs: NewTx[];
  duplicates: ParsedRow[];
  links: PlannedLink[];
  updates: TxUpdate[];
  snapshot: { asOf: string; cents: number; computedCents: number | null; differenceCents: number | null } | null;
  alreadyImported: boolean;
  summary: {
    total: number;
    new: number;
    duplicates: number;
    transfersMatched: number;
    needsAttention: number;
    dateFrom: string | null;
    dateTo: string | null;
  };
}

interface OpenTxRow {
  id: string;
  account_id: string;
  posted_date: string;
  amount_cents: number;
  kind: Kind;
  needs_attention: AttentionReason | null;
  source: Source;
}

/** Unlinked transactions that could still be one side of a transfer. */
export async function loadOpenTransferCandidates(db: D1Database, from: string, to: string): Promise<MatchTx[]> {
  const rows = await all<OpenTxRow>(
    db,
    `SELECT t.id, t.account_id, t.posted_date, t.amount_cents, t.kind, t.needs_attention, t.source
     FROM transactions t
     WHERE t.posted_date BETWEEN ? AND ? AND t.excluded = 0
       AND (t.kind = 'transfer' OR t.needs_attention = 'unknown_inflow')
       AND NOT EXISTS (SELECT 1 FROM transaction_links l WHERE l.type = 'transfer' AND (l.from_id = t.id OR l.to_id = t.id))`,
    from,
    to,
  );
  return rows.map(toMatchTx);
}

const toMatchTx = (r: OpenTxRow): MatchTx => ({
  id: r.id,
  accountId: r.account_id,
  date: r.posted_date,
  amountCents: r.amount_cents,
  kind: r.kind,
  needsAttention: r.needs_attention,
  source: r.source,
  linked: false,
});

/** Turn transfer pairs into links + updates (unknown inflows become transfers; ambiguity is flagged). */
export function planTransferLinks(candidates: MatchTx[]): { links: PlannedLink[]; updates: TxUpdate[] } {
  const { pairs, ambiguous } = findTransferPairs(candidates);
  const links: PlannedLink[] = [];
  const updates: TxUpdate[] = [];
  for (const [out, inn] of pairs) {
    links.push({ id: uuid(), type: 'transfer', fromId: out.id, toId: inn.id });
    for (const t of [out, inn]) {
      if (t.kind !== 'transfer' || t.needsAttention) updates.push({ id: t.id, kind: 'transfer', needsAttention: null });
    }
  }
  for (const id of ambiguous) {
    const t = candidates.find((x) => x.id === id);
    if (t && t.needsAttention !== 'transfer_ambiguous') updates.push({ id, needsAttention: 'transfer_ambiguous' });
  }
  return { links, updates };
}

export async function planImport(db: D1Database, input: ImportInput, ctx?: { rules?: Rule[]; settings?: Settings }): Promise<ImportPlan> {
  const account = await first<{ id: string; type: AccountType }>(db, 'SELECT id, type FROM accounts WHERE id = ? AND archived_at IS NULL', input.accountId);
  if (!account) throw new HttpError(404, 'Account not found');
  if (account.type === 'parent_paid') throw new HttpError(400, "Statements can't be imported into Paid by parent");

  const rules = ctx?.rules ?? (await loadRules(db));
  const settings = ctx?.settings ?? (await loadSettings(db));
  const importId = uuid();
  const dates = input.rows.map((r) => r.date).sort();
  const dateFrom = dates[0] ?? null;
  const dateTo = dates[dates.length - 1] ?? null;

  const previous = await first<{ id: string }>(
    db,
    'SELECT id FROM imports WHERE account_id = ? AND file_hash = ? AND undone_at IS NULL',
    input.accountId,
    input.fileHash,
  );

  // 1. Duplicates (compare against this account's transactions in a padded window).
  let fresh = input.rows;
  let duplicates: ParsedRow[] = [];
  if (dateFrom && dateTo) {
    const existing = await all<{ external_id: string | null; dedupe_key: string | null }>(
      db,
      'SELECT external_id, dedupe_key FROM transactions WHERE account_id = ? AND posted_date BETWEEN ? AND ?',
      input.accountId,
      addDays(dateFrom, -45),
      addDays(dateTo, 45),
    );
    const keyCounts = new Map<string, number>();
    const externalIds = new Set<string>();
    for (const e of existing) {
      if (e.external_id) externalIds.add(e.external_id);
      if (e.dedupe_key) keyCounts.set(e.dedupe_key, (keyCounts.get(e.dedupe_key) ?? 0) + 1);
    }
    ({ fresh, duplicates } = splitDuplicates(input.rows, { externalIds, keyCounts }));
  }

  // 2–3. Merchant + classification.
  const newTxs: NewTx[] = fresh.map((row) => {
    const c = classify(row, { accountId: account.id, accountType: account.type, rules, settings });
    return {
      id: uuid(),
      accountId: account.id,
      importId,
      source: 'import',
      externalId: row.externalId ?? null,
      dedupeKey: row.externalId ? null : dedupeKey(row),
      date: row.date,
      amountCents: row.amountCents,
      rawDescription: row.description,
      merchantName: c.merchant,
      description: c.merchant,
      note: '',
      kind: c.kind,
      categoryId: c.categoryId,
      counterparty: row.counterparty ?? null,
      paymentNote: row.paymentNote ?? null,
      fundingSource: row.fundingSource ?? null,
      needsAttention: c.needsAttention,
    };
  });

  const links: PlannedLink[] = [];
  const updates: TxUpdate[] = [];

  // 4. Manual entries this import probably duplicates (spec A3).
  if (dateFrom && dateTo && newTxs.length) {
    const manual = (
      await all<OpenTxRow>(
        db,
        `SELECT t.id, t.account_id, t.posted_date, t.amount_cents, t.kind, t.needs_attention, t.source
         FROM transactions t
         WHERE t.account_id = ? AND t.source = 'manual' AND t.posted_date BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM transaction_links l WHERE l.type = 'merge_suggestion' AND l.to_id = t.id)`,
        account.id,
        addDays(dateFrom, -3),
        addDays(dateTo, 3),
      )
    ).map(toMatchTx);
    for (const tx of newTxs) {
      const hit = findMergeCandidate({ ...toMatchFromNew(tx) }, manual);
      if (hit) {
        hit.linked = true; // one suggestion per manual entry
        links.push({ id: uuid(), type: 'merge_suggestion', fromId: tx.id, toId: hit.id });
        tx.needsAttention = 'possible_merge';
      }
    }
  }

  // 5. Transfers across all accounts.
  if (dateFrom && dateTo) {
    const open = await loadOpenTransferCandidates(db, addDays(dateFrom, -5), addDays(dateTo, 5));
    const candidates = [...open, ...newTxs.filter((t) => t.kind === 'transfer' || t.needsAttention === 'unknown_inflow').map(toMatchFromNew)];
    const planned = planTransferLinks(candidates);
    links.push(...planned.links);
    const newById = new Map(newTxs.map((t) => [t.id, t]));
    for (const u of planned.updates) {
      const t = newById.get(u.id);
      if (t) {
        if (u.kind) t.kind = u.kind;
        if (t.needsAttention !== 'possible_merge') t.needsAttention = u.needsAttention;
        if (u.kind === 'transfer') t.categoryId = null;
      } else updates.push(u);
    }
  }

  // 6. Balance check against the statement's own balance.
  let snapshot: ImportPlan['snapshot'] = null;
  if (input.balance) {
    const snaps = await all<{ as_of_date: string; balance_cents: number }>(
      db,
      'SELECT as_of_date, balance_cents FROM balance_snapshots WHERE account_id = ? AND as_of_date <= ?',
      account.id,
      input.balance.asOf,
    );
    const latest = snaps.reduce<string | null>((m, s) => (!m || s.as_of_date > m ? s.as_of_date : m), null);
    const moves = latest
      ? await all<{ posted_date: string; amount_cents: number }>(
          db,
          'SELECT posted_date, amount_cents FROM transactions WHERE account_id = ? AND posted_date > ? AND posted_date <= ?',
          account.id,
          latest,
          input.balance.asOf,
        )
      : [];
    const check = checkBalance(
      snaps.map((s) => ({ asOf: s.as_of_date, cents: s.balance_cents })),
      [...moves.map((m) => ({ date: m.posted_date, amountCents: m.amount_cents })), ...newTxs.map((t) => ({ date: t.date, amountCents: t.amountCents }))],
      { asOf: input.balance.asOf, cents: input.balance.cents },
    );
    snapshot = { ...input.balance, computedCents: check?.computedCents ?? null, differenceCents: check?.differenceCents ?? null };
  }

  const transferIds = new Set(links.filter((l) => l.type === 'transfer').flatMap((l) => [l.fromId, l.toId]));
  return {
    importId,
    input,
    accountType: account.type,
    newTxs,
    duplicates,
    links,
    updates,
    snapshot,
    alreadyImported: !!previous,
    summary: {
      total: input.rows.length,
      new: newTxs.length,
      duplicates: duplicates.length,
      transfersMatched: newTxs.filter((t) => transferIds.has(t.id)).length,
      needsAttention: newTxs.filter((t) => t.needsAttention).length,
      dateFrom,
      dateTo,
    },
  };
}

const toMatchFromNew = (t: NewTx): MatchTx => ({
  id: t.id,
  accountId: t.accountId,
  date: t.date,
  amountCents: t.amountCents,
  kind: t.kind,
  needsAttention: t.needsAttention,
  source: t.source,
  linked: false,
});

/** Statements that insert a new transaction (with its single category line and merchant). */
export async function insertTxStatements(db: D1Database, txs: NewTx[], userId: string | null): Promise<D1PreparedStatement[]> {
  const out: D1PreparedStatement[] = [];
  // Merchants: reuse existing by key, create the rest.
  const keys = [...new Set(txs.map((t) => merchantKey(t.merchantName)).filter(Boolean))];
  const existing = keys.length ? await allIn<{ id: string; match_key: string }>(db, (ph) => `SELECT id, match_key FROM merchants WHERE match_key IN (${ph})`, keys) : [];
  const merchantIds = new Map(existing.map((m) => [m.match_key, m.id]));
  for (const t of txs) {
    const key = merchantKey(t.merchantName);
    if (key && !merchantIds.has(key)) {
      const id = uuid();
      merchantIds.set(key, id);
      out.push(stmt(db, 'INSERT INTO merchants (id, name, match_key) VALUES (?, ?, ?) ON CONFLICT(match_key) DO NOTHING', id, t.merchantName, key));
    }
  }
  for (const t of txs) {
    const key = merchantKey(t.merchantName);
    out.push(
      stmt(
        db,
        `INSERT INTO transactions (id, account_id, import_id, source, external_id, dedupe_key, posted_date, amount_cents,
           raw_description, merchant_id, description, note, kind, counterparty, payment_note, funding_source,
           needs_attention, recurring_item_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT id FROM merchants WHERE match_key = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        t.id,
        t.accountId,
        t.importId,
        t.source,
        t.externalId,
        t.dedupeKey,
        t.date,
        t.amountCents,
        t.rawDescription,
        key || null,
        t.description,
        t.note,
        t.kind,
        t.counterparty,
        t.paymentNote,
        t.fundingSource,
        t.needsAttention,
        t.recurringItemId ?? null,
        userId,
        userId,
      ),
      stmt(
        db,
        'INSERT INTO transaction_lines (id, transaction_id, amount_cents, category_id) VALUES (?, ?, ?, ?)',
        uuid(),
        t.id,
        t.amountCents,
        t.kind === 'transfer' ? null : t.categoryId,
      ),
    );
  }
  return out;
}

export function linkStatements(db: D1Database, links: PlannedLink[], userId: string): D1PreparedStatement[] {
  return links.map((l) => stmt(db, 'INSERT INTO transaction_links (id, type, from_id, to_id, created_by) VALUES (?, ?, ?, ?, ?)', l.id, l.type, l.fromId, l.toId, userId));
}

export function updateStatements(db: D1Database, updates: TxUpdate[], userId: string): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [];
  for (const u of updates) {
    if (u.kind) {
      out.push(
        stmt(db, `UPDATE transactions SET kind = ?, needs_attention = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`, u.kind, u.needsAttention, userId, u.id),
      );
      if (u.kind === 'transfer') out.push(stmt(db, 'UPDATE transaction_lines SET category_id = NULL WHERE transaction_id = ?', u.id));
    } else {
      out.push(stmt(db, `UPDATE transactions SET needs_attention = ?, updated_at = datetime('now') WHERE id = ?`, u.needsAttention, u.id));
    }
  }
  return out;
}

export async function commitPlan(db: D1Database, plan: ImportPlan, userId: string): Promise<void> {
  const { input, summary } = plan;
  const statements: D1PreparedStatement[] = [
    stmt(
      db,
      `INSERT INTO imports (id, account_id, file_name, file_hash, format, date_from, date_to, rows_total, rows_new, rows_duplicate, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      plan.importId,
      input.accountId,
      input.fileName,
      input.fileHash,
      input.format,
      summary.dateFrom,
      summary.dateTo,
      summary.total,
      summary.new,
      summary.duplicates,
      userId,
    ),
    ...(await insertTxStatements(db, plan.newTxs, userId)),
    ...linkStatements(db, plan.links, userId),
    ...updateStatements(db, plan.updates, userId),
  ];
  if (input.mapping && input.format === 'csv') {
    statements.push(stmt(db, 'UPDATE accounts SET import_mapping = ? WHERE id = ?', JSON.stringify(input.mapping), input.accountId));
  }
  if (plan.snapshot) {
    const s = plan.snapshot;
    statements.push(
      stmt(
        db,
        `INSERT INTO balance_snapshots (id, account_id, as_of_date, balance_cents, source, computed_cents, difference_cents, import_id, created_by)
         VALUES (?, ?, ?, ?, 'statement', ?, ?, ?, ?)`,
        uuid(),
        input.accountId,
        s.asOf,
        s.cents,
        s.computedCents,
        s.differenceCents,
        plan.importId,
        userId,
      ),
    );
  }
  statements.push(auditStmt(db, userId, 'import', plan.importId, 'create', undefined, { fileName: input.fileName, ...summary }));
  await db.batch(statements);
}

/** Re-run transfer matching over everything still unpaired (after undo or edits). */
export async function rematchTransfers(db: D1Database, userId: string): Promise<number> {
  const open = await loadOpenTransferCandidates(db, '0000-01-01', '9999-12-31');
  const { links, updates } = planTransferLinks(open);
  const statements = [...linkStatements(db, links, userId), ...updateStatements(db, updates, userId)];
  if (statements.length) await db.batch(statements);
  return links.length;
}

export class HttpError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
