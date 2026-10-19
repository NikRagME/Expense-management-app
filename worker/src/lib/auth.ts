/**
 * Google sign-in (OAuth authorization-code flow with full-page redirects, which
 * work inside an iPhone home-screen app) + our own session cookie (architecture §9).
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Env, User } from '../env';
import { first, nowIso, stmt, uuid } from './db';

const SESSION_COOKIE = 'sid';
const STATE_COOKIE = 'oauth_state';
const SESSION_DAYS = 60;

export function allowedUsers(env: Env): { email: string; role: User['role'] }[] {
  return (env.ALLOWED_USERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [email, role] = pair.split(':').map((x) => x.trim());
      return { email: email.toLowerCase(), role: role === 'parent' ? 'parent' : 'daughter' } as const;
    });
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1] ?? '';
  const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))));
}

const secureCookies = (url: string) => new URL(url).protocol === 'https:';

/** Find or create the user for an allow-listed email; null if not allowed. */
async function userForEmail(env: Env, email: string, name: string): Promise<User | null> {
  const allowed = allowedUsers(env).find((u) => u.email === email.toLowerCase());
  if (!allowed) return null;
  const existing = await first<User>(env.DB, 'SELECT id, email, name, role FROM users WHERE email = ?', email);
  if (existing) {
    if (existing.role !== allowed.role || (name && existing.name !== name)) {
      await stmt(env.DB, 'UPDATE users SET role = ?, name = ? WHERE id = ?', allowed.role, name || existing.name, existing.id).run();
    }
    return { ...existing, role: allowed.role, name: name || existing.name };
  }
  const user: User = { id: uuid(), email: email.toLowerCase(), name, role: allowed.role };
  await stmt(env.DB, 'INSERT INTO users (id, email, name, role) VALUES (?, ?, ?, ?)', user.id, user.email, user.name, user.role).run();
  return user;
}

async function startSession(c: Parameters<MiddlewareHandler<AppEnv>>[0], user: User) {
  const id = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await stmt(c.env.DB, 'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)', id, user.id, expires.toISOString()).run();
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    secure: secureCookies(c.req.url),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/login', (c) => {
  const state = randomToken();
  setCookie(c, STATE_COOKIE, state, { httpOnly: true, secure: secureCookies(c.req.url), sameSite: 'Lax', path: '/auth', maxAge: 600 });
  const origin = new URL(c.req.url).origin;
  const params = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

authRoutes.get('/callback', async (c) => {
  const { code, state, error } = c.req.query();
  const expected = getCookie(c, STATE_COOKIE);
  deleteCookie(c, STATE_COOKIE, { path: '/auth' });
  if (error) return c.redirect('/login?error=cancelled');
  if (!code || !state || !expected || state !== expected) return c.redirect('/login?error=state');

  const origin = new URL(c.req.url).origin;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: c.env.GOOGLE_CLIENT_ID,
      client_secret: c.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${origin}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return c.redirect('/login?error=google');
  const token = (await res.json()) as { id_token?: string };
  if (!token.id_token) return c.redirect('/login?error=google');

  // The ID token came straight from Google's token endpoint over TLS, so its
  // claims can be trusted without re-verifying the signature (OpenID Connect §3.1.3.7).
  const claims = decodeJwtPayload(token.id_token);
  const iss = String(claims.iss ?? '');
  const valid =
    (iss === 'https://accounts.google.com' || iss === 'accounts.google.com') &&
    claims.aud === c.env.GOOGLE_CLIENT_ID &&
    Number(claims.exp ?? 0) * 1000 > Date.now() &&
    claims.email_verified === true &&
    typeof claims.email === 'string';
  if (!valid) return c.redirect('/login?error=google');

  const user = await userForEmail(c.env, claims.email as string, String(claims.given_name ?? claims.name ?? ''));
  if (!user) return c.redirect('/login?error=private');
  await startSession(c, user);
  return c.redirect('/');
});

/** Local development and automated tests only. */
authRoutes.get('/dev-login', async (c) => {
  if (c.env.DEV_LOGIN !== 'true') return c.notFound();
  const email = c.req.query('email') ?? allowedUsers(c.env)[0]?.email ?? '';
  const user = await userForEmail(c.env, email, c.req.query('name') ?? email.split('@')[0]);
  if (!user) return c.text('Not on the allow-list', 403);
  await startSession(c, user);
  return c.redirect('/');
});

authRoutes.post('/logout', async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await stmt(c.env.DB, 'DELETE FROM sessions WHERE id = ?', sid).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.post('/logout-everywhere', async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  const session = sid ? await first<{ user_id: string }>(c.env.DB, 'SELECT user_id FROM sessions WHERE id = ?', sid) : null;
  if (session) await stmt(c.env.DB, 'DELETE FROM sessions WHERE user_id = ?', session.user_id).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

/** Require a valid session from an allow-listed user; extend it while in use. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return c.json({ error: 'Not signed in' }, 401);
  const row = await first<User & { expires_at: string; last_seen_at: string }>(
    c.env.DB,
    `SELECT u.id, u.email, u.name, u.role, s.expires_at, s.last_seen_at
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    sid,
  );
  if (!row || Date.parse(row.expires_at) < Date.now()) return c.json({ error: 'Session expired' }, 401);
  // Removing someone from ALLOWED_USERS locks them out immediately.
  if (!allowedUsers(c.env).some((u) => u.email === row.email.toLowerCase())) return c.json({ error: 'Not allowed' }, 403);

  if (Date.now() - Date.parse(`${row.last_seen_at}Z`) > 86_400_000) {
    const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    await stmt(c.env.DB, 'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', nowIso(), expires, sid).run();
  }
  c.set('user', { id: row.id, email: row.email, name: row.name, role: row.role });
  await next();
};

/** CSRF defence alongside SameSite cookies: state-changing calls must carry our header. */
export const requireAppHeader: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.header('X-Requested-With') !== 'expense-app') {
    return c.json({ error: 'Missing X-Requested-With header' }, 403);
  }
  await next();
};
