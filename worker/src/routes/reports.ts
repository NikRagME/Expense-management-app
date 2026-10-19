/** Home overview (spec S2). Totals come from shared/reports.ts — the single definition. */
import { Hono } from 'hono';
import { daysBetween, isIsoDate, todayIso } from '../../../shared/dates';
import { calendarMonth, previousPeriod } from '../../../shared/periods';
import { computeTotals } from '../../../shared/reports';
import type { AppEnv } from '../env';
import { all } from '../lib/db';
import { HttpError } from '../lib/pipeline';
import { accountBalances } from '../lib/queries';
import { reviewCount } from './review';
import { toReportLine, type ReportLineRow } from './transactions';

export const reports = new Hono<AppEnv>();

const STALE_DAYS = 7;

async function linesBetween(db: D1Database, from: string, to: string) {
  const rows = await all<ReportLineRow>(
    db,
    `SELECT t.id AS transaction_id, t.posted_date AS date, t.kind, t.account_id, a.type AS account_type, l.category_id, l.amount_cents, t.excluded
     FROM transactions t JOIN accounts a ON a.id = t.account_id JOIN transaction_lines l ON l.transaction_id = t.id
     WHERE t.posted_date BETWEEN ? AND ?`,
    from,
    to,
  );
  return rows.map(toReportLine);
}

reports.get('/overview', async (c) => {
  const db = c.env.DB;
  const today = todayIso();
  const from = c.req.query('from') ?? calendarMonth(today.slice(0, 7)).from;
  const to = c.req.query('to') ?? calendarMonth(today.slice(0, 7)).to;
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new HttpError(400, 'Invalid date range');
  const prev = previousPeriod({ from, to, label: '' });

  const [lines, prevLines] = await Promise.all([linesBetween(db, from, to), linesBetween(db, prev.from, prev.to)]);
  const totals = computeTotals(lines);
  const withParent = computeTotals(lines, { includeParentPaidInCategories: true });
  const prevTotals = computeTotals(prevLines);

  const groups = await all<{ id: string; name: string; sort_order: number }>(db, 'SELECT * FROM category_groups ORDER BY sort_order');
  const cats = await all<{ id: string; group_id: string; name: string; emoji: string }>(db, 'SELECT id, group_id, name, emoji FROM categories ORDER BY sort_order');
  const groupView = (byCategory: Map<string | null, number>) =>
    groups
      .map((g) => {
        const categories = cats
          .filter((x) => x.group_id === g.id)
          .map((x) => ({ id: x.id, name: x.name, emoji: x.emoji, cents: byCategory.get(x.id) ?? 0 }))
          .filter((x) => x.cents !== 0)
          .sort((a, b) => b.cents - a.cents);
        return { id: g.id, name: g.name, cents: categories.reduce((s, x) => s + x.cents, 0), categories };
      })
      .filter((g) => g.categories.length)
      .sort((a, b) => b.cents - a.cents);

  const accounts = await all<{ id: string; name: string; type: string; institution: string; last_import_at: string | null; through: string | null }>(
    db,
    `SELECT a.id, a.name, a.type, a.institution,
            (SELECT MAX(created_at) FROM imports i WHERE i.account_id = a.id AND i.undone_at IS NULL) AS last_import_at,
            (SELECT MAX(posted_date) FROM transactions t WHERE t.account_id = a.id) AS through
     FROM accounts a WHERE a.archived_at IS NULL ORDER BY a.sort_order, a.created_at`,
  );
  const balances = await accountBalances(db);
  const real = accounts.filter((a) => a.type !== 'parent_paid');
  const accountView = real.map((a) => {
    const b = balances.get(a.id);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      spendingCents: totals.byAccount.get(a.id) ?? 0,
      balanceCents: b?.balanceCents ?? null,
      balanceAsOf: b?.asOf ?? null,
      balanced: b?.balanced ?? null,
    };
  });
  const known = accountView.filter((a) => a.balanceCents != null);

  return c.json({
    from,
    to,
    previous: { from: prev.from, to: prev.to, spendingCents: prevTotals.spendingCents },
    spendingCents: totals.spendingCents,
    parentPaidCents: totals.parentPaidCents,
    costOfLivingCents: totals.costOfLivingCents,
    moneyInCents: totals.moneyInCents,
    transactionCount: totals.transactionCount,
    groups: groupView(totals.byCategory),
    groupsWithParent: groupView(withParent.byCategory),
    uncategorizedCents: totals.byCategory.get(null) ?? 0,
    accounts: accountView,
    netPositionCents: known.length ? known.reduce((s, a) => s + (a.balanceCents ?? 0), 0) : null,
    allBalancesKnown: known.length === real.length,
    needsAttentionCount: await reviewCount(db),
    freshness: real.map((a) => ({
      accountId: a.id,
      name: a.name,
      lastImportAt: a.last_import_at,
      through: a.through,
      stale: !a.last_import_at || daysBetween(a.last_import_at.slice(0, 10), today) > STALE_DAYS,
      daysSinceImport: a.last_import_at ? daysBetween(a.last_import_at.slice(0, 10), today) : null,
    })),
  });
});
