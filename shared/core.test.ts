import { describe, expect, it } from 'vitest';
import { balanceAt, checkBalance } from './balance';
import { classify } from './classify';
import { addDays, parseDate } from './dates';
import { findMergeCandidate, findTransferPairs, splitDuplicates, type MatchTx } from './matching';
import { cleanMerchant } from './merchant';
import { formatCents, parseAmount } from './money';
import { calendarMonth, previousPeriod, shiftMonth } from './periods';
import { computeTotals, type ReportLine } from './reports';
import { remainingCents, validateSplit } from './splits';
import type { AccountType, ParsedRow, Rule, Settings } from './types';

describe('money', () => {
  it.each([
    ['12.34', 1234],
    ['-12.34', -1234],
    ['$1,234.50', 123450],
    ['- $18.00', -1800],
    ['+ $18.00', 1800],
    ['(5.00)', -500],
    ['5.00-', -500],
    ['$-7', -700],
    ['0.1', 10],
    ['abc', null],
    ['', null],
  ])('parseAmount(%s) = %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('formats cents', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-500)).toBe('-$5.00');
    expect(formatCents(500, { sign: true })).toBe('+$5.00');
    expect(formatCents(84250, { whole: true })).toBe('$843');
  });
});

describe('dates and periods', () => {
  it.each([
    ['10/12/2026', '2026-10-12'],
    ['1/2/26', '2026-01-02'],
    ['2026-10-12', '2026-10-12'],
    ['20261012120000[-5:EST]', '2026-10-12'],
    ['2026-10-12T18:22:01', '2026-10-12'],
    ['02/30/2026', null],
  ])('parseDate(%s) = %s', (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it('builds calendar months and previous periods', () => {
    expect(calendarMonth('2026-02')).toMatchObject({ from: '2026-02-01', to: '2026-02-28', label: 'February 2026' });
    expect(previousPeriod(calendarMonth('2026-03'))).toMatchObject({ from: '2026-02-01', to: '2026-02-28' });
    expect(previousPeriod({ from: '2026-10-08', to: '2026-10-14', label: '' })).toMatchObject({ from: '2026-10-01', to: '2026-10-07' });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('merchant cleaning', () => {
  it.each([
    ['SQ *BLUE BOTTLE 0423 PALO ALTO CA', 'Blue Bottle Palo Alto'],
    ['TST* SUSHI KAZU 12345 STANFORD CA', 'Sushi Kazu Stanford'],
    ['AMZN Mktp US*2K4L19', 'Amazon'],
    ['UBER *EATS PENDING', 'Uber Eats'],
    ['PURCHASE AUTHORIZED ON 10/12 CHIPOTLE 1234 PALO ALTO CA', 'Chipotle'],
    ['TRADER JOE S #123', "Trader Joe's"],
  ])('%s → %s', (raw, clean) => {
    expect(cleanMerchant(raw)).toBe(clean);
  });
});

describe('classification', () => {
  const settings: Settings = { parentZelleNames: ['Nikhil'], venmoIncomingDefault: 'ask' };
  const run = (row: Partial<ParsedRow>, accountType: AccountType, rules: Rule[] = [], s = settings) =>
    classify({ date: '2026-10-12', amountCents: -1000, description: '', ...row }, { accountId: 'a1', accountType, rules, settings: s });

  it('recognises the Zelle allowance as income', () => {
    expect(run({ amountCents: 30000, description: 'ZELLE FROM NIKHIL R' }, 'checking')).toMatchObject({ kind: 'income', categoryId: 'allowance' });
  });

  it('treats card payments and bank transfers as transfers', () => {
    expect(run({ amountCents: 40000, description: 'PAYMENT - THANK YOU' }, 'credit_card').kind).toBe('transfer');
    expect(run({ amountCents: -40000, description: 'SFCU VISA PMT' }, 'checking').kind).toBe('transfer');
    expect(run({ amountCents: -5000, description: 'ONLINE TRANSFER TO SFCU' }, 'checking').kind).toBe('transfer');
    expect(run({ amountCents: -1800, description: 'VENMO PAYMENT 1023' }, 'checking').kind).toBe('transfer');
  });

  it('treats card credits that are not payments as refunds', () => {
    expect(run({ amountCents: 2500, description: 'AMAZON.COM REFUND' }, 'credit_card')).toMatchObject({ kind: 'refund' });
  });

  it('categorises from hints, else flags for review', () => {
    expect(run({ description: 'SQ *BLUE BOTTLE 0423' }, 'credit_card')).toMatchObject({ kind: 'spend', categoryId: 'coffee_snacks', needsAttention: null });
    expect(run({ description: 'XYZ LLC 9981' }, 'credit_card')).toMatchObject({ kind: 'spend', categoryId: null, needsAttention: 'uncategorized' });
    expect(run({ description: 'STEAM PURCHASE' }, 'credit_card').categoryId).toBe('entertainment');
  });

  it('applies user rules ahead of hints', () => {
    const rule: Rule = { id: 'r', matchType: 'merchant', pattern: 'Blue Bottle', accountId: null, setKind: null, setCategoryId: 'going_out', priority: 0 };
    expect(run({ description: 'SQ *BLUE BOTTLE' }, 'credit_card', [rule])).toMatchObject({ categoryId: 'going_out', via: 'rule' });
    const kindRule: Rule = { ...rule, matchType: 'contains', pattern: 'rent', setKind: 'spend', setCategoryId: 'rent' };
    expect(run({ description: 'ZELLE TO LANDLORD RENT' }, 'checking', [kindRule])).toMatchObject({ kind: 'spend', categoryId: 'rent' });
  });

  it('asks about incoming Venmo from friends (A5), with a setting to default to repayment', () => {
    const row = { amountCents: 1800, description: 'Maya — pizza', counterparty: 'Maya', paymentNote: 'pizza 🍕' };
    expect(run(row, 'payment_app')).toMatchObject({ kind: 'repayment', needsAttention: 'venmo_incoming' });
    expect(run(row, 'payment_app', [], { ...settings, venmoIncomingDefault: 'repayment' })).toMatchObject({ kind: 'repayment', needsAttention: null, categoryId: 'eating_out' });
    expect(run({ ...row, counterparty: 'Nikhil R' }, 'payment_app')).toMatchObject({ kind: 'income' });
  });

  it('asks about unexplained bank inflows', () => {
    expect(run({ amountCents: 5000, description: 'DEPOSIT' }, 'checking')).toMatchObject({ needsAttention: 'unknown_inflow' });
  });

  it('respects parser kind hints and parent-paid accounts', () => {
    expect(run({ amountCents: 1800, description: 'Funding from Citi', kindHint: 'transfer' }, 'payment_app').kind).toBe('transfer');
    expect(run({ description: 'Verizon phone plan' }, 'parent_paid')).toMatchObject({ kind: 'parent_paid', categoryId: 'phone_internet' });
  });
});

describe('duplicate detection', () => {
  const row = (date: string, amountCents: number, description: string, externalId?: string): ParsedRow => ({ date, amountCents, description, externalId });

  it('uses external ids when present', () => {
    const { fresh, duplicates } = splitDuplicates([row('2026-10-01', -500, 'A', 'x1'), row('2026-10-01', -500, 'A', 'x2'), row('2026-10-01', -500, 'A', 'x2')], {
      externalIds: new Set(['x1']),
      keyCounts: new Map(),
    });
    expect(fresh.map((r) => r.externalId)).toEqual(['x2']);
    expect(duplicates).toHaveLength(2);
  });

  it('keeps legitimate identical lines by comparing counts', () => {
    const coffee = row('2026-10-01', -500, 'COFFEE');
    const { fresh, duplicates } = splitDuplicates([coffee, coffee, coffee], { externalIds: new Set(), keyCounts: new Map([['2026-10-01|-500|coffee', 1]]) });
    expect(fresh).toHaveLength(2);
    expect(duplicates).toHaveLength(1);
  });
});

describe('transfer matching', () => {
  const tx = (id: string, accountId: string, date: string, amountCents: number, extra: Partial<MatchTx> = {}): MatchTx => ({
    id,
    accountId,
    date,
    amountCents,
    kind: 'transfer',
    needsAttention: null,
    source: 'import',
    linked: false,
    ...extra,
  });

  it('pairs a card payment with the bank debit', () => {
    const { pairs } = findTransferPairs([tx('bank', 'citi', '2026-10-05', -40000), tx('card', 'sfcu_card', '2026-10-07', 40000), tx('other', 'citi', '2026-10-06', -1200)]);
    expect(pairs.map(([a, b]) => [a.id, b.id])).toEqual([['bank', 'card']]);
  });

  it('pairs with an unexplained inflow on the other side', () => {
    const { pairs } = findTransferPairs([tx('out', 'citi', '2026-10-05', -5000), tx('in', 'sfcu', '2026-10-06', 5000, { kind: 'income', needsAttention: 'unknown_inflow' })]);
    expect(pairs).toHaveLength(1);
  });

  it('does not pair outside the window, within one account, or already linked', () => {
    expect(findTransferPairs([tx('a', 'x', '2026-10-01', -100), tx('b', 'y', '2026-10-09', 100)]).pairs).toHaveLength(0);
    expect(findTransferPairs([tx('a', 'x', '2026-10-01', -100), tx('b', 'x', '2026-10-01', 100)]).pairs).toHaveLength(0);
    expect(findTransferPairs([tx('a', 'x', '2026-10-01', -100), tx('b', 'y', '2026-10-01', 100, { linked: true })]).pairs).toHaveLength(0);
  });

  it('prefers the closest date and flags true ties as ambiguous', () => {
    const r1 = findTransferPairs([tx('a', 'x', '2026-10-01', -100), tx('b', 'y', '2026-10-02', 100), tx('c', 'y', '2026-10-05', 100)]);
    expect(r1.pairs.map(([a, b]) => [a.id, b.id])).toEqual([['a', 'b']]);
    const r2 = findTransferPairs([tx('a', 'x', '2026-10-03', -100), tx('b', 'y', '2026-10-02', 100), tx('c', 'z', '2026-10-04', 100)]);
    expect(r2.pairs).toHaveLength(0);
    expect(r2.ambiguous).toContain('a');
  });

  it('suggests merging a manual entry with the imported line', () => {
    const imported = tx('i', 'card', '2026-10-04', -650, { kind: 'spend' });
    const manual = [tx('m1', 'card', '2026-10-01', -650, { kind: 'spend', source: 'manual' }), tx('m2', 'card', '2026-10-03', -650, { kind: 'spend', source: 'manual' })];
    expect(findMergeCandidate(imported, manual)?.id).toBe('m2');
    expect(findMergeCandidate({ ...imported, date: '2026-10-09' }, manual)).toBeNull();
  });
});

describe('balances', () => {
  const snaps = [{ asOf: '2026-10-01', cents: 50000 }];
  const moves = [
    { date: '2026-10-01', amountCents: -999 }, // same day as snapshot: already included
    { date: '2026-10-02', amountCents: -2000 },
    { date: '2026-10-05', amountCents: 30000 },
  ];

  it('rolls forward from the latest snapshot', () => {
    expect(balanceAt(snaps, moves, '2026-10-03')).toBe(48000);
    expect(balanceAt(snaps, moves, '2026-10-10')).toBe(78000);
    expect(balanceAt(snaps, moves, '2026-09-30')).toBeNull();
  });

  it('checks a new balance against the computed one', () => {
    expect(checkBalance(snaps, moves, { asOf: '2026-10-10', cents: 78000 })).toEqual({ computedCents: 78000, differenceCents: 0 });
    expect(checkBalance(snaps, moves, { asOf: '2026-10-10', cents: 75690 })).toEqual({ computedCents: 78000, differenceCents: -2310 });
    expect(checkBalance([], moves, { asOf: '2026-10-10', cents: 1 })).toBeNull();
  });
});

describe('reporting definitions', () => {
  const line = (kind: ReportLine['kind'], amountCents: number, extra: Partial<ReportLine> = {}): ReportLine => ({
    transactionId: Math.random().toString(),
    date: '2026-10-10',
    kind,
    accountId: 'card',
    accountType: 'credit_card',
    categoryId: 'eating_out',
    amountCents,
    excluded: false,
    ...extra,
  });

  it('computes spending, cost of living and money in', () => {
    const t = computeTotals([
      line('spend', -3600),
      line('repayment', 1800, { accountId: 'venmo', accountType: 'payment_app' }),
      line('refund', 500, { categoryId: 'clothing' }),
      line('spend', -2000, { categoryId: 'clothing' }),
      line('transfer', -40000),
      line('transfer', 40000),
      line('income', 30000, { accountType: 'checking', categoryId: 'allowance' }),
      line('parent_paid', -4500, { accountId: 'parent', accountType: 'parent_paid', categoryId: 'phone_internet' }),
      line('spend', -9999, { excluded: true }),
    ]);
    expect(t.spendingCents).toBe(3300);
    expect(t.parentPaidCents).toBe(4500);
    expect(t.costOfLivingCents).toBe(7800);
    expect(t.moneyInCents).toBe(30000);
    expect(t.byCategory.get('eating_out')).toBe(1800);
    expect(t.byCategory.get('clothing')).toBe(1500);
    expect(t.byCategory.has('phone_internet')).toBe(false);
  });
});

describe('splits', () => {
  it('requires parts to add up exactly', () => {
    expect(validateSplit(-5000, [{ amountCents: -3000, categoryId: 'groceries' }, { amountCents: -2000, categoryId: 'clothing' }])).toBeNull();
    expect(validateSplit(-5000, [{ amountCents: -3000, categoryId: 'groceries' }, { amountCents: -1000, categoryId: 'clothing' }])).toMatch(/add up/);
    expect(validateSplit(-5000, [{ amountCents: -5000, categoryId: 'groceries' }])).toMatch(/at least 2/);
    expect(remainingCents(-5000, [{ amountCents: -3760, categoryId: null }])).toBe(-1240);
  });
});
