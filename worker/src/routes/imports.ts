import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, first, stmt } from '../lib/db';
import { commitPlan, HttpError, planImport, rematchTransfers, type ImportInput, type ImportPlan } from '../lib/pipeline';
import { cents, csvMapping, isoDate, parseBody, parsedRow } from '../lib/validate';

export const imports = new Hono<AppEnv>();

const inputSchema = z.object({
  accountId: z.string().min(1),
  fileName: z.string().max(200),
  fileHash: z.string().min(8).max(128),
  format: z.enum(['csv', 'ofx', 'venmo']),
  rows: z.array(parsedRow).max(5000),
  balance: z.object({ asOf: isoDate, cents }).nullable().optional(),
  mapping: csvMapping.nullable().optional(),
});

function previewOf(plan: ImportPlan) {
  return {
    summary: plan.summary,
    alreadyImported: plan.alreadyImported,
    balance: plan.snapshot,
    rows: plan.newTxs.map((t) => ({
      date: t.date,
      amountCents: t.amountCents,
      description: t.description,
      rawDescription: t.rawDescription,
      kind: t.kind,
      categoryId: t.categoryId,
      needsAttention: t.needsAttention,
      transferMatched: plan.links.some((l) => l.type === 'transfer' && (l.fromId === t.id || l.toId === t.id)),
    })),
    duplicates: plan.duplicates.slice(0, 50),
  };
}

imports.post('/preview', async (c) => {
  const input = parseBody(inputSchema, await c.req.json()) as ImportInput;
  return c.json(previewOf(await planImport(c.env.DB, input)));
});

imports.post('/', async (c) => {
  const input = parseBody(inputSchema, await c.req.json()) as ImportInput;
  const plan = await planImport(c.env.DB, input);
  await commitPlan(c.env.DB, plan, c.get('user').id);
  return c.json({ id: plan.importId, ...previewOf(plan) }, 201);
});

imports.get('/', async (c) => {
  const rows = await all<Record<string, unknown>>(
    c.env.DB,
    `SELECT i.*, a.name AS account_name, u.name AS created_by_name FROM imports i
     JOIN accounts a ON a.id = i.account_id LEFT JOIN users u ON u.id = i.created_by
     ORDER BY i.created_at DESC LIMIT 100`,
  );
  return c.json(
    rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      accountName: r.account_name,
      fileName: r.file_name,
      format: r.format,
      dateFrom: r.date_from,
      dateTo: r.date_to,
      rowsTotal: r.rows_total,
      rowsNew: r.rows_new,
      rowsDuplicate: r.rows_duplicate,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
      undone: !!r.undone_at,
    })),
  );
});

/** Undo removes everything the import added, then re-pairs any transfers left unmatched. */
imports.post('/:id/undo', async (c) => {
  const id = c.req.param('id');
  const imp = await first<{ id: string; undone_at: string | null; file_name: string }>(c.env.DB, 'SELECT id, undone_at, file_name FROM imports WHERE id = ?', id);
  if (!imp) throw new HttpError(404, 'Import not found');
  if (imp.undone_at) throw new HttpError(409, 'Already undone');
  const user = c.get('user');
  const removed = await first<{ n: number }>(c.env.DB, 'SELECT COUNT(*) AS n FROM transactions WHERE import_id = ?', id);
  await c.env.DB.batch([
    stmt(c.env.DB, 'DELETE FROM balance_snapshots WHERE import_id = ?', id),
    stmt(c.env.DB, 'DELETE FROM transactions WHERE import_id = ?', id),
    stmt(c.env.DB, "UPDATE imports SET undone_at = datetime('now') WHERE id = ?", id),
    auditStmt(c.env.DB, user.id, 'import', id, 'undo', undefined, { fileName: imp.file_name, removed: removed?.n ?? 0 }),
  ]);
  await rematchTransfers(c.env.DB, user.id);
  return c.json({ removed: removed?.n ?? 0 });
});
