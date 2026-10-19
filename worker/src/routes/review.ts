/** The "Needs attention" queue (spec S7). */
import { Hono } from 'hono';
import { z } from 'zod';
import { addDays, todayIso } from '../../../shared/dates';
import type { AttentionReason } from '../../../shared/types';
import type { AppEnv } from '../env';
import { all, first } from '../lib/db';
import { HttpError } from '../lib/pipeline';
import { getTx, getTxs, type TxDto } from '../lib/queries';
import { parseBody } from '../lib/validate';
import { unmatchedRowCount, unmatchedRows } from './history';
import { dismissAttention, linkRepayment, markParentFunding, mergeManual, requireTx, updateTransaction, type TransactionPatch } from './transactions';

export const review = new Hono<AppEnv>();

const UNMATCHED_AFTER_DAYS = 7;

const unmatchedWhere = `t.kind = 'transfer' AND t.excluded = 0 AND t.posted_date < ?
  AND COALESCE(t.dismissed_attention, '') NOT LIKE '%transfer_unmatched%'
  AND NOT EXISTS (SELECT 1 FROM transaction_links l WHERE l.type = 'transfer' AND (l.from_id = t.id OR l.to_id = t.id))`;

export async function reviewCount(db: D1Database): Promise<number> {
  const flagged = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM transactions WHERE needs_attention IS NOT NULL AND excluded = 0');
  const unmatched = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM transactions t WHERE ${unmatchedWhere}`, addDays(todayIso(), -UNMATCHED_AFTER_DAYS));
  return (flagged?.n ?? 0) + (unmatched?.n ?? 0) + (await unmatchedRowCount(db));
}

review.get('/', async (c) => {
  const db = c.env.DB;
  const flagged = await getTxs(db, 't.needs_attention IS NOT NULL AND t.excluded = 0 ORDER BY t.posted_date DESC LIMIT 200');
  const unmatched = (await getTxs(db, `${unmatchedWhere} ORDER BY t.posted_date DESC LIMIT 50`, addDays(todayIso(), -UNMATCHED_AFTER_DAYS))).map((t) => ({
    ...t,
    needsAttention: 'transfer_unmatched' as AttentionReason,
  }));

  // Merge suggestions: attach the manual entry they probably duplicate.
  const mergeLinks = await all<{ from_id: string; to_id: string }>(db, "SELECT from_id, to_id FROM transaction_links WHERE type = 'merge_suggestion'");
  const mergeTargets = mergeLinks.length ? await getTxs(db, `t.id IN (${mergeLinks.map(() => '?').join(',')})`, ...mergeLinks.map((l) => l.to_id)) : [];

  const items = await Promise.all(
    [...flagged, ...unmatched].map(async (t) => {
      let extra: { mergeWith?: TxDto | null; repaymentCandidates?: TxDto[] } = {};
      if (t.needsAttention === 'possible_merge') {
        const link = mergeLinks.find((l) => l.from_id === t.id);
        extra = { mergeWith: mergeTargets.find((m) => m.id === link?.to_id) ?? null };
      }
      if (t.needsAttention === 'venmo_incoming') {
        extra = {
          repaymentCandidates: await getTxs(
            db,
            `t.kind = 'spend' AND t.posted_date BETWEEN ? AND ? AND -t.amount_cents >= ? ORDER BY ABS(julianday(t.posted_date) - julianday(?)) LIMIT 5`,
            addDays(t.date, -30),
            t.date,
            t.amountCents,
            t.date,
          ),
        };
      }
      return { ...t, ...extra };
    }),
  );
  // Spreadsheet rows with no bank line (spec §12.4): decided here too.
  const sheetRows = await unmatchedRows(db);
  return c.json({ items, sheetRows, count: items.length + sheetRows.length });
});

const resolveSchema = z.discriminatedUnion('action', [
  // Pick a category (optionally "always" for this merchant).
  z.object({ action: z.literal('categorize'), categoryId: z.string().min(1), always: z.boolean().default(false) }),
  // Incoming money: paying me back (optionally linked), income/gift, or a refund.
  z.object({ action: z.literal('repayment'), spendId: z.string().nullable().default(null), categoryId: z.string().nullable().default(null) }),
  z.object({ action: z.literal('income') }),
  z.object({ action: z.literal('refund'), categoryId: z.string().nullable().default(null) }),
  z.object({ action: z.literal('transfer') }),
  // Money the parent put in to cover a specific bill (e.g. tuition).
  z.object({ action: z.literal('parent_funding') }),
  z.object({ action: z.literal('merge') }),
  z.object({ action: z.literal('keep_separate') }),
  z.object({ action: z.literal('dismiss') }),
]);

/** Resolve a review card. Each action ends with the item off the queue. */
review.post('/:id/resolve', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const tx = await requireTx(db, c.req.param('id'));
  const body = parseBody(resolveSchema, await c.req.json());
  const patch = (data: TransactionPatch) => updateTransaction(db, user.id, tx, data);

  switch (body.action) {
    case 'categorize':
      await patch({ categoryId: body.categoryId, createRule: body.always });
      break;
    case 'repayment':
      if (body.spendId) await linkRepayment(db, user.id, tx, body.spendId);
      else await patch({ kind: 'repayment', ...(body.categoryId ? { categoryId: body.categoryId } : {}) });
      break;
    case 'income':
      await patch({ kind: 'income', categoryId: null });
      break;
    case 'refund':
      await patch({ kind: 'refund', ...(body.categoryId ? { categoryId: body.categoryId } : {}) });
      break;
    case 'transfer':
      await patch({ kind: 'transfer' });
      break;
    case 'parent_funding':
      await markParentFunding(db, user.id, tx);
      break;
    case 'merge': {
      const link = await first<{ to_id: string }>(db, "SELECT to_id FROM transaction_links WHERE type = 'merge_suggestion' AND from_id = ?", tx.id);
      if (!link) throw new HttpError(400, 'Nothing to merge with');
      await mergeManual(db, user.id, tx, link.to_id);
      break;
    }
    case 'keep_separate':
      await dismissAttention(db, user.id, tx, 'possible_merge');
      break;
    case 'dismiss': {
      const reason = (tx.needsAttention ?? (isUnmatched(tx) ? 'transfer_unmatched' : null)) as AttentionReason | null;
      if (reason) await dismissAttention(db, user.id, tx, reason);
      break;
    }
  }
  return c.json({ ok: true, transaction: await getTx(db, tx.id), remaining: await reviewCount(db) });
});

function isUnmatched(tx: TxDto) {
  return tx.kind === 'transfer' && !tx.transferLinked;
}
