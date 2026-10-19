import { useState } from 'react';
import { todayIso } from '../../../shared/dates';
import { parseAmount } from '../../../shared/money';
import { api, type RecurringItem } from '../api/client';
import { useApiMutation, useCategoryLookup, useRecurring, useTransactions } from '../api/hooks';
import { CategoryPicker } from '../components/CategoryPicker';
import { PeriodSwitcher, usePeriod } from '../components/PeriodSwitcher';
import { TxRow } from '../components/TxRow';
import { Button, Card, Empty, ErrorText, Field, Input, PageHeader, SectionTitle, Select, Sheet } from '../components/ui';
import { money, prettyDate } from '../lib/format';

const FREQ: Record<RecurringItem['frequency'], string> = { weekly: 'week', monthly: 'month', yearly: 'year' };

/** Costs the parent pays directly (spec S9). They count toward cost of living, not her spending. */
export function ParentPaid() {
  const period = usePeriod();
  const items = useRecurring();
  const list = useTransactions({ parentPaid: '1', from: period.from, to: period.to, limit: '200' });
  const [editing, setEditing] = useState<RecurringItem | 'new' | null>(null);
  const [oneOff, setOneOff] = useState(false);
  const { get } = useCategoryLookup();

  return (
    <div className="space-y-4">
      <PageHeader title="Paid by parent" back="/more" />
      <p className="text-sm text-ink-2">Costs paid on her behalf. They show in her cost of living so she sees the full picture, but not in her own spending.</p>

      <Card>
        <SectionTitle action={<Button variant="ghost" className="min-h-8 px-2 text-sm" onClick={() => setEditing('new')}>+ Recurring</Button>}>Recurring</SectionTitle>
        {!items.data?.length ? (
          <p className="py-2 text-sm text-muted">Nothing recurring yet, e.g. rent or a phone plan.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.data.map((i) => (
              <li key={i.id}>
                <button className="flex w-full items-center justify-between gap-2 py-2.5 text-left" onClick={() => setEditing(i)}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {get(i.categoryId)?.emoji} {i.name} {i.paused && <span className="text-xs font-normal text-muted">(paused)</span>}
                    </span>
                    <span className="block text-xs text-muted">
                      every {i.interval > 1 ? `${i.interval} ${FREQ[i.frequency]}s` : FREQ[i.frequency]} · next {prettyDate(i.nextDate)}
                    </span>
                  </span>
                  <span className="tabular font-semibold">{money(i.amountCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <PeriodSwitcher />
      <Card className="p-1">
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="text-sm font-semibold text-ink-2">Total {money(list.data?.parentPaidCents ?? 0)}</span>
          <Button variant="ghost" className="min-h-8 px-2 text-sm" onClick={() => setOneOff(true)}>
            + One-off cost
          </Button>
        </div>
        {list.data?.items.length ? list.data.items.map((t) => <TxRow key={t.id} tx={t} />) : <Empty emoji="🤝" title="Nothing for this period" />}
      </Card>

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New recurring cost' : 'Edit recurring cost'}>
        {editing && <RecurringForm item={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={oneOff} onClose={() => setOneOff(false)} title="One-off cost paid by parent">
        <OneOffForm onDone={() => setOneOff(false)} />
      </Sheet>
    </div>
  );
}

function RecurringForm({ item, onDone }: { item: RecurringItem | null; onDone: () => void }) {
  const [name, setName] = useState(item?.name ?? '');
  const [amount, setAmount] = useState(item ? (item.amountCents / 100).toFixed(2) : '');
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? null);
  const [frequency, setFrequency] = useState<RecurringItem['frequency']>(item?.frequency ?? 'monthly');
  const [nextDate, setNextDate] = useState(item?.nextDate ?? todayIso());
  const cents = parseAmount(amount);
  const body = { name: name.trim(), amountCents: Math.abs(cents ?? 0), categoryId, frequency, interval: 1, nextDate };
  const save = useApiMutation(() => (item ? api(`/recurring/${item.id}`, { method: 'PATCH', body }) : api('/recurring', { method: 'POST', body })), { onSuccess: onDone });
  const pause = useApiMutation(() => api(`/recurring/${item!.id}`, { method: 'PATCH', body: { paused: !item!.paused } }), { onSuccess: onDone });
  const remove = useApiMutation(() => api(`/recurring/${item!.id}`, { method: 'DELETE' }), { onSuccess: onDone });
  return (
    <div className="space-y-3">
      <Field label="What is it?">
        <Input placeholder="e.g. Phone plan" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Every">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as RecurringItem['frequency'])}>
            <option value="weekly">Week</option>
            <option value="monthly">Month</option>
            <option value="yearly">Year</option>
          </Select>
        </Field>
      </div>
      <Field label={item ? 'Next date' : 'First date'} hint="Past dates are filled in automatically.">
        <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
      </Field>
      <div>
        <span className="mb-1 block text-sm font-semibold text-ink-2">Category</span>
        <CategoryPicker value={categoryId} onChange={setCategoryId} />
      </div>
      <ErrorText error={save.error ?? pause.error ?? remove.error} />
      <Button variant="primary" className="w-full" disabled={!name.trim() || !cents} onClick={() => save.mutate(undefined)}>
        Save
      </Button>
      {item && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => pause.mutate(undefined)}>{item.paused ? 'Resume' : 'Pause'}</Button>
          <Button variant="danger" onClick={() => confirm('Stop this recurring cost? Past entries stay.') && remove.mutate(undefined)}>
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

function OneOffForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayIso());
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const cents = parseAmount(amount);
  const save = useApiMutation(
    () => api('/transactions', { method: 'POST', body: { accountId: 'parent_paid', date, amountCents: -Math.abs(cents ?? 0), description: name.trim(), categoryId } }),
    { onSuccess: onDone },
  );
  return (
    <div className="space-y-3">
      <Field label="What was it?">
        <Input placeholder="e.g. Textbook" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <Input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <CategoryPicker value={categoryId} onChange={setCategoryId} />
      <ErrorText error={save.error} />
      <Button variant="primary" className="w-full" disabled={!name.trim() || !cents} onClick={() => save.mutate(undefined)}>
        Add
      </Button>
    </div>
  );
}
