import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { todayIso } from '../../../shared/dates';
import type { Tx } from '../api/client';
import { useAccounts, useCategoryLookup, useTransactions } from '../api/hooks';
import { PeriodSwitcher, usePeriod } from '../components/PeriodSwitcher';
import { TxRow } from '../components/TxRow';
import { Button, Card, Chip, Empty, ErrorText, Input, PageHeader, Select } from '../components/ui';
import { dayHeading, KIND_LABELS, money } from '../lib/format';

const PAGE = 100;

export function Activity() {
  const period = usePeriod();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [limit, setLimit] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(false);
  const accounts = useAccounts();
  const { categories, get } = useCategoryLookup();

  const filters = {
    from: period.from,
    to: period.to,
    accountId: params.get('accountId') ?? undefined,
    categoryId: params.get('categoryId') ?? undefined,
    kind: params.get('kind') ?? undefined,
    needsAttention: params.get('needsAttention') ?? undefined,
    parentPaid: params.get('parentPaid') ?? undefined,
    q: params.get('q') ?? undefined,
    limit: String(limit),
  };
  const list = useTransactions(filters);

  // Debounce search into the URL.
  useEffect(() => {
    const t = setTimeout(() => setFilter('q', search.trim() || null), 250);
    return () => clearTimeout(t);
  }, [search]);

  function setFilter(key: string, value: string | null) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
    setLimit(PAGE);
  }

  const active = ['accountId', 'categoryId', 'kind', 'needsAttention', 'parentPaid'].filter((k) => params.get(k));
  const category = filters.categoryId === 'none' ? { name: 'Uncategorised' } : get(filters.categoryId);
  const data = list.data;
  const groups = groupByDay(data?.items ?? []);
  const today = todayIso();

  const totalLabel = filters.parentPaid
    ? `Paid by parent: ${money(data?.parentPaidCents ?? 0)}`
    : `${category ? `${category.name}: ` : 'Spent: '}${money(data?.spendingCents ?? 0)}${data?.moneyInCents ? ` · In: ${money(data.moneyInCents)}` : ''}`;

  return (
    <div>
      <PageHeader title="Activity" />
      <PeriodSwitcher />
      <div className="mb-3 flex gap-2">
        <Input type="search" placeholder="Search merchant, note, Venmo…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
        <Button onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
          Filter{active.length ? ` (${active.length})` : ''}
        </Button>
      </div>

      {showFilters && (
        <Card className="mb-3 space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={filters.accountId ?? ''} onChange={(e) => setFilter('accountId', e.target.value || null)} aria-label="Account">
              <option value="">All accounts</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select value={filters.categoryId ?? ''} onChange={(e) => setFilter('categoryId', e.target.value || null)} aria-label="Category">
              <option value="">All categories</option>
              <option value="none">Uncategorised</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </Select>
            <Select value={filters.kind ?? ''} onChange={(e) => setFilter('kind', e.target.value || null)} aria-label="Kind">
              <option value="">All kinds</option>
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip active={!!filters.needsAttention} onClick={() => setFilter('needsAttention', filters.needsAttention ? null : '1')}>
              👀 Needs a look
            </Chip>
            <Chip active={!!filters.parentPaid} onClick={() => setFilter('parentPaid', filters.parentPaid ? null : '1')}>
              🤝 Paid by parent
            </Chip>
            {active.length > 0 && (
              <Chip onClick={() => active.forEach((k) => setFilter(k, null))} className="text-bad">
                Clear filters
              </Chip>
            )}
          </div>
        </Card>
      )}

      <ErrorText error={list.error} />
      {data && (
        <div className="mb-2 flex items-center justify-between px-1 text-sm">
          <span className="text-muted">
            {data.count} transaction{data.count === 1 ? '' : 's'}
          </span>
          <span className="tabular font-semibold">{totalLabel}</span>
        </div>
      )}

      {data && !data.items.length ? (
        <Card>
          <Empty emoji="🔍" title={active.length || filters.q ? 'Nothing matches' : 'No transactions yet'}>
            {active.length || filters.q ? 'Try a different search or filter.' : 'Import a statement or add an expense to get started.'}
          </Empty>
        </Card>
      ) : (
        groups.map(([day, txs]) => (
          <section key={day} className="mb-3">
            <h2 className="sticky top-0 z-[1] bg-bg/95 px-2 py-1 text-xs font-bold uppercase tracking-wider text-muted backdrop-blur">{dayHeading(day, today)}</h2>
            <Card className="p-1">
              {txs.map((t) => (
                <TxRow key={t.id} tx={t} />
              ))}
            </Card>
          </section>
        ))
      )}
      {data?.hasMore && (
        <Button className="w-full" onClick={() => setLimit((l) => l + PAGE)}>
          Show more
        </Button>
      )}
    </div>
  );
}

function groupByDay(items: Tx[]): [string, Tx[]][] {
  const map = new Map<string, Tx[]>();
  for (const t of items) map.set(t.date, [...(map.get(t.date) ?? []), t]);
  return [...map.entries()];
}
