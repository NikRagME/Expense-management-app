/** Set up history (spec §12.3): bring every account up to date from the day it opened. */
import { useState } from 'react';
import { Link } from 'react-router';
import { parseAmount } from '../../../shared/money';
import { api, type SetupStatus } from '../api/client';
import { useApiMutation, useSetup } from '../api/hooks';
import { Button, Card, ErrorText, Input, Loading, PageHeader, Status } from '../components/ui';
import { ACCOUNT_EMOJI, balanceText, money, prettyDate } from '../lib/format';

type Row = SetupStatus['accounts'][number];

function StepCard({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? 'bg-good-soft text-good' : 'bg-brand-soft text-brand'}`} aria-hidden>
          {done ? '✓' : n}
        </span>
        <h2 className="flex-1 text-lg font-bold">{title}</h2>
        {done && (
          <Status tone="good" icon="✓">
            Done
          </Status>
        )}
      </div>
      {children}
    </Card>
  );
}

export function Setup() {
  const q = useSetup();
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorText error={q.error ?? 'Not available'} />;
  const s = q.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Set up history" back="/more" />
      <p className="text-ink-2">
        Bring every account up to date from the day it opened. Bank statements give the exact amounts; her spreadsheet adds her categories and notes.
      </p>

      {!s.accounts.length && (
        <Card>
          <p>
            First, <Link to="/more/accounts" className="font-semibold text-brand">add her accounts</Link> (Citi Checking, Citi Savings, SFCU Checking, SFCU Card, Venmo).
          </p>
        </Card>
      )}

      <StepCard n={1} title="When each account opened" done={s.steps.opening}>
        <p className="text-sm text-ink-2">The date and balance at opening (usually $0). A Citi PDF statement fills this in by itself.</p>
        <ul className="divide-y divide-line">
          {s.accounts.map((a) => (
            <OpeningRow key={`${a.id}-${a.openedOn}`} a={a} />
          ))}
        </ul>
      </StepCard>

      <StepCard n={2} title="Bank statements back to opening" done={s.steps.statements}>
        <p className="text-sm text-ink-2">Import every statement from the opening day to today. Overlaps are fine.</p>
        <ul className="divide-y divide-line">
          {s.accounts.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2.5">
              <span className="text-xl" aria-hidden>
                {ACCOUNT_EMOJI[a.type]}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-semibold">{a.name}</p>
                {a.ranges.length ? (
                  <p className="text-ink-2">Statements cover {a.ranges.map((r) => `${prettyDate(r.from)} – ${prettyDate(r.to, { year: true })}`).join(', ')}</p>
                ) : (
                  <p className="text-muted">No statements yet</p>
                )}
                {a.gaps.map((g) => (
                  <p key={g.from} className="text-warn">
                    ⚠ Missing {prettyDate(g.from)} – {prettyDate(g.to, { year: true })}
                  </p>
                ))}
              </div>
              <Link to={`/import?accountId=${a.id}`} className="shrink-0 rounded-2xl bg-surface-2 px-3 py-2 text-sm font-semibold">
                Import
              </Link>
            </li>
          ))}
        </ul>
      </StepCard>

      <StepCard n={3} title="Her spreadsheet" done={s.steps.spreadsheet}>
        <p className="text-sm text-ink-2">Upload her tracking sheet. Each row is matched to its bank line, and her categories, notes and descriptions are copied across.</p>
        {s.spreadsheets.map((x) => (
          <p key={x.id} className="text-sm">
            <b>{x.fileName}</b>: {x.rowsMatched} matched · {x.rowsAdded} added · {x.rowsUnmatched} to decide
          </p>
        ))}
        {s.unmatchedRows > 0 && (
          <Link to="/review" className="block rounded-2xl bg-brand-soft px-3 py-2 text-sm font-semibold text-brand">
            👀 {s.unmatchedRows} spreadsheet row{s.unmatchedRows === 1 ? '' : 's'} need a decision ›
          </Link>
        )}
        <Link to="/setup/spreadsheet" className="flex min-h-11 items-center justify-center rounded-2xl bg-brand font-semibold text-brand-ink">
          {s.spreadsheets.length ? 'Import another spreadsheet' : 'Bring in her spreadsheet'}
        </Link>
      </StepCard>

      <StepCard n={4} title="Check today's balances" done={s.steps.balances}>
        <p className="text-sm text-ink-2">Enter each balance from the bank's app. ✓ means everything from opening day to today adds up.</p>
        <ul className="divide-y divide-line">
          {s.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
              <span className="font-semibold">{a.name}</span>
              <span className="flex items-center gap-2">
                <span className="tabular">{balanceText(a.type, a.balanceCents)}</span>
                {a.balanced === true && (
                  <Status tone="good" icon="✓">
                    Balanced
                  </Status>
                )}
                {a.balanced === false && (
                  <Status tone="warn" icon="⚠">
                    Doesn't match
                  </Status>
                )}
              </span>
            </li>
          ))}
        </ul>
        <Link to="/more/accounts" className="flex min-h-11 items-center justify-center rounded-2xl bg-surface-2 font-semibold">
          Update balances
        </Link>
      </StepCard>
    </div>
  );
}

function OpeningRow({ a }: { a: Row }) {
  const [date, setDate] = useState(a.openedOn ?? '');
  const owed = a.type === 'credit_card';
  const [amount, setAmount] = useState(a.openingBalanceCents != null ? (Math.abs(a.openingBalanceCents) / 100).toFixed(2) : '0.00');
  const save = useApiMutation(() =>
    api(`/accounts/${a.id}/opening`, {
      method: 'PUT',
      body: { openedOn: date, cents: (owed ? -1 : 1) * Math.abs(parseAmount(amount) ?? 0) },
    }),
  );
  const dirty = date !== (a.openedOn ?? '') || (a.openingBalanceCents == null ? true : Math.abs(parseAmount(amount) ?? 0) !== Math.abs(a.openingBalanceCents));
  return (
    <li className="space-y-2 py-2.5">
      <div className="flex items-center gap-2">
        <span aria-hidden>{ACCOUNT_EMOJI[a.type]}</span>
        <span className="flex-1 font-semibold">{a.name}</span>
        {a.openedOn && (
          <span className="text-xs text-muted">
            opened {prettyDate(a.openedOn, { year: true })}
            {a.openingBalanceCents != null && ` with ${money(Math.abs(a.openingBalanceCents))}${owed ? ' owed' : ''}`}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
        <Input type="date" aria-label={`${a.name} opened on`} value={date} onChange={(e) => setDate(e.target.value)} />
        <Input inputMode="decimal" aria-label={`${a.name} ${owed ? 'owed' : 'balance'} at opening`} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Button className="min-h-11" disabled={!date || !dirty || save.isPending} onClick={() => save.mutate(undefined)}>
          Save
        </Button>
      </div>
      <ErrorText error={save.error} />
    </li>
  );
}
