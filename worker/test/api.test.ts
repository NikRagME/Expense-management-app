import { beforeEach, describe, expect, it } from 'vitest';
import { parseStatement } from '../../shared/parsers';
import type { Env } from '../src/env';
import { app } from '../src/index';
import { runNightly } from '../src/jobs/nightly';
import { advance } from '../src/routes/recurring';
import { createTestD1 } from './d1';

const DAUGHTER = 'kid@example.com';
const PARENT = 'dad@example.com';

let env: Env;

function client(cookie = '') {
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { Cookie: cookie };
    if (method !== 'GET') headers['X-Requested-With'] = 'expense-app';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  };
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b: unknown = {}) => call('POST', p, b),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    put: (p: string, b: unknown) => call('PUT', p, b),
    del: (p: string) => call('DELETE', p),
  };
}

async function login(email = DAUGHTER) {
  const res = await app.request(`/auth/dev-login?email=${encodeURIComponent(email)}&name=${email.startsWith('dad') ? 'Dad' : 'Kid'}`, {}, env);
  expect(res.status).toBe(302);
  const cookie = res.headers.get('set-cookie')!.split(';')[0];
  return client(cookie);
}

async function hash(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** What the browser does: parse locally, send rows. */
async function importFile(api: ReturnType<typeof client>, accountId: string, text: string, opts: { preview?: boolean; mapping?: any } = {}) {
  const parsed = parseStatement(text, opts.mapping);
  const body = {
    accountId,
    fileName: 'statement.csv',
    fileHash: await hash(text),
    format: parsed.format,
    rows: parsed.rows,
    balance: parsed.balance ?? null,
    mapping: opts.mapping ?? null,
  };
  return api.post(opts.preview ? '/api/imports/preview' : '/api/imports', body);
}

async function setupAccounts(api: ReturnType<typeof client>) {
  const citi = (await api.post('/api/accounts', { name: 'Citi Checking', institution: 'Citibank', type: 'checking', startingBalance: { cents: 50000, asOf: '2026-09-30' } })).body.id;
  const sfcu = (await api.post('/api/accounts', { name: 'SFCU Checking', institution: 'SFCU', type: 'checking', startingBalance: { cents: 20000, asOf: '2026-09-30' } })).body.id;
  const card = (await api.post('/api/accounts', { name: 'SFCU Card', institution: 'SFCU', type: 'credit_card', startingBalance: { cents: -10000, asOf: '2026-09-30' } })).body.id;
  const venmo = (await api.post('/api/accounts', { name: 'Venmo', institution: 'Venmo', type: 'payment_app', startingBalance: { cents: 2400, asOf: '2026-09-30' } })).body.id;
  await api.patch('/api/settings', { parentZelleNames: ['Jordan'] });
  return { citi, sfcu, card, venmo };
}

const CITI_CSV = `Status,Date,Description,Debit,Credit
Cleared,10/01/2026,ZELLE FROM JORDAN R,,300.00
Cleared,10/05/2026,SFCU VISA PMT,100.00,
Cleared,10/13/2026,VENMO PAYMENT 1023,36.00,
Cleared,10/14/2026,TRADER JOE S #123 PALO ALTO CA,45.10,
`;

const CARD_CSV = `Posted Date,Description,Amount
10/06/2026,PAYMENT THANK YOU,-100.00
10/08/2026,SQ *BLUE BOTTLE 0423 PALO ALTO CA,6.50
10/09/2026,MYSTERY SHOP 991,20.00
`;
const CARD_MAPPING = { skipRows: 0, hasHeader: true, dateCol: 0, descriptionCol: 1, amountCol: 2, sign: 'inverted', dateFormat: 'auto' };

const VENMO_CSV = `,ID,Datetime,Type,Status,Note,From,To,Amount (total),Funding Source,Destination,Beginning Balance,Ending Balance
,,,,,,,,,,,$24.00,
,4001,2026-10-13T19:02:11,Payment,Complete,pizza night,Kid R,Maya L,- $36.00,Citibank Checking *1234,,,
,4002,2026-10-14T09:15:40,Payment,Complete,pizza night,Maya L,Kid R,+ $18.00,,Venmo balance,,
,,,,,,,,,,,,$42.00
`;

beforeEach(() => {
  env = {
    DB: createTestD1(),
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'secret',
    ALLOWED_USERS: `${DAUGHTER}:daughter,${PARENT}:parent`,
    DEV_LOGIN: 'true',
  };
});

describe('auth', () => {
  it('requires a session and the app header', async () => {
    expect((await client().get('/api/me')).status).toBe(401);
    const api = await login();
    expect((await api.get('/api/me')).body).toMatchObject({ email: DAUGHTER, role: 'daughter' });
    const noHeader = await app.request('/api/accounts', { method: 'POST', headers: { Cookie: '' } }, env);
    expect(noHeader.status).toBe(401);
  });

  it('rejects emails not on the allow-list, and locks out removed users', async () => {
    const res = await app.request('/auth/dev-login?email=stranger@example.com', {}, env);
    expect(res.status).toBe(403);
    const api = await login(PARENT);
    env.ALLOWED_USERS = `${DAUGHTER}:daughter`;
    expect((await api.get('/api/me')).status).toBe(403);
  });

  it('disables dev login outside development', async () => {
    env.DEV_LOGIN = 'false';
    expect((await app.request('/auth/dev-login', {}, env)).status).toBe(404);
  });

  it('starts the Google flow with state', async () => {
    const res = await app.request('https://app.example.com/auth/login', {}, env);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.hostname).toBe('accounts.google.com');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://app.example.com/auth/callback');
    expect(res.headers.get('set-cookie')).toMatch(/oauth_state=.*HttpOnly/i);
    const bad = await app.request('https://app.example.com/auth/callback?code=x&state=wrong', {}, env);
    expect(bad.headers.get('location')).toBe('/login?error=state');
  });

  it('enforces the CSRF header on writes', async () => {
    const api = await login();
    const cookie = (await app.request(`/auth/dev-login?email=${DAUGHTER}`, {}, env)).headers.get('set-cookie')!.split(';')[0];
    const res = await app.request('/api/accounts', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' }, env);
    expect(res.status).toBe(403);
    expect((await api.get('/api/accounts')).status).toBe(200);
  });
});

describe('accounts, manual entry, categories and splits', () => {
  it('adds accounts any time, with balances', async () => {
    const api = await login();
    const { citi } = await setupAccounts(api);
    const list = (await api.get('/api/accounts')).body;
    expect(list.map((a: any) => a.name)).toEqual(['Citi Checking', 'SFCU Checking', 'SFCU Card', 'Venmo', 'Paid by parent']);
    expect(list[0]).toMatchObject({ balanceCents: 50000, balanced: null });
    expect((await api.post('/api/accounts', { name: 'X', type: 'parent_paid' })).status).toBe(400);
    await api.patch(`/api/accounts/${citi}`, { archived: true });
    expect((await api.get('/api/accounts')).body.find((a: any) => a.id === citi).archived).toBe(true);
  });

  it('quick-adds a spend, categorises it with a rule, and records who edited it', async () => {
    const kid = await login();
    const { card } = await setupAccounts(kid);
    const a = (await kid.post('/api/transactions', { accountId: card, date: '2026-10-02', amountCents: -1250, description: 'Campus Bookshop', categoryId: null })).body;
    expect(a).toMatchObject({ kind: 'spend', needsAttention: 'uncategorized', source: 'manual' });
    const b = (await kid.post('/api/transactions', { accountId: card, date: '2026-10-03', amountCents: -900, description: 'Campus Bookshop', categoryId: null })).body;

    const dad = await login(PARENT);
    const updated = (await dad.patch(`/api/transactions/${a.id}`, { categoryId: 'books', createRule: true })).body;
    expect(updated).toMatchObject({ needsAttention: null, updatedByName: 'Dad' });
    expect(updated.lines[0].categoryId).toBe('books');
    // The rule also fixed the other uncategorised one from the same merchant.
    expect((await kid.get(`/api/transactions/${b.id}`)).body).toMatchObject({ needsAttention: null, lines: [{ categoryId: 'books' }] });
    expect((await kid.get('/api/rules')).body).toHaveLength(1);
    const detail = (await kid.get(`/api/transactions/${a.id}`)).body;
    expect(detail.history[0]).toMatchObject({ action: 'update', userName: 'Dad' });
  });

  it('splits and un-splits a purchase', async () => {
    const api = await login();
    const { card } = await setupAccounts(api);
    const tx = (await api.post('/api/transactions', { accountId: card, date: '2026-10-02', amountCents: -5000, description: 'Target', categoryId: 'groceries' })).body;
    expect((await api.put(`/api/transactions/${tx.id}/splits`, { parts: [{ amountCents: -3000, categoryId: 'groceries' }, { amountCents: -1000, categoryId: 'clothing' }] })).status).toBe(400);
    const split = (await api.put(`/api/transactions/${tx.id}/splits`, { parts: [{ amountCents: -3000, categoryId: 'groceries' }, { amountCents: -2000, categoryId: 'clothing' }] })).body;
    expect(split.lines.map((l: any) => [l.categoryId, l.amountCents])).toEqual([
      ['groceries', -3000],
      ['clothing', -2000],
    ]);
    const overview = (await api.get('/api/reports/overview?from=2026-10-01&to=2026-10-31')).body;
    expect(overview.spendingCents).toBe(5000);
    const food = overview.groups.find((g: any) => g.id === 'food');
    expect(food.categories[0]).toMatchObject({ id: 'groceries', cents: 3000 });
    expect((await api.patch(`/api/transactions/${tx.id}`, { categoryId: 'misc' })).status).toBe(400);
    const list = (await api.get('/api/transactions?categoryId=clothing')).body;
    expect(list).toMatchObject({ count: 1, spendingCents: 2000 });
    const unsplit = (await api.del(`/api/transactions/${tx.id}/splits`)).body;
    expect(unsplit.lines).toEqual([expect.objectContaining({ categoryId: 'groceries', amountCents: -5000 })]);
  });
});

describe('statement import', () => {
  it('previews exactly what it commits, then skips duplicates on re-import', async () => {
    const api = await login();
    const { citi } = await setupAccounts(api);
    const preview = (await importFile(api, citi, CITI_CSV, { preview: true })).body;
    expect(preview.summary).toMatchObject({ total: 4, new: 4, duplicates: 0 });
    expect((await api.get('/api/transactions')).body.count).toBe(0);

    const committed = (await importFile(api, citi, CITI_CSV)).body;
    expect(committed.summary).toEqual(preview.summary);
    expect(committed.rows.map((r: any) => r.kind)).toEqual(['income', 'transfer', 'transfer', 'spend']);
    expect(committed.rows[3]).toMatchObject({ description: "Trader Joe's", categoryId: 'groceries' });

    const again = (await importFile(api, citi, CITI_CSV)).body;
    expect(again).toMatchObject({ alreadyImported: true, summary: { new: 0, duplicates: 4 } });
  });

  it('matches card payments, Venmo funding and checks balances across accounts', async () => {
    const api = await login();
    const { citi, card, venmo } = await setupAccounts(api);
    await importFile(api, citi, CITI_CSV);
    const cardImport = (await importFile(api, card, CARD_CSV, { mapping: CARD_MAPPING })).body;
    expect(cardImport.summary).toMatchObject({ new: 3, transfersMatched: 1, needsAttention: 1 });
    expect((await api.get('/api/accounts')).body.find((a: any) => a.id === card).importMapping).toMatchObject({ sign: 'inverted' });

    const venmoImport = (await importFile(api, venmo, VENMO_CSV)).body;
    expect(venmoImport.summary).toMatchObject({ new: 3, transfersMatched: 1 });
    // Ending balance $42 = $24 + 36 (funding) - 36 (pizza) + 18 (Maya) → balanced ✓
    expect(venmoImport.balance).toMatchObject({ cents: 4200, differenceCents: 0 });

    const accounts = (await api.get('/api/accounts')).body;
    expect(accounts.find((a: any) => a.id === citi)).toMatchObject({ balanceCents: 50000 + 30000 - 10000 - 3600 - 4510 });
    expect(accounts.find((a: any) => a.id === card)).toMatchObject({ balanceCents: -10000 + 10000 - 650 - 2000 });
    expect(accounts.find((a: any) => a.id === venmo)).toMatchObject({ balanceCents: 4200, balanced: true });

    // A wrong typed-in balance is flagged, never absorbed.
    const check = (await api.post(`/api/accounts/${citi}/balance`, { cents: 61000, asOf: '2026-10-31' })).body;
    expect(check).toMatchObject({ computedCents: 61890, differenceCents: -890 });
    expect((await api.get('/api/accounts')).body.find((a: any) => a.id === citi)).toMatchObject({ balanceCents: 61000, balanced: false });
  });

  it('handles the shared Venmo dinner end to end (flow F3)', async () => {
    const api = await login();
    const { citi, venmo } = await setupAccounts(api);
    await importFile(api, citi, CITI_CSV);
    await importFile(api, venmo, VENMO_CSV);

    const queue = (await api.get('/api/review')).body.items;
    const maya = queue.find((t: any) => t.needsAttention === 'venmo_incoming');
    expect(maya).toMatchObject({ amountCents: 1800, counterparty: 'Maya L' });
    const pizza = maya.repaymentCandidates.find((t: any) => t.amountCents === -3600);
    expect(pizza).toMatchObject({ lines: [{ categoryId: 'eating_out' }] });

    const res = (await api.post(`/api/review/${maya.id}/resolve`, { action: 'repayment', spendId: pizza.id })).body;
    expect(res.transaction).toMatchObject({ kind: 'repayment', needsAttention: null, lines: [{ categoryId: 'eating_out' }] });

    const o = (await api.get('/api/reports/overview?from=2026-10-01&to=2026-10-31')).body;
    const eatingOut = o.groups.find((g: any) => g.id === 'food').categories.find((c: any) => c.id === 'eating_out');
    expect(eatingOut.cents).toBe(1800); // her real share
    expect(o.moneyInCents).toBe(30000); // allowance only; transfers and repayment excluded
    expect(o.spendingCents).toBe(1800 + 4510);
  });

  it('undoes an import and re-pairs what is left', async () => {
    const api = await login();
    const { citi, card } = await setupAccounts(api);
    await importFile(api, citi, CITI_CSV);
    const cardImport = (await importFile(api, card, CARD_CSV, { mapping: CARD_MAPPING })).body;
    expect((await api.post(`/api/imports/${cardImport.id}/undo`)).body).toEqual({ removed: 3 });
    expect((await api.post(`/api/imports/${cardImport.id}/undo`)).status).toBe(409);
    expect((await api.get(`/api/transactions?accountId=${card}`)).body.count).toBe(0);
    // Re-import pairs the payment again.
    expect((await importFile(api, card, CARD_CSV, { mapping: CARD_MAPPING })).body.summary).toMatchObject({ new: 3, transfersMatched: 1 });
  });

  it('suggests merging a quick-add with the bank line (A3)', async () => {
    const api = await login();
    const { card } = await setupAccounts(api);
    const manual = (await api.post('/api/transactions', { accountId: card, date: '2026-10-07', amountCents: -650, description: 'Coffee w/ Sam', categoryId: 'going_out', note: 'study break' })).body;
    const imp = (await importFile(api, card, CARD_CSV, { mapping: CARD_MAPPING })).body;
    expect(imp.rows.find((r: any) => r.amountCents === -650).needsAttention).toBe('possible_merge');

    const item = (await api.get('/api/review')).body.items.find((t: any) => t.needsAttention === 'possible_merge');
    expect(item.mergeWith.id).toBe(manual.id);
    const merged = (await api.post(`/api/review/${item.id}/resolve`, { action: 'merge' })).body.transaction;
    expect(merged).toMatchObject({ source: 'import', description: 'Coffee w/ Sam', note: 'study break', lines: [{ categoryId: 'going_out' }], needsAttention: null });
    expect((await api.get(`/api/transactions/${manual.id}`)).status).toBe(404);
  });

  it('resolves review cards and reports a remaining count', async () => {
    const api = await login();
    const { card } = await setupAccounts(api);
    await importFile(api, card, CARD_CSV, { mapping: CARD_MAPPING });
    const mystery = (await api.get('/api/review')).body.items.find((t: any) => t.description.startsWith('Mystery'));
    const res = (await api.post(`/api/review/${mystery.id}/resolve`, { action: 'categorize', categoryId: 'misc', always: true })).body;
    // The card payment's bank side was never imported, so after 7 days it shows as unmatched.
    expect(res).toMatchObject({ transaction: { needsAttention: null }, remaining: 1 });
    const unmatched = (await api.get('/api/review')).body.items[0];
    expect(unmatched).toMatchObject({ needsAttention: 'transfer_unmatched', amountCents: 10000 });
    expect((await api.post(`/api/review/${unmatched.id}/resolve`, { action: 'dismiss' })).body.remaining).toBe(0);
  });
});

describe('parent-paid costs, overview, export and nightly job', () => {
  it('adds recurring parent-paid costs into cost of living', async () => {
    const dad = await login(PARENT);
    await setupAccounts(dad);
    await dad.post('/api/recurring', { name: 'Phone plan', amountCents: 4500, categoryId: 'phone_internet', frequency: 'monthly', nextDate: '2026-09-15' });
    // Catches up: Sep 15 and Oct 15 (and any later months up to today).
    const generated = (await dad.get('/api/transactions?parentPaid=1&from=2026-09-01&to=2026-10-31')).body;
    expect(generated.items.map((t: any) => t.date)).toEqual(['2026-10-15', '2026-09-15']);
    await dad.post('/api/transactions', { accountId: 'parent_paid', date: '2026-10-03', amountCents: -8900, description: 'Textbook', categoryId: 'books' });

    const o = (await dad.get('/api/reports/overview?from=2026-10-01&to=2026-10-31')).body;
    expect(o).toMatchObject({ spendingCents: 0, parentPaidCents: 13400, costOfLivingCents: 13400 });
    expect(o.groupsWithParent.find((g: any) => g.id === 'home').cents).toBe(4500);
    expect(o.groups).toEqual([]);
    // Running the nightly job again must not duplicate entries.
    await runNightly(env);
    expect((await dad.get('/api/transactions?parentPaid=1&from=2026-09-01&to=2026-10-31')).body.count).toBe(3);
  });

  it('advances recurring dates sensibly', () => {
    expect(advance('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(advance('2026-10-15', 'weekly', 2)).toBe('2026-10-29');
    expect(advance('2026-08-20', 'yearly', 1)).toBe('2027-08-20');
  });

  it('shows previous-period comparison, freshness and net position', async () => {
    const api = await login();
    const { citi } = await setupAccounts(api);
    await importFile(api, citi, CITI_CSV);
    const o = (await api.get('/api/reports/overview?from=2026-10-01&to=2026-10-31')).body;
    expect(o.previous).toMatchObject({ from: '2026-09-01', to: '2026-09-30', spendingCents: 0 });
    expect(o.freshness.find((f: any) => f.accountId === citi)).toMatchObject({ stale: false, daysSinceImport: 0 });
    expect(o.freshness.find((f: any) => f.name === 'Venmo').stale).toBe(true);
    expect(o.netPositionCents).toBe(61890 + 20000 - 10000 + 2400);
    expect((await api.get('/api/reports/overview?from=2026-10-31&to=2026-10-01')).status).toBe(400);
  });

  it('exports CSV and a full JSON backup', async () => {
    const api = await login();
    const { citi } = await setupAccounts(api);
    await importFile(api, citi, CITI_CSV);
    const csv = (await api.get('/api/export/transactions.csv')).body as string;
    expect(csv.split('\n')[0]).toMatch(/^date,account,description/);
    expect(csv).toContain("Trader Joe's");
    const backup = (await api.get('/api/export/backup.json')).body;
    expect(backup.tables.transactions).toHaveLength(4);
    expect(backup.tables.sessions).toBeUndefined();
  });
});
