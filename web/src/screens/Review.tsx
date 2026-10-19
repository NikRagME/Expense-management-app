import { useState } from 'react';
import { Link } from 'react-router';
import { api, type ReviewItem } from '../api/client';
import { useApiMutation, useReview } from '../api/hooks';
import { CategoryPicker } from '../components/CategoryPicker';
import { Button, Card, Empty, ErrorText, Loading, PageHeader, Status } from '../components/ui';
import { ATTENTION_LABELS, money, prettyDate } from '../lib/format';

/** The weekly tidy-up: one card at a time (spec S7). */
export function Review() {
  const q = useReview();
  const [skipped, setSkipped] = useState<string[]>([]);
  if (q.isLoading) return <Loading />;
  const items = q.data?.items ?? [];
  const queue = items.filter((i) => !skipped.includes(i.id));
  const current = queue[0] ?? items[0];

  return (
    <div className="space-y-4">
      <PageHeader title={items.length ? `${items.length} to review` : 'Review'} />
      <ErrorText error={q.error} />
      {!items.length ? (
        <Card>
          <Empty emoji="🎉" title="All caught up!">
            Everything is categorised and matched. Nice work.
          </Empty>
        </Card>
      ) : (
        <>
          <ReviewCard
            key={current.id}
            item={current}
            onSkip={() => setSkipped((s) => (queue.length <= 1 ? [] : [...s, current.id]))}
          />
          {items.length > 1 && <p className="text-center text-sm text-muted">{items.length - 1} more after this one</p>}
        </>
      )}
    </div>
  );
}

function ReviewCard({ item, onSkip }: { item: ReviewItem; onSkip: () => void }) {
  // On Venmo the "merchant" is a friend, who could be paid for anything, so don't default to a rule.
  const [always, setAlways] = useState(item.accountType !== 'payment_app');
  const resolve = useApiMutation((body: Record<string, unknown>) => api(`/review/${item.id}/resolve`, { method: 'POST', body }));
  const r = item.needsAttention!;
  const incoming = r === 'venmo_incoming' || r === 'unknown_inflow';
  const merchant = item.merchantName ?? item.description;

  return (
    <Card className="animate-pop space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Status tone="warn" icon="👀">
            {ATTENTION_LABELS[r]}
          </Status>
          <p className="mt-2 truncate text-lg font-bold">{item.description}</p>
          <p className="text-sm text-muted">
            {prettyDate(item.date, { year: true })} · {item.accountName}
          </p>
          {item.paymentNote && <p className="text-ink-2">“{item.paymentNote}”</p>}
        </div>
        <p className={`tabular shrink-0 text-2xl font-extrabold ${item.amountCents > 0 ? 'text-good' : ''}`}>
          {item.amountCents > 0 ? money(item.amountCents, { sign: true }) : money(-item.amountCents)}
        </p>
      </div>

      {r === 'uncategorized' && (
        <div className="space-y-3">
          <CategoryPicker value={null} onChange={(categoryId) => resolve.mutate({ action: 'categorize', categoryId, always })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-5" checked={always} onChange={(e) => setAlways(e.target.checked)} />
            Always use this category for <b>{merchant}</b>
          </label>
        </div>
      )}

      {incoming && (
        <div className="space-y-3">
          <p className="font-semibold">What is this?</p>
          {(item.repaymentCandidates?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-sm text-ink-2">Paying you back for…</p>
              <div className="space-y-1">
                {item.repaymentCandidates!.map((c) => (
                  <button
                    key={c.id}
                    className="flex w-full justify-between rounded-xl bg-surface-2 px-3 py-2 text-left hover:ring-1 hover:ring-brand"
                    onClick={() => resolve.mutate({ action: 'repayment', spendId: c.id })}
                  >
                    <span className="truncate">
                      {c.description} <span className="text-xs text-muted">{prettyDate(c.date)}</span>
                    </span>
                    <span className="tabular">{money(-c.amountCents)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <Button onClick={() => resolve.mutate({ action: 'repayment', spendId: null })}>🤝 Paying me back (something else)</Button>
            <Button onClick={() => resolve.mutate({ action: 'income' })}>💵 Income or a gift</Button>
            <Button onClick={() => resolve.mutate({ action: 'refund' })}>↩️ A refund</Button>
            {r === 'unknown_inflow' && <Button onClick={() => resolve.mutate({ action: 'transfer' })}>↔️ From another of my accounts</Button>}
          </div>
        </div>
      )}

      {r === 'possible_merge' && item.mergeWith && (
        <div className="space-y-3">
          <p className="text-ink-2">This looks like the same purchase you added by hand:</p>
          <div className="rounded-xl bg-surface-2 px-3 py-2">
            <p className="font-semibold">{item.mergeWith.description}</p>
            <p className="text-sm text-muted">
              {prettyDate(item.mergeWith.date)} · {money(-item.mergeWith.amountCents)} · added by hand
            </p>
          </div>
          <div className="grid gap-2">
            <Button variant="primary" onClick={() => resolve.mutate({ action: 'merge' })}>
              Same purchase: merge them
            </Button>
            <Button onClick={() => resolve.mutate({ action: 'keep_separate' })}>Different: keep both</Button>
          </div>
        </div>
      )}

      {(r === 'transfer_unmatched' || r === 'transfer_ambiguous') && (
        <div className="space-y-3">
          <p className="text-ink-2">
            {r === 'transfer_unmatched'
              ? "This looks like money moving between your accounts, but the other side hasn't shown up. Import the other account's statement, or mark it OK."
              : 'Several transfers match this one. Open it to check, or mark it OK.'}
          </p>
          <div className="grid gap-2">
            <Button onClick={() => resolve.mutate({ action: 'dismiss' })}>👍 It's fine</Button>
            <Link to={`/tx/${item.id}`} className="flex min-h-11 items-center justify-center rounded-2xl bg-surface-2 font-semibold">
              It's not a transfer: open it
            </Link>
          </div>
        </div>
      )}

      <ErrorText error={resolve.error} />
      <div className="flex justify-between border-t border-line pt-3 text-sm">
        <Link to={`/tx/${item.id}`} className="font-semibold text-brand">
          Open details
        </Link>
        <button className="font-semibold text-muted" onClick={onSkip}>
          Skip ›
        </button>
      </div>
    </Card>
  );
}
