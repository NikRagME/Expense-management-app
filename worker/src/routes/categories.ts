import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, first, stmt, uuid } from '../lib/db';
import { HttpError } from '../lib/pipeline';
import { parseBody } from '../lib/validate';

export const categories = new Hono<AppEnv>();

categories.get('/', async (c) => {
  const groups = await all<{ id: string; name: string; sort_order: number }>(c.env.DB, 'SELECT * FROM category_groups ORDER BY sort_order');
  const cats = await all<{ id: string; group_id: string; name: string; emoji: string; color: string | null; hidden: number; sort_order: number; uses: number }>(
    c.env.DB,
    `SELECT c.*, (SELECT COUNT(*) FROM transaction_lines l WHERE l.category_id = c.id) AS uses
     FROM categories c ORDER BY c.sort_order, c.name`,
  );
  return c.json({
    groups: groups.map((g) => ({ id: g.id, name: g.name })),
    categories: cats.map((x) => ({ id: x.id, groupId: x.group_id, name: x.name, emoji: x.emoji, color: x.color, hidden: !!x.hidden, uses: x.uses })),
  });
});

const schema = z.object({
  name: z.string().trim().min(1).max(40),
  groupId: z.string().min(1),
  emoji: z.string().max(8).default(''),
});

categories.post('/', async (c) => {
  const body = parseBody(schema, await c.req.json());
  if (!(await first(c.env.DB, 'SELECT id FROM category_groups WHERE id = ?', body.groupId))) throw new HttpError(400, 'Unknown group');
  const id = uuid();
  const user = c.get('user');
  const max = await first<{ m: number }>(c.env.DB, 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories');
  await c.env.DB.batch([
    stmt(c.env.DB, 'INSERT INTO categories (id, group_id, name, emoji, sort_order) VALUES (?, ?, ?, ?, ?)', id, body.groupId, body.name, body.emoji, (max?.m ?? 0) + 1),
    auditStmt(c.env.DB, user.id, 'category', id, 'create', undefined, body),
  ]);
  return c.json({ id }, 201);
});

categories.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = parseBody(schema.partial().extend({ hidden: z.boolean().optional() }), await c.req.json());
  const before = await first<{ name: string; group_id: string; emoji: string; hidden: number }>(c.env.DB, 'SELECT * FROM categories WHERE id = ?', id);
  if (!before) throw new HttpError(404, 'Category not found');
  if (body.groupId && !(await first(c.env.DB, 'SELECT id FROM category_groups WHERE id = ?', body.groupId))) throw new HttpError(400, 'Unknown group');
  const user = c.get('user');
  await c.env.DB.batch([
    stmt(
      c.env.DB,
      'UPDATE categories SET name = ?, group_id = ?, emoji = ?, hidden = ? WHERE id = ?',
      body.name ?? before.name,
      body.groupId ?? before.group_id,
      body.emoji ?? before.emoji,
      body.hidden === undefined ? before.hidden : body.hidden ? 1 : 0,
      id,
    ),
    auditStmt(c.env.DB, user.id, 'category', id, 'update', before, body),
  ]);
  return c.json({ ok: true });
});
