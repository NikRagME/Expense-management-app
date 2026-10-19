import { describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES, DEFAULT_GROUPS } from './categories';
import { findTables, matchRows, similarity, suggestAccount, suggestCategory, tableRows, type MatchCandidate, type MatchRow } from './history';
import { excelSerialToIso, readXlsx } from './parsers/xlsx';
import { writeXlsx, type Cell } from './testing/xlsxWriter';

/** Made-up data laid out like her Google Sheet: a charts area, the expenses table, side tables. */
const budgetTab: Cell[][] = [
  ['Budget Tracker', null, null, null, null, null, 'Bankwise Spending'],
  [null, 'START', 'END', 'OoB'],
  [null, 350, 86.46, 385.78],
  [],
  ['Expenses'],
  ['Date', 'Amount', 'Description', 'Category', 'Account', null, 'SFCU CHECKING', 'CITI CHECKING'],
  [{ date: '2026-10-02' }, 5.15, 'Coupa Coffee', 'Food', 'SFCU Credit', null, 384.79, 196.61],
  [{ date: '2026-10-04' }, 45, 'Big Game Tickets', 'OoB', 'SFCU Credit', null, 'Recurring Bills and Dates'],
  [{ date: '2026-10-04' }, 200, 'Run Club', 'OoB', 'Citi Saving', null, 'BILL', 'AMOUNT', 'DATE', 'BANK'],
  [{ date: '2026-10-09' }, 21.47, 'Trader Joes', 'Groceries', 'SFCU Credit', null, 'Verizon', '51.31', '28th', 'Citi Checking'],
  [{ date: '2026-10-16' }, -209.08, 'Pay off CC', 'PP', 'SFCU Credit'],
  [{ date: '2026-10-17' }, 26.02, 'Black jacket Depop', 'Clothes/Jewellry', 'SFCU Credit'],
  [{ date: '2026-10-26' }],
];

const citiTab: Cell[][] = [
  ['Citi Checking & Saving Balance'],
  [null, 'GIVEN', 'REMAINING'],
  [],
  ['Date', 'Amount', 'Description', 'Category', 'One Time'],
  ['10/1/2026', '$500.00', 'Initial Budget', 'PAYMENT IN'],
  ['9/14/2026', '$50.00', 'Walmart', 'PAYMENT OUT'],
  ['9/21/2026', '$6.00', 'Fake Reeses', 'PAYMENT OUT'],
  ['9/29/2026', '$1.00', 'Icloud', 'PAYMENT OUT'],
  ['10/1/2026', '$200.00', 'Run club dues', 'PAYMENT OUT'],
];

describe('xlsx reader', () => {
  it('reads sheets, strings, numbers and date-formatted cells', async () => {
    const sheets = await readXlsx(await writeXlsx([{ name: 'Budget Tracker', rows: budgetTab }, { name: 'Citi', rows: citiTab }]));
    expect(sheets.map((s) => s.name)).toEqual(['Budget Tracker', 'Citi']);
    expect(sheets[0].rows[6].slice(0, 5)).toEqual(['2026-10-02', '5.15', 'Coupa Coffee', 'Food', 'SFCU Credit']);
    expect(sheets[1].rows[4][1]).toBe('$500.00');
    expect(excelSerialToIso(46296)).toBe('2026-10-01');
  });

  it('rejects files that are not xlsx', async () => {
    await expect(readXlsx(new TextEncoder().encode('Date,Amount\n'))).rejects.toThrow(/xlsx/);
  });
});

describe('finding her tables', () => {
  it('finds the expenses table and ignores side tables and charts', async () => {
    const [budget, citi] = await readXlsx(await writeXlsx([{ name: 'Budget Tracker', rows: budgetTab }, { name: 'Citi', rows: citiTab }]));
    const tables = findTables(budget);
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ headerRow: 5, roles: { date: 0, amount: 1, description: 2, category: 3, account: 4 }, expensesPositive: true });
    expect(tables[0].rows).toHaveLength(6);

    const [ledger] = findTables(citi);
    // PAYMENT IN / PAYMENT OUT is a direction, not a category.
    expect(ledger.roles).toMatchObject({ date: 0, amount: 1, description: 2, direction: 3 });
    expect(ledger.roles.category).toBeUndefined();
  });

  it('turns rows into signed amounts', async () => {
    const [budget, citi] = await readXlsx(await writeXlsx([{ name: 'Budget Tracker', rows: budgetTab }, { name: 'Citi', rows: citiTab }]));
    const t = findTables(budget)[0];
    const { rows } = tableRows(t, { roles: t.roles, expensesPositive: true });
    expect(rows.map((r) => [r.date, r.amountCents, r.categoryLabel, r.accountLabel])).toEqual([
      ['2026-10-02', -515, 'Food', 'SFCU Credit'],
      ['2026-10-04', -4500, 'OoB', 'SFCU Credit'],
      ['2026-10-04', -20000, 'OoB', 'Citi Saving'],
      ['2026-10-09', -2147, 'Groceries', 'SFCU Credit'],
      ['2026-10-16', 20908, 'PP', 'SFCU Credit'], // paying off the card: money into the card account
      ['2026-10-17', -2602, 'Clothes/Jewellry', 'SFCU Credit'],
    ]);
    const l = findTables(citi)[0];
    expect(tableRows(l, { roles: l.roles, expensesPositive: true }).rows.map((r) => r.amountCents)).toEqual([50000, -5000, -600, -100, -20000]);
  });
});

