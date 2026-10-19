import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { auditStmt } from '../lib/audit';
import { all, stmt } from '../lib/db';
import { loadSettings } from '../lib/settings';
import { parseBody } from '../lib/validate';

export const settings = new Hono<AppEnv>();

settings.get('/', async (c) => {
  const users = await all<{ id: string; email: string; name: string; role: string }>(c.env.DB, 'SELECT id, email, name, role FROM users ORDER BY role DESC, name');
  return c.json({ ...(await loadSettings(c.env.DB)), users });
});

const schema = z.object({
  parentZelleNames: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  venmoIncomingDefault: z.enum(['ask', 'repayment']).optional(),
});

settings.patch('/', async (c) => {
  const body = parseBody(schema, await c.req.json());
  const before = await loadSettings(c.env.DB);
  const statements: D1PreparedStatement[] = [];
  const put = (key: string, value: unknown) =>
    statements.push(stmt(c.env.DB, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value)));
  if (body.parentZelleNames) put('parent_zelle_names', body.parentZelleNames);
  if (body.venmoIncomingDefault) put('venmo_incoming_default', body.venmoIncomingDefault);
  statements.push(auditStmt(c.env.DB, c.get('user').id, 'settings', 'settings', 'update', before, body));
  await c.env.DB.batch(statements);
  return c.json({ ok: true });
});
