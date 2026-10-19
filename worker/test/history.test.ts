/**
 * History setup end to end (spec §12): opening day → Citi PDF statement →
 * her spreadsheet matched onto the bank lines → Review → exact undo.
 * Data is made up but shaped like her real Citi statement and tracking sheet.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ParsedRow } from '../../shared/types';
import type { Env } from '../src/env';
import { app } from '../src/index';
import { createTestD1 } from './d1';

let env: Env;

function api(cookie: string) {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(
      path,
      {
        method,
        headers: { Cookie: cookie, ...(method !== 'GET' ? { 'X-Requested-With': 'expense-app' } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      env,
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  return { get: (p: string) => call('GET', p), post: (p: string, b: unknown = {}) => call('POST', p, b), put: (p: string, b: unknown) => call('PUT', p, b), patch: (p: string, b: unknown) => call('PATCH', p, b) };
}

async function login() {
  const res = await app.request('/auth/dev-login?email=dad@example.com&name=Dad', {}, env);
  return api(res.headers.get('set-cookie')!.split(';')[0]);
}

const checkingRows: ParsedRow[] = [
  { date: '2026-09-11', amountCents: 50000, description: 'Zelle from JORDAN RIVER', counterparty: 'Jordan River' },
  { date: '2026-09-11', amountCents: 3480500, description: 'Transfer From Money Market' },
  { date: '2026-09-14', amountCents: -5024, description: 'WAL-MART MOUNTAIN VIEWCAUS05154' },
  { date: '2026-09-15', amountCents: -3480500, description: 'ACH Stanford Univ Stanford' },
  { date: '2026-09-21', amountCents: -600, description: 'Zelle to CASEY KIM', counterparty: 'Casey Kim' },
  { date: '2026-09-24', amountCents: -10000, description: 'Zelle to Alex River', counterparty: 'Alex River' },
  { date: '2026-09-28', amountCents: 200, description: 'Zelle from Jordan Tyler', counterparty: 'Jordan Tyler' },
  { date: '2026-09-29', amountCents: -1497, description: 'UBER *TRIP HELP.UBER.C 8005928996 CA 26271' },
  { date: '2026-09-29', amountCents: -2444, description: 'COUPA CAFE 4 STANFORD CA 26271', categoryHint: 'eating_out' },
];
const savingsRows: ParsedRow[] = [
  { date: '2026-09-11', amountCents: 3500000, description: 'Deposit Teller' },
  { date: '2026-09-11', amountCents: -3480500, description: 'Transfer to Checking' },
];

const statement = (accountId: string, rows: ParsedRow[], name: string) => ({
  accountId,
  fileName: 'October2026.pdf',
  fileHash: `hash-of-pdf-${name}`,
  format: 'pdf',
  rows,
  openingBalance: { asOf: '2026-09-08', cents: 0 },
  balance: { asOf: '2026-10-01', cents: rows.reduce((a, r) => a + r.amountCents, 0) },
});

const sheetRow = (sheet: string, rowNumber: number, date: string, amountCents: number, description: string, categoryLabel: string, accountIds: string[], note = '') => ({
  sheet,
  rowNumber,
  date,
  amountCents,
  description,
  categoryLabel,
  accountLabel: '',
  note,
  accountIds,
});

beforeEach(() => {
  env = { DB: createTestD1(), GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', ALLOWED_USERS: 'dad@example.com:parent', DEV_LOGIN: 'true' };
});

async function setUp() {
  const dad = await login();
  const add = async (name: string, type: string) => (await dad.post('/api/accounts', { name, institution: 'x', type })).body.id as string;
  const ids = { citi: await add('Citi Checking', 'checking'), save: await add('Citi Savings', 'savings'), card: await add('SFCU Card', 'credit_card') };
  await dad.patch('/api/settings', { parentZelleNames: ['Jordan Riverton'], ownNames: ['Alex Riverton'] });
  return { dad, ids };
}

describe('history setup', () => {
  it('imports a PDF statement from opening day and reconciles it', async () => {
    const { dad, ids } = await setUp();
    const r1 = await dad.post('/api/imports', statement(ids.citi, checkingRows, 'chk'));
    expect(r1.status).toBe(201);
    expect(r1.body.openingBalance).toMatchObject({ cents: 0, differenceCents: null });
    expect(r1.body.balance).toMatchObject({ differenceCents: 0 });
    expect(r1.body.rows.map((r: any) => r.kind)).toEqual(['income', 'transfer', 'spend', 'parent_paid', 'spend', 'transfer', 'repayment', 'spend', 'spend']);
    await dad.post('/api/imports', statement(ids.save, savingsRows, 'sav'));

    // The statement told us when the account opened, and covers it from then.
    const setup = (await dad.get('/api/setup')).body;
    const citi = setup.accounts.find((a: any) => a.id === ids.citi);
    expect(citi).toMatchObject({ openedOn: '2026-09-09', ranges: [{ from: '2026-09-09', to: '2026-10-01' }], gaps: [], balanced: true });

    // Tuition is cost of living, not her spending; the deposit for it is money from parent.
    const deposit = (await dad.get('/api/review')).body.items.find((t: any) => t.description === 'Deposit Teller');
    expect(deposit.needsAttention).toBe('unknown_inflow');
    await dad.post(`/api/review/${deposit.id}/resolve`, { action: 'parent_funding' });
    const o = (await dad.get('/api/reports/overview?from=2026-09-01&to=2026-09-30')).body;
    // The $2 from a friend counts as paying her back until she answers its Review card.
    expect(o.spendingCents).toBe(5024 + 600 + 1497 + 2444 - 200);
    expect(o.parentPaidCents).toBe(3480500);
    expect(o.moneyInCents).toBe(50000);
    // Re-importing the same period as a CSV download doesn't double up.
    const csvAgain = await dad.post('/api/imports/preview', { ...statement(ids.citi, checkingRows.map((r) => ({ ...r, description: r.description.toUpperCase() + ' CSV' })), 'csv'), format: 'csv', fileHash: 'csv-hash-123' });
    expect(csvAgain.body.summary).toMatchObject({ new: 0, duplicates: checkingRows.length });
  });

  it('matches her spreadsheet onto bank lines, adds what has no bank line, and undoes exactly', async () => {
    const { dad, ids } = await setUp();
    await dad.post('/api/imports', statement(ids.citi, checkingRows, 'chk'));
    // She already fixed this one in Pocket: the spreadsheet must not overwrite it.
    const coupa = (await dad.get('/api/transactions?q=coupa')).body.items[0];
    await dad.patch(`/api/transactions/${coupa.id}`, { categoryId: 'coffee_snacks' });
    const before = (await dad.get('/api/transactions?limit=100')).body.items;

    const body = {
      fileName: 'Freshman Expenses.xlsx',
      fileHash: 'sheet-hash-1',
      categoryMap: { OoB: 'parent_pays', Miscellanous: 'misc', Food: 'auto', Clothes: 'clothing', 'PAYMENT IN': 'auto' },
      accountAliases: { 'SFCU Credit': ids.card },
      rows: [
        sheetRow('Citi', 5, '2026-09-14', -5000, 'Walmart', 'Miscellanous', [ids.citi, ids.save]),
        sheetRow('Citi', 6, '2026-09-21', -600, 'Fake Reeses', 'OoB', [ids.citi, ids.save], 'for Casey'),
        sheetRow('Citi', 7, '2026-09-28', -1497, 'Uber to PA', 'OoB', [ids.citi, ids.save]),
        sheetRow('Citi', 8, '2026-09-28', -2444, 'Coupa w Sam', 'Food', [ids.citi, ids.save]),
        sheetRow('Citi', 9, '2026-10-01', 50000, 'Initial Budget', 'PAYMENT IN', [ids.citi, ids.save]),
        sheetRow('Budget', 7, '2026-10-04', -3533, 'Depop Polo Sweater', 'Clothes', [ids.card]),
        sheetRow('Budget', 8, '2026-10-05', -1482, 'Coupa Lunch', 'Food', [ids.card]),
      ],
    };
    const preview = (await dad.post('/api/history/preview', body)).body;
    expect(preview.summary).toMatchObject({ total: 7, matched: 4, added: 2, unmatched: 1, amountDiffers: 1, keptPocketChoices: 1 });
    expect(preview.rows.find((r: any) => r.description === 'Initial Budget')).toMatchObject({ status: 'unmatched', reason: 'not_on_statement' });

    const applied = await dad.post('/api/history', body);
    expect(applied.status).toBe(201);
    const tx = async (q: string) => (await dad.get(`/api/transactions?q=${encodeURIComponent(q)}`)).body.items[0];

    expect(await tx('Walmart')).toMatchObject({ description: 'Walmart', amountCents: -5024, kind: 'spend', lines: [{ categoryId: 'misc' }] });
    const reeses = await tx('Fake Reeses');
    // Out of budget, so paid by parent; Pocket still asks what it was for (no shop to guess from).
    expect(reeses).toMatchObject({ kind: 'parent_paid', note: 'for Casey', needsAttention: 'uncategorized', lines: [{ budgetScope: 'outside' }] });
    expect(await tx('Uber to PA')).toMatchObject({ kind: 'parent_paid', needsAttention: null, lines: [{ categoryId: 'rideshare', budgetScope: 'outside' }] });
    expect(await tx('Coupa')).toMatchObject({ lines: [{ categoryId: 'coffee_snacks' }] }); // Pocket choice kept
    expect(await tx('Depop')).toMatchObject({ accountId: ids.card, amountCents: -3533, fromSpreadsheet: true, lines: [{ categoryId: 'clothing' }] });

    // Unmatched rows wait in Review.
    const review = (await dad.get('/api/review')).body;
    const initial = review.sheetRows.find((r: any) => r.description === 'Initial Budget');
    expect(initial).toBeTruthy();
    const cands = (await dad.get(`/api/history/rows/${initial.id}/candidates`)).body;
    expect(cands.map((c: any) => c.amountCents)).toContain(50000);
    expect((await dad.post(`/api/history/rows/${initial.id}/resolve`, { action: 'skip' })).body.remaining).toBe(0);

    // Mappings are remembered for next time.
    expect((await dad.get('/api/history/mappings')).body).toMatchObject({ categories: { OoB: 'parent_pays' }, accounts: { 'SFCU Credit': ids.card } });

    // Exact undo.
    expect((await dad.post(`/api/history/${applied.body.id}/undo`)).body).toMatchObject({ removed: 2 });
    const after = (await dad.get('/api/transactions?limit=100')).body.items;
    const pick = (t: any) => ({ id: t.id, kind: t.kind, description: t.description, note: t.note, needsAttention: t.needsAttention, lines: t.lines.map((l: any) => [l.categoryId, l.amountCents, l.budgetScope]) });
    expect(after.map(pick)).toEqual(before.map(pick));
    // And it can be applied again afterwards (nothing left half-matched).
    expect((await dad.post('/api/history/preview', body)).body.summary.matched).toBe(4);
  });

  it('suggests rules from consistent categories and sets opening days by hand', async () => {
    const { dad, ids } = await setUp();
    await dad.put(`/api/accounts/${ids.card}/opening`, { openedOn: '2026-09-20', cents: 0 });
    let setup = (await dad.get('/api/setup')).body;
    expect(setup.accounts.find((a: any) => a.id === ids.card)).toMatchObject({ openedOn: '2026-09-20', openingBalanceCents: 0 });
    // Change it: the earlier opening balance is replaced, not duplicated.
    await dad.put(`/api/accounts/${ids.card}/opening`, { openedOn: '2026-09-21', cents: 0 });
    setup = (await dad.get('/api/setup')).body;
    expect(setup.accounts.find((a: any) => a.id === ids.card).openedOn).toBe('2026-09-21');

    await dad.post('/api/imports', {
      ...statement(ids.card, [
        { date: '2026-10-02', amountCents: -515, description: 'MYSTERY BAKERY 1' },
        { date: '2026-10-06', amountCents: -680, description: 'MYSTERY BAKERY 1' },
      ], 'card'),
      openingBalance: null,
      balance: null,
    });
    const body = {
      fileName: 'f.xlsx',
      fileHash: 'sheet-hash-2',
      categoryMap: { Treats: 'coffee_snacks' },
      accountAliases: {},
      rows: [sheetRow('Budget', 2, '2026-10-02', -515, 'Bakery', 'Treats', [ids.card]), sheetRow('Budget', 3, '2026-10-06', -680, 'Bakery', 'Treats', [ids.card])],
    };
    const applied = (await dad.post('/api/history', body)).body;
    const suggestions = (await dad.get(`/api/history/${applied.id}/rule-suggestions`)).body;
    expect(suggestions).toEqual([{ merchant: 'Mystery Bakery', categoryId: 'coffee_snacks', count: 2 }]);
    expect((await dad.post(`/api/history/${applied.id}/rules`, { rules: suggestions })).body).toEqual({ created: 1 });
    expect((await dad.get('/api/rules')).body).toHaveLength(1);
  });
});
