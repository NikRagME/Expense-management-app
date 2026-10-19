import { useState } from 'react';
import { Link } from 'react-router';
import { todayIso } from '../../../shared/dates';
import { parseAmount } from '../../../shared/money';
import { ACCOUNT_TYPES, type AccountType } from '../../../shared/types';
import { api, type Account } from '../api/client';
import { useAccounts, useApiMutation } from '../api/hooks';
import { Button, Card, ErrorText, Field, Input, Loading, PageHeader, Select, Sheet, Status } from '../components/ui';
import { ACCOUNT_EMOJI, ACCOUNT_TYPE_LABELS, balanceText, money, prettyDate, timeAgo } from '../lib/format';

/** Credit cards are entered as "amount owed" (positive) and stored negative. */
const toStored = (type: AccountType, cents: number) => (type === 'credit_card' ? -Math.abs(cents) : cents);

export function Accounts() {
  const q = useAccounts();
  const [adding, setAdding] = useState(false);
  const [balanceFor, setBalanceFor] = useState<Account | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  if (q.isLoading) return <Loading />;
  const all = (q.data ?? []).filter((a) => a.type !== 'parent_paid');
  const list = all.filter((a) => showArchived || !a.archived);

  return (
    <div className="space-y-4">
      <PageHeader title="Accounts" back="/more" action={<Button variant="primary" onClick={() => setAdding(true)}>+ Add</Button>} />
      <ErrorText error={q.error} />
      {list.map((a) => (
        <Card key={a.id} className={a.archived ? 'opacity-60' : ''}>
          <div className="flex items-start gap-3">
            <span className="text-3xl" aria-hidden>
              {ACCOUNT_EMOJI[a.type]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold">
                {a.name} {a.archived && <span className="text-xs font-normal text-muted">(archived)</span>}
              </p>
              <p className="text-sm text-muted">
                {[a.institution, ACCOUNT_TYPE_LABELS[a.type]].filter(Boolean).join(' · ')}
              </p>
              <p className="tabular mt-2 text-2xl font-extrabold">{balanceText(a.type, a.balanceCents)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                {a.asOf && <span>as of {prettyDate(a.asOf, { year: true })}</span>}
                {a.balanced === true && (
                  <Status tone="good" icon="✓">
                    Balanced
                  </Status>
                )}
                {a.balanced === false && (
                  <Status tone="warn" icon="⚠">
                    Off by {money(Math.abs(a.lastDifferenceCents ?? 0))}
                  </Status>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                {a.lastImportAt ? `Last import ${timeAgo(a.lastImportAt)}` : 'Never imported'}
                {a.transactionsThrough && ` · transactions through ${prettyDate(a.transactionsThrough)}`}
              </p>
            </div>
          </div>
          {!a.archived && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button className="min-h-9" onClick={() => setBalanceFor(a)}>
                Update balance
              </Button>
              <Link to={`/import?accountId=${a.id}`} className="inline-flex min-h-9 items-center rounded-2xl bg-surface-2 px-4 text-[15px] font-semibold">
                Import
              </Link>
              <Button variant="ghost" className="min-h-9" onClick={() => setEditing(a)}>
                Edit
              </Button>
            </div>
          )}
          {a.archived && (
            <Button variant="ghost" className="mt-2 min-h-9" onClick={() => setEditing(a)}>
              Edit / restore
            </Button>
          )}
        </Card>
      ))}
      {all.some((a) => a.archived) && (
        <button className="w-full text-sm font-semibold text-muted" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? 'Hide archived accounts' : 'Show archived accounts'}
        </button>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Add an account">
        <AddAccount onDone={() => setAdding(false)} />
      </Sheet>
      <Sheet open={!!balanceFor} onClose={() => setBalanceFor(null)} title={`Balance · ${balanceFor?.name ?? ''}`}>
        {balanceFor && <UpdateBalance account={balanceFor} />}
      </Sheet>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title="Edit account">
        {editing && <EditAccount account={editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </div>
  );
}

function AddAccount({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [balance, setBalance] = useState('');
  const [asOf, setAsOf] = useState(todayIso());
  const cents = parseAmount(balance);
  const add = useApiMutation(
    () =>
      api('/accounts', {
        method: 'POST',
        body: { name: name.trim(), institution: institution.trim(), type, ...(cents != null ? { startingBalance: { cents: toStored(type, cents), asOf } } : {}) },
      }),
    { onSuccess: onDone },
  );
  return (
    <div className="space-y-3">
      <Field label="Name">
        <Input placeholder="e.g. Citi Checking" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bank / app">
          <Input placeholder="e.g. Citibank" value={institution} onChange={(e) => setInstitution(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.filter((t) => t !== 'parent_paid').map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={type === 'credit_card' ? 'Amount owed today' : 'Balance today'} hint="From the bank's app. Optional, but needed for balances.">
          <Input inputMode="decimal" placeholder="0.00" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </Field>
        <Field label="As of">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
      </div>
      <ErrorText error={add.error} />
      <Button variant="primary" className="w-full" disabled={!name.trim() || add.isPending} onClick={() => add.mutate(undefined)}>
        Add account
      </Button>
    </div>
  );
}

function UpdateBalance({ account }: { account: Account }) {
  const [value, setValue] = useState('');
  const [asOf, setAsOf] = useState(todayIso());
  const cents = parseAmount(value);
  const update = useApiMutation(() =>
    api<{ computedCents: number | null; differenceCents: number | null; cents: number }>(`/accounts/${account.id}/balance`, {
      method: 'POST',
      body: { cents: toStored(account.type, cents ?? 0), asOf },
    }),
  );
  const r = update.data;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">Type the balance shown in the bank's app. We'll check it against what Pocket has.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={account.type === 'credit_card' ? 'Amount owed' : 'Balance'}>
          <Input inputMode="decimal" placeholder="0.00" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        </Field>
        <Field label="As of (end of day)">
          <Input type="date" value={asOf} max={todayIso()} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
      </div>
      <ErrorText error={update.error} />
      {r &&
        (r.differenceCents == null ? (
          <Status tone="muted" icon="📌">
            Saved as the starting balance
          </Status>
        ) : r.differenceCents === 0 ? (
          <Status tone="good" icon="✓">
            Balanced! Everything matches the bank
          </Status>
        ) : (
          <div className="rounded-2xl bg-warn-soft p-3 text-sm text-warn">
            ⚠ Off by {money(Math.abs(r.differenceCents))}. Pocket expected {balanceText(account.type, r.computedCents)}. Something may be missing or duplicated. The bank's figure is now used.{' '}
            <Link to={`/activity?accountId=${account.id}`} className="font-semibold underline">
              Check transactions
            </Link>
          </div>
        ))}
      <Button variant="primary" className="w-full" disabled={cents == null || update.isPending} onClick={() => update.mutate(undefined)}>
        Save balance
      </Button>
    </div>
  );
}

function EditAccount({ account, onDone }: { account: Account; onDone: () => void }) {
  const [name, setName] = useState(account.name);
  const [institution, setInstitution] = useState(account.institution);
  const [type, setType] = useState<AccountType>(account.type);
  const save = useApiMutation((body: Record<string, unknown>) => api(`/accounts/${account.id}`, { method: 'PATCH', body }), { onSuccess: onDone });
  return (
    <div className="space-y-3">
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bank / app">
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.filter((t) => t !== 'parent_paid').map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorText error={save.error} />
      <Button variant="primary" className="w-full" disabled={!name.trim()} onClick={() => save.mutate({ name: name.trim(), institution: institution.trim(), type })}>
        Save
      </Button>
      {account.importMapping && (
        <Button className="w-full" onClick={() => save.mutate({ importMapping: null })}>
          Reset saved import columns
        </Button>
      )}
      <Button
        variant="danger"
        className="w-full"
        onClick={() => (account.archived || confirm(`Archive ${account.name}? Its history stays in all past totals.`)) && save.mutate({ archived: !account.archived })}
      >
        {account.archived ? 'Restore account' : 'Archive account'}
      </Button>
    </div>
  );
}
