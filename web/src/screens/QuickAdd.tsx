import { useState } from 'react';
import { Link } from 'react-router';
import { todayIso } from '../../../shared/dates';
import { parseAmount } from '../../../shared/money';
import { api, type Tx } from '../api/client';
import { useAccounts, useApiMutation, useMe } from '../api/hooks';
import { CategoryPicker } from '../components/CategoryPicker';
import { Button, Card, ErrorText, Field, Input, PageHeader, Select } from '../components/ui';
import { money } from '../lib/format';

const LAST_ACCOUNT = 'pocket.lastAccount';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_ACCOUNT);
  } catch {
    return null;
  }
}

/** Quick add (spec S5): amount → merchant → category → save. */
export function QuickAdd() {
  const me = useMe();
  const accounts = useAccounts();
  const usable = (accounts.data ?? []).filter((a) => !a.archived && a.type !== 'parent_paid');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string>(() => readLast() ?? '');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [parentPaid, setParentPaid] = useState(false);
  const [saved, setSaved] = useState<Tx | null>(null);

  const account = parentPaid ? 'parent_paid' : usable.some((a) => a.id === accountId) ? accountId : (usable[0]?.id ?? '');
  const cents = parseAmount(amount);

  const save = useApiMutation(
    () => api<Tx>('/transactions', { method: 'POST', body: { accountId: account, date, amountCents: -Math.abs(cents ?? 0), description: description.trim(), categoryId, note } }),
    {
      onSuccess: (tx) => {
        if (!parentPaid)
          try {
            localStorage.setItem(LAST_ACCOUNT, account);
          } catch {
            /* private mode */
          }
        setSaved(tx);
        setAmount('');
        setDescription('');
        setCategoryId(null);
        setNote('');
      },
    },
  );

  if (!accounts.isLoading && !usable.length)
    return (
      <Card className="mt-6 text-center">
        <p className="mb-3">Add an account first.</p>
        <Link to="/more/accounts" className="font-semibold text-brand">
          Go to accounts ›
        </Link>
      </Card>
    );

  return (
    <div className="space-y-4">
      <PageHeader title="Add expense" />
      {saved && (
        <div className="animate-pop rounded-2xl bg-good-soft px-4 py-3 font-semibold text-good">
          ✓ Added {saved.description} · {money(-saved.amountCents)}{' '}
          <Link to={`/tx/${saved.id}`} className="font-normal underline">
            view
          </Link>
        </div>
      )}
      <Card className="space-y-4">
        <label className="block text-center">
          <span className="sr-only">Amount</span>
          <span className="flex items-center justify-center text-5xl font-extrabold">
            <span className="text-muted">$</span>
            <input
              inputMode="decimal"
              autoFocus
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              className="tabular w-48 bg-transparent text-center outline-none placeholder:text-line"
              aria-label="Amount"
            />
          </span>
        </label>
        <Field label="What was it?">
          <Input placeholder="e.g. Coffee with Sam" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
        </Field>
        <div>
          <span className="mb-1 block text-sm font-semibold text-ink-2">Category</span>
          <CategoryPicker value={categoryId} onChange={setCategoryId} />
          <p className="mt-2 text-xs text-muted">Need to split it? Save it, then tap ✂️ Split on the transaction.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid with">
            <Select value={account} onChange={(e) => setAccountId(e.target.value)} disabled={parentPaid}>
              {parentPaid && <option value="parent_paid">Paid by parent</option>}
              {usable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        {me.data?.role === 'parent' && (
          <label className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-3">
            <input type="checkbox" className="size-5 accent-[var(--brand)]" checked={parentPaid} onChange={(e) => setParentPaid(e.target.checked)} />
            <span>
              <span className="block font-semibold">🤝 Paid by parent</span>
              <span className="block text-xs text-muted">Shows in her cost of living, not her spending</span>
            </span>
          </label>
        )}
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        </Field>
        <ErrorText error={save.error} />
        <Button variant="primary" className="w-full text-lg" disabled={!cents || cents <= 0 || !description.trim() || !account || save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </Card>
    </div>
  );
}