describe('mapping suggestions', () => {
  const cats = DEFAULT_CATEGORIES.map((c) => ({ id: c.id, name: c.name }));
  const groups = DEFAULT_GROUPS.map((g) => g.name);
  it.each([
    ['OoB', 'parent_pays'],
    ['PP', 'parent_pays'],
    ['Groceries', 'groceries'],
    ['Clothes/Jewellry', 'clothing'],
    ['Miscellanous', 'misc'],
    ['Food', 'auto'],
    ['PAYMENT OUT', 'auto'],
    ['Zzz', 'auto'],
  ])('%s → %s', (label, target) => {
    expect(suggestCategory(label, cats, groups)).toBe(target);
  });

  it('matches account names', () => {
    const accounts = [
      { id: 'citi', name: 'Citi Checking', institution: 'Citibank', type: 'checking' },
      { id: 'save', name: 'Citi Savings', institution: 'Citibank', type: 'savings' },
      { id: 'sfcu', name: 'SFCU Checking', institution: 'SFCU', type: 'checking' },
      { id: 'card', name: 'SFCU Card', institution: 'SFCU', type: 'credit_card' },
    ];
    expect(suggestAccount('SFCU Credit', accounts)).toBe('card');
    expect(suggestAccount('SFCU Checking', accounts)).toBe('sfcu');
    expect(suggestAccount('Citi Checking', accounts)).toBe('citi');
    expect(suggestAccount('Citi Saving', accounts)).toBe('save');
    expect(suggestAccount('', accounts)).toBeNull();
  });
});

describe('matching rows to bank lines', () => {
  const tx = (id: string, accountId: string, date: string, amountCents: number, description: string): MatchCandidate => ({ id, accountId, date, amountCents, description });
  const row = (index: number, date: string, amountCents: number, description: string, accountIds: string[] = ['citi'], sheet = 'A'): MatchRow => ({
    index,
    date,
    amountCents,
    description,
    accountIds,
    sheet,
  });
  const allCovered = () => true;

  it('matches exact amounts within the date window, even with different descriptions', () => {
    const r = matchRows([row(0, '2026-09-21', -600, 'Fake Reeses')], [tx('z', 'citi', '2026-09-21', -600, 'Zelle to MCDONAGH KUN')], allCovered);
    expect(r[0]).toEqual({ index: 0, status: 'matched', transactionId: 'z', amountDiffers: false });
  });

  it('matches rounded amounts only when the descriptions agree', () => {
    const r = matchRows(
      [row(0, '2026-09-14', -5000, 'Walmart'), row(1, '2026-09-29', -100, 'Icloud'), row(2, '2026-09-22', -2500, 'Groceries')],
      [tx('w', 'citi', '2026-09-14', -5024, 'Walmart'), tx('a', 'citi', '2026-09-29', -99, 'Apple'), tx('t', 'citi', '2026-09-22', -2512, "Trader Joe's")],
      allCovered,
    );
    expect(r[0]).toMatchObject({ status: 'matched', transactionId: 'w', amountDiffers: true });
    expect(r[1]).toMatchObject({ status: 'matched', transactionId: 'a', amountDiffers: true }); // iCloud is billed by Apple
    expect(r[2]).toMatchObject({ status: 'unmatched', reason: 'not_on_statement' });
  });

  it('uses dates and descriptions to pick between identical amounts, and stays one-to-one', () => {
    const r = matchRows(
      [row(0, '2026-09-28', -1497, 'Uber to PA'), row(1, '2026-09-28', -1499, 'Uber from PA'), row(2, '2026-09-28', -1497, 'Uber again')],
      [tx('u1', 'citi', '2026-09-29', -1497, 'Uber'), tx('u2', 'citi', '2026-09-29', -1499, 'Uber')],
      allCovered,
    );
    expect(r.map((x) => (x.status === 'matched' ? x.transactionId : x.status))).toEqual(['u1', 'u2', 'unmatched']);
  });

  it('refuses to guess between equally good candidates', () => {
    const r = matchRows([row(0, '2026-09-28', -10000, 'To SFCU')], [tx('a', 'citi', '2026-09-26', -10000, 'Zelle to Zanaee'), tx('b', 'citi', '2026-09-30', -10000, 'Zelle to Zanaee')], allCovered);
    expect(r[0]).toMatchObject({ status: 'unmatched', reason: 'ambiguous' });
  });

  it('respects the account and the date window', () => {
    const r = matchRows([row(0, '2026-09-11', 50000, 'Initial Budget'), row(1, '2026-10-01', 50000, 'Initial Budget', ['sfcu'])], [tx('z', 'citi', '2026-09-23', 50000, 'Zelle')], allCovered);
    expect(r.map((x) => x.status)).toEqual(['unmatched', 'unmatched']);
  });

  it('adds rows for accounts or dates no statement covers, and flags the same expense on two tabs', () => {
    const covered = (account: string, date: string) => account === 'citi' && date <= '2026-10-01';
    const r = matchRows(
      [row(0, '2026-10-04', -20000, 'Run Club', ['save'], 'Budget'), row(1, '2026-10-01', -20000, 'Run club dues', ['save'], 'Citi'), row(2, '2026-10-10', -584, 'Jacket', [], 'Budget')],
      [],
      covered,
    );
    expect(r[0]).toMatchObject({ status: 'added', accountId: 'save' });
    expect(r[1]).toMatchObject({ status: 'unmatched', reason: 'duplicate_row', duplicateOf: 0 });
    expect(r[2]).toMatchObject({ status: 'unmatched', reason: 'no_account' });
  });

  it('scores description similarity', () => {
    expect(similarity('Coupa w mannat', 'Coupa Cafe')).toBeGreaterThan(0);
    expect(similarity('Fake Reeses', 'Zelle to MCDONAGH KUN')).toBe(0);
  });
});
