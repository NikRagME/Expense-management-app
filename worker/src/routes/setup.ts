/** "Set up history" checklist status (spec §12.3). */
import { Hono } from 'hono';
import { addDays, daysBetween, todayIso } from '../../../shared/dates';
import type { AppEnv } from '../env';
import { all } from '../lib/db';
import { accountBalances } from '../lib/queries';

export const setup = new Hono<AppEnv>();

const GAP_DAYS = 7;

/** Merge statement periods and list the gaps between opening day and today. */
export function coverage(openedOn: string | null, periods: { from: string; to: string }[], today: string) {
  const sorted = periods.filter((p) => p.from && p.to).sort((a, b) => a.from.localeCompare(b.from));
  const merged: { from: string; to: string }[] = [];
  for (const p of sorted) {
    const last = merged[merged.length - 1];
    if (last && p.from <= addDays(last.to, 1)) last.to = p.to > last.to ? p.to : last.to;
    else merged.push({ ...p });
  }
  const gaps: { from: string; to: string }[] = [];
  let cursor = openedOn ?? merged[0]?.from ?? null;
  if (cursor) {
    for (const r of merged) {
      if (r.from > cursor && daysBetween(cursor, r.from) > 1) gaps.push({ from: cursor, to: addDays(r.from, -1) });
      if (r.to >= cursor) cursor = addDays(r.to, 1);
    }
    // Statements run a few weeks behind; only flag the recent gap when it is long.
    if (daysBetween(cursor, today) > GAP_DAYS + 31) gaps.push({ from: cursor, to: today });
  }
  return { ranges: merged, gaps: gaps.filter((g) => daysBetween(g.from, g.to) >= 1) };
}

setup.get('/', async (c) => {
  const db = c.env.DB;
  const today = todayIso();
  const accounts = await all<{ id: string; name: string; type: string; opened_on: string | null }>(
    db,
    "SELECT id, name, type, opened_on FROM accounts WHERE archived_at IS NULL AND type != 'parent_paid' ORDER BY sort_order, created_at",
  );
  const periods = await all<{ account_id: string; date_from: string; date_to: string }>(
    db,
    'SELECT account_id, date_from, date_to FROM imports WHERE undone_at IS NULL AND date_from IS NOT NULL',
  );
  const openings = await all<{ account_id: string; as_of_date: string; balance_cents: number }>(
    db,
    'SELECT s.account_id, s.as_of_date, s.balance_cents FROM balance_snapshots s JOIN accounts a ON a.id = s.account_id WHERE a.opened_on IS NOT NULL AND s.as_of_date = date(a.opened_on, \'-1 day\')',
  );
  const balances = await accountBalances(db);
  const sheets = await all<{ id: string; file_name: string; rows_total: number; rows_matched: number; rows_added: number; rows_unmatched: number; created_at: string }>(
    db,
    'SELECT id, file_name, rows_total, rows_matched, rows_added, rows_unmatched, created_at FROM history_imports WHERE undone_at IS NULL ORDER BY created_at DESC',
  );
  const unmatched = await all<{ n: number }>(db, "SELECT COUNT(*) AS n FROM spreadsheet_rows r JOIN history_imports h ON h.id = r.history_import_id WHERE h.undone_at IS NULL AND r.status = 'unmatched'");

  const rows = accounts.map((a) => {
    const cov = coverage(a.opened_on, periods.filter((p) => p.account_id === a.id).map((p) => ({ from: p.date_from, to: p.date_to })), today);
    const opening = openings.find((o) => o.account_id === a.id);
    const b = balances.get(a.id);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      openedOn: a.opened_on,
      openingBalanceCents: opening?.balance_cents ?? null,
      ranges: cov.ranges,
      gaps: cov.gaps,
      covered: !!a.opened_on && cov.ranges.length > 0 && cov.gaps.length === 0,
      balanceCents: b?.balanceCents ?? null,
      balanceAsOf: b?.asOf ?? null,
      balanced: b?.balanced ?? null,
    };
  });

  return c.json({
    accounts: rows,
    spreadsheets: sheets.map((s) => ({
      id: s.id,
      fileName: s.file_name,
      rowsTotal: s.rows_total,
      rowsMatched: s.rows_matched,
      rowsAdded: s.rows_added,
      rowsUnmatched: s.rows_unmatched,
      createdAt: s.created_at,
    })),
    unmatchedRows: unmatched[0]?.n ?? 0,
    steps: {
      opening: rows.length > 0 && rows.every((r) => r.openedOn),
      statements: rows.length > 0 && rows.every((r) => r.covered),
      spreadsheet: sheets.length > 0,
      balances: rows.length > 0 && rows.every((r) => r.balanced === true),
    },
  });
});
