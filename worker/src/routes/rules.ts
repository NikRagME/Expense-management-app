import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, first, stmt, uuid } from '../lib/db';
import { HttpError } from '../lib/pipeline';
import { kind, parseBody } from '../lib/validate';

export const rules = new Hono<AppEnv>();

rules.get('/', async (c) => {
  const rows = await all<{
    id: string;
    match_type: string;
    pattern: string;
    account_id: string | null;
    set_kind: string | null;
    set_category_id: string | null;
    priority: number;
    created_by_name: string | null;
    created_at: string;
  }>(c.env.DB, 'SELECT r.*, u.name AS created_by_name FROM rules r LEFT JOIN users u ON u.id = r.created_by ORDER BY r.pattern');
  return c.json(
    rows.map((r) => ({
      id: r.id,
      matchType: r.match_type,
      pattern: r.pattern,
      accountId: r.account_id,
      setKind: r.set_kind,
      setCategoryId: r.set_category_id,
      priority: r.priority,
      createdByName: r.created_by_name,
      createdAt: r.created_at,
    })),
  );
});

const schema = z
  .object({
    matchType: z.enum(['merchant', 'contains', 'regex']),
    pattern: z.string().trim().min(1).max(200),
    accountId: z.string().nullable().default(null),
    setKind: kind.nullable().default(null),
    setCategoryId: z.string().nullable().default(null),
    priority: z.number().int().default(0),
  })
  .refine((r) => r.setKind || r.setCategoryId, 'a rule must set a kind or a category')
  .refine((r) => {
    if (r.matchType !== 'regex') return true;
    try {
      new RegExp(r.pattern);
      return true;
    } catch {
      return false;
    }
  }, 'invalid regular expression');

/** Create (or replace the existing rule for the same pattern). */
export async function upsertRuleStatements(db: D1Database, userId: string, r: z.infer<typeof schema>) {
  const existing = await first<{ id: string }>(db, 'SELECT id FROM rules WHERE match_type = ? AND lower(pattern) = lower(?) AND account_id IS ?', r.matchType, r.pattern, r.accountId);
  const id = existing?.id ?? uuid();
  return {
    id,
    statements: [
      existing
        ? stmt(db, 'UPDATE rules SET set_kind = ?, set_category_id = ?, priority = ? WHERE id = ?', r.setKind, r.setCategoryId, r.priority, id)
        : stmt(
            db,
            'INSERT INTO rules (id, match_type, pattern, account_id, set_kind, set_category_id, priority, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            id,
            r.matchType,
            r.pattern,
            r.accountId,
            r.setKind,
            r.setCategoryId,
            r.priority,
            userId,
          ),
      auditStmt(db, userId, 'rule', id, existing ? 'update' : 'create', undefined, r),
    ],
  };
}

rules.post('/', async (c) => {
  const body = parseBody(schema, await c.req.json());
  const { id, statements } = await upsertRuleStatements(c.env.DB, c.get('user').id, body);
  await c.env.DB.batch(statements);
  return c.json({ id }, 201);
});

rules.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const before = await first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM rules WHERE id = ?', id);
  if (!before) throw new HttpError(404, 'Rule not found');
  const body = parseBody(schema, await c.req.json());
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      'UPDATE rules SET match_type = ?, pattern = ?, account_id = ?, set_kind = ?, set_category_id = ?, priority = ? WHERE id = ?',
      body.matchType,
      body.pattern,
      body.accountId,
      body.setKind,
      body.setCategoryId,
      body.priority,
      id,
    ),
    auditStmt(c.env.DB, c.get('user').id, 'rule', id, 'update', before, body),
  ]);
  return c.json({ ok: true });
});

rules.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const before = await first<Record<string, unknown>>(c.env.DB, 'SELECT * FROM rules WHERE id = ?', id);
  if (!before) throw new HttpError(404, 'Rule not found');
  await c.env.DB.batch([stmt(c.env.DB, 'DELETE FROM rules WHERE id = ?', id), auditStmt(c.env.DB, c.get('user').id, 'rule', id, 'delete', before)]);
  return c.json({ ok: true });
});
