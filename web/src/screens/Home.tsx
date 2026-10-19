import { useState } from 'react';
import { Link } from 'react-router';
import type { GroupTotal, Overview } from '../api/client';
import { useAccounts, useCategoryLookup, useOverview, useSetup } from '../api/hooks';
import { PeriodSwitcher, usePeriod } from '../components/PeriodSwitcher';
import { Card, Empty, ErrorText, Loading, SectionTitle, Status } from '../components/ui';
import { ACCOUNT_EMOJI, balanceText, money, prettyDate, timeAgo } from '../lib/format';

export function Home() {
  const period = usePeriod();
  const overview = useOverview(period.from, period.to);
  const accounts = useAccounts();
  const [withParent, setWithParent] = useState(false);

  if (overview.isLoading || accounts.isLoading) return <Loading />;
  if (overview.error) return <ErrorText error={overview.error} />;
  const o = overview.data!;
  const realAccounts = (accounts.data ?? []).filter((a) => a.type !== 'parent_paid' && !a.archived);

  if (!realAccounts.length) {
    return (
      <Card className="mt-6">
        <Empty emoji="👋" title="Welcome to Pocket!">
          <p className="mb-4">Start by adding the accounts you use: banks, cards, Venmo.</p>
          <Link to="/more/accounts" className="inline-flex min-h-11 items-center rounded-2xl bg-brand px-5 font-semibold text-brand-ink">
            Add accounts
          </Link>
        </Empty>
      </Card>
    );
  }

  const groups = withParent ? o.groupsWithParent : o.groups;
  const total = withParent ? o.costOfLivingCents : o.spendingCents;
  const delta = o.spendingCents - o.previous.spendingCents;

  return (
    <div className="space-y-4">
      <PeriodSwitcher />

      <Card className="text-center">
        <p className="text-sm font-semibold text-ink-2">You spent</p>
        <p className="tabular my-1 text-5xl font-extrabold tracking-tight">{money(o.spendingCents, { whole: o.spendingCents >= 100000 })}</p>
        {o.previous.spendingCents > 0 || o.spendingCents > 0 ? (
          <p className="text-sm text-ink-2">
            {delta === 0 ? '● Same as' : delta > 0 ? `▲ ${money(delta)} more than` : `▼ ${money(-delta)} less than`} {period.isMonth ? 'last month' : 'the previous period'}
          </p>
        ) : (
          <p className="text-sm text-muted">Nothing yet for this period.</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 text-left">
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-xs font-semibold text-muted">Cost of living</p>
            <p className="tabular text-lg font-bold">{money(o.costOfLivingCents)}</p>
            <p className="text-xs text-muted">you + {money(o.parentPaidCents)} parent</p>
          </div>
          <div className="rounded-2xl bg-surface-2 p-3">
            <p className="text-xs font-semibold text-muted">Money in</p>
            <p className="tabular text-lg font-bold">{money(o.moneyInCents)}</p>
            <p className="text-xs text-muted">allowance & income</p>
          </div>
        </div>
      </Card>

      <SetupNudge />
      <ReviewNudge count={o.needsAttentionCount} />

      <Card>
        <SectionTitle
          action={
            <div className="flex rounded-full bg-surface-2 p-0.5 text-xs font-semibold" role="group" aria-label="Show">
              <button className={`rounded-full px-3 py-1 ${!withParent ? 'bg-surface text-ink shadow' : 'text-muted'}`} onClick={() => setWithParent(false)}>
                My spending
              </button>
              <button className={`rounded-full px-3 py-1 ${withParent ? 'bg-surface text-ink shadow' : 'text-muted'}`} onClick={() => setWithParent(true)}>
                + Parent paid
              </button>
            </div>
          }
        >
          Where it went
        </SectionTitle>
        <WhereItWent groups={groups} total={total} uncategorized={withParent ? 0 : o.uncategorizedCents} from={o.from} to={o.to} />
      </Card>

      <Accounts o={o} />
    </div>
  );
}

/** Offered until her history is brought up to date (spec §12.5). */
function SetupNudge() {
  const s = useSetup().data;
  if (!s || (s.steps.opening && s.steps.spreadsheet)) return null;
  const done = Object.values(s.steps).filter(Boolean).length;
  return (
    <Link to="/setup" className="flex items-center justify-between rounded-3xl bg-surface px-4 py-3 font-semibold ring-1 ring-line">
      <span>
        🧭 Set up her history <span className="font-normal text-muted">· {done} of 4 steps done</span>
      </span>
      <span aria-hidden className="text-brand">
        ›
      </span>
    </Link>
  );
}

function ReviewNudge({ count }: { count: number }) {
  if (!count)
    return (
      <div className="animate-pop rounded-3xl bg-good-soft px-4 py-3 text-center font-semibold text-good">
        All caught up 🎉 <span className="font-normal">Nothing needs a look.</span>
      </div>
    );
  return (
    <Link to="/review" className="flex items-center justify-between rounded-3xl bg-brand-soft px-4 py-3 font-semibold text-brand">
      <span>
        👀 {count} {count === 1 ? 'thing needs' : 'things need'} a look
      </span>
      <span aria-hidden>›</span>
    </Link>
  );
}

/** Horizontal bars per category group, each labelled with its amount (colour is never the only cue). */
function WhereItWent({ groups, total, uncategorized, from, to }: { groups: GroupTotal[]; total: number; uncategorized: number; from: string; to: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const { groups: allGroups } = useCategoryLookup();
  const max = Math.max(1, ...groups.map((g) => g.cents), uncategorized);
  const colorFor = (id: string) => `var(--g${(Math.max(0, allGroups.findIndex((g) => g.id === id)) % 7) + 1})`;

  if (!groups.length && !uncategorized) return <p className="py-4 text-center text-muted">No spending in this period yet.</p>;

  return (
    <ul className="space-y-1">
      {groups.map((g) => (
        <li key={g.id}>
          <button className="w-full rounded-2xl px-1 py-2 text-left hover:bg-surface-2" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="font-semibold">{g.name}</span>
              <span className="tabular font-semibold">
                {money(g.cents)} <span className="text-xs font-normal text-muted">{total > 0 ? Math.round((g.cents / total) * 100) : 0}%</span>
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-2">
              <div className="h-2.5 rounded-full" style={{ width: `${Math.max(2, (Math.max(0, g.cents) / max) * 100)}%`, background: colorFor(g.id) }} />
            </div>
          </button>
          {open === g.id && (
            <ul className="mb-2 ml-2 border-l-2 pl-3" style={{ borderColor: colorFor(g.id) }}>
              {g.categories.map((c) => (
                <li key={c.id}>
                  <Link to={`/activity?categoryId=${c.id}&from=${from}&to=${to}`} className="flex justify-between rounded-xl px-2 py-1.5 hover:bg-surface-2">
                    <span>
                      <span aria-hidden>{c.emoji}</span> {c.name}
                    </span>
                    <span className="tabular">{money(c.cents)} ›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
      {uncategorized > 0 && (
        <li>
          <Link to={`/activity?categoryId=none&from=${from}&to=${to}`} className="flex justify-between rounded-2xl px-1 py-2 text-ink-2 hover:bg-surface-2">
            <span>❔ Not categorised yet</span>
            <span className="tabular">{money(uncategorized)} ›</span>
          </Link>
        </li>
      )}
    </ul>
  );
}

function Accounts({ o }: { o: Overview }) {
  return (
    <Card>
      <SectionTitle action={<Link to="/import" className="text-sm font-semibold text-brand">Import ›</Link>}>By account</SectionTitle>
      <ul className="divide-y divide-line">
        {o.accounts.map((a) => {
          const fresh = o.freshness.find((f) => f.accountId === a.id);
          return (
            <li key={a.id}>
              <Link to={`/activity?accountId=${a.id}&from=${o.from}&to=${o.to}`} className="flex items-center gap-3 py-2.5">
                <span className="text-xl" aria-hidden>
                  {ACCOUNT_EMOJI[a.type]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{a.name}</span>
                  <span className="block text-xs text-muted">
                    {fresh?.lastImportAt ? `Updated ${timeAgo(fresh.lastImportAt)}` : 'Never imported'}
                    {fresh?.stale && ' · ⚠ due for an update'}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block text-sm text-ink-2">spent {money(a.spendingCents)}</span>
                  <span className="tabular block font-semibold">
                    {balanceText(a.type, a.balanceCents)} {a.balanced === true && <span title="Matches the bank">✓</span>}
                    {a.balanced === false && <span title="Doesn't match the bank">⚠</span>}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {o.netPositionCents != null && (
        <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
          <span className="font-semibold">
            Net position <span className="text-xs font-normal text-muted">(cash − card owed)</span>
          </span>
          <span className="tabular text-lg font-bold">{money(o.netPositionCents)}</span>
        </div>
      )}
      {!o.allBalancesKnown && (
        <p className="mt-2 text-xs text-muted">
          Some balances are unknown. <Link to="/more/accounts" className="text-brand">Add today's balance</Link> for a full picture.
        </p>
      )}
      {o.accounts.some((a) => a.balanced === false) && (
        <div className="mt-2">
          <Status tone="warn" icon="⚠">
            A balance doesn't match the bank. Something may be missing.
          </Status>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Showing {prettyDate(o.from, { year: true })} – {prettyDate(o.to, { year: true })}</p>
    </Card>
  );
}
