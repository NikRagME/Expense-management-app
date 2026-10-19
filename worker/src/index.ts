import { Hono } from 'hono';
import type { AppEnv, Env } from './env';
import { authRoutes, requireAppHeader, requireUser } from './lib/auth';
import { HttpError } from './lib/pipeline';
import { runNightly } from './jobs/nightly';
import { accounts } from './routes/accounts';
import { categories } from './routes/categories';
import { exportsRoute } from './routes/exports';
import { imports } from './routes/imports';
import { recurring } from './routes/recurring';
import { reports } from './routes/reports';
import { review } from './routes/review';
import { rules } from './routes/rules';
import { settings } from './routes/settings';
import { transactions } from './routes/transactions';

export const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
  if (c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-store');
});

app.route('/auth', authRoutes);

const api = new Hono<AppEnv>();
api.use('*', requireUser, requireAppHeader);
api.get('/me', (c) => c.json(c.get('user')));
api.route('/accounts', accounts);
api.route('/categories', categories);
api.route('/transactions', transactions);
api.route('/imports', imports);
api.route('/review', review);
api.route('/rules', rules);
api.route('/recurring', recurring);
api.route('/reports', reports);
api.route('/settings', settings);
api.route('/export', exportsRoute);
app.route('/api', api);

app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid JSON body' }, 400);
  console.error(err);
  return c.json({ error: 'Something went wrong' }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly(env).then((r) => console.log('nightly', r)));
  },
} satisfies ExportedHandler<Env>;
