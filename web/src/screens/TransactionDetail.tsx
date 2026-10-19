import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Kind } from '../../../shared/types';
import { api, type TxDetail } from '../api/client';
import { useApiMutation, useCategoryLookup, useTransaction } from '../api/hooks';
import { CategoryPicker } from '../components/CategoryPicker';
import { SplitEditor } from '../components/SplitEditor';
import { Button, Card, Chip, ErrorText, Field, Input, Loading, PageHeader, SectionTitle, Sheet, Status } from '../components/ui';
import { ATTENTION_LABELS, KIND_LABELS, money, prettyDate, timeAgo } from '../lib/format';

const SPENDY: Kind[] = ['spend', 'refund', 'repayment', 'parent_paid'];

export function TransactionDetail() {
  const { id } = useParams();
  const q = useTransaction(id);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorText error={q.error ?? 'Not found'} />;
  return <Detail tx={q.data} />;
}

function Detail({ tx }: { tx: TxDetail }) {
  const navigate = useNavigate();
  const { get } = useCategoryLookup();
  const [splitting, setSplitting] = useState(false);
  const [askRule, setAskRule] = useState<string | null>(null);
  const [note, setNote] = useState(tx.note);
  const [desc, setDesc] = useState(tx.description);

  const patch = useApiMutation((body: Record<string, unknown>) => api(`/transactions/${tx.id}`, { method: 'PATCH', body }));
  const unsplit = useApiMutation(() => api(`/transactions/${tx.id}/splits`, { method: 'DELETE' }));
  const link = useApiMutation((spendId: string) => api(`/transactions/${tx.id}/links`, { method: 'POST', body: { type: 'repayment', toId: spendId } }));
  const unlink = useApiMutation((linkId: string) => api(`/transactions/${tx.id}/links/${linkId}`, { method: 'DELETE' }));
  const remove = useApiMutation(() => api(`/transactions/${tx.id}`, { method: 'DELETE' }), { onSuccess: () => navigate(-1) });

  const isManual = tx.source === 'manual' || tx.source === 'recurring';
  const isSplit = tx.lines.length > 1;
  const category = get(tx.lines[0]?.categoryId);
  const merchant = tx.merchantName ?? tx.description;
  const transferLink = tx.links.find((l) => l.type === 'transfer');
  const repaymentLink = tx.links.find((l) => l.type === 'repayment' && l.direction === 'out');
  const repaidBy = tx.links.filter((l) => l.type === 'repayment' && l.direction === 'in');
  const kinds: Kind[] = tx.accountType === 'parent_paid' ? ['parent_paid'] : tx.amountCents < 0 ? ['spend', 'transfer'] : ['income', 'refund', 'repayment', 'transfer'];
  const error = patch.error ?? unsplit.error ?? link.error ?? unlink.error ?? remove.error;

  return (
    <div className="space-y-4">
      <PageHeader title="Transaction" back />

      <Card className="text-center">
        <p className={`tabular text-4xl font-extrabold ${tx.amountCents > 0 && tx.kind !== 'transfer' ? 'text-good' : ''}`}>
          {tx.amountCents > 0 ? money(tx.amountCents, { sign: true }) : money(-tx.amountCents)}
        </p>
        <p className="mt-1 text-lg font-semibold">{tx.description}</p>
        <p className="text-sm text-muted">
          {prettyDate(tx.date, { year: true })} · {tx.accountName}
        </p>
        {tx.paymentNote && <p className="mt-1 text-ink-2">“{tx.paymentNote}”</p>}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {tx.kind === 'transfer' && (
            <Status tone="muted" icon="↔">
              Transfer · not counted as spending
            </Status>
          )}
          {tx.excluded && (
            <Status tone="muted" icon="⦸">
              Excluded
            </Status>
          )}
          {tx.needsAttention && (
            <Status tone="warn" icon="👀">
              {ATTENTION_LABELS[tx.needsAttention]}
            </Status>
          )}
        </div>
      </Card>

      <ErrorText error={error} />

      <Card className="space-y-4">
        <div>
          <SectionTitle>What is this?</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {kinds.map((k) => (
              <Chip key={k} active={tx.kind === k} onClick={() => patch.mutate({ kind: k })}>
                {KIND_LABELS[k]}
              </Chip>
            ))}
          </div>
        </div>

        {SPENDY.includes(tx.kind) && (
          <div>
            <SectionTitle
              action={
                isSplit ? (
                  <span className="flex gap-1">
                    <Button variant="ghost" className="min-h-8 px-2 text-sm" onClick={() => setSplitting(true)}>
                      Edit split
                    </Button>
                    <Button variant="ghost" className="min-h-8 px-2 text-sm" onClick={() => unsplit.mutate(undefined)}>
                      Un-split
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" className="min-h-8 px-2 text-sm" onClick={() => setSplitting(true)}>
                    ✂️ Split
                  </Button>
                )
              }
            >
              Category
            </SectionTitle>
            {isSplit ? (
              <ul className="space-y-1">
                {tx.lines.map((l) => {
                  const c = get(l.categoryId);
                  return (
                    <li key={l.id} className="flex justify-between rounded-xl bg-surface-2 px-3 py-2">
                      <span>{c ? `${c.emoji} ${c.name}` : '❔ Uncategorised'}</span>
                      <span className="tabular font-semibold">{money(Math.abs(l.amountCents))}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <CategoryPicker
                value={category?.id ?? null}
                onChange={(categoryId) => {
                  patch.mutate({ categoryId });
                  if (tx.source !== 'recurring') setAskRule(categoryId);
                }}
              />
            )}
            {askRule && !isSplit && (
              <div className="animate-pop mt-3 rounded-2xl bg-brand-soft p-3">
                <p className="mb-2 text-sm font-semibold">
                  Always put <b>{merchant}</b> in <b>{get(askRule)?.name}</b>?
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    className="min-h-9"
                    onClick={() => {
                      patch.mutate({ categoryId: askRule, createRule: true });
                      setAskRule(null);
                    }}
                  >
                    Yes, always
                  </Button>
                  <Button className="min-h-9" onClick={() => setAskRule(null)}>
                    Just this once
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        <Field label="Name">
          <Input value={desc} onChange={(e) => setDesc(e.target.value)} onBlur={() => desc.trim() && desc !== tx.description && patch.mutate({ description: desc.trim() })} />
        </Field>
        <Field label="Note">
          <Input value={note} placeholder="Add a note…" onChange={(e) => setNote(e.target.value)} onBlur={() => note !== tx.note && patch.mutate({ note })} />
        </Field>
      </Card>

      {(transferLink || repaymentLink || repaidBy.length > 0 || tx.repaymentCandidates.length > 0) && (
        <Card className="space-y-3">
          <SectionTitle>Linked</SectionTitle>
          {transferLink?.other && (
            <LinkedRow label={transferLink.direction === 'out' ? 'Money went to' : 'Money came from'} other={transferLink.other} />
          )}
          {tx.kind === 'transfer' && !transferLink && <p className="text-sm text-muted">The other side hasn't been imported yet. It'll pair up automatically.</p>}
          {repaymentLink?.other && (
            <div>
              <LinkedRow label="Pays back" other={repaymentLink.other} />
              <p className="mt-1 text-sm text-ink-2">
                Your share was {money(Math.max(0, -repaymentLink.other.amountCents - tx.amountCents))}.{' '}
                <button className="text-brand" onClick={() => unlink.mutate(repaymentLink.id)}>
                  Unlink
                </button>
              </p>
            </div>
          )}
          {repaidBy.map((l) => l.other && <LinkedRow key={l.id} label="Paid back by" other={l.other} />)}
          {!repaymentLink && tx.amountCents > 0 && tx.kind !== 'transfer' && tx.repaymentCandidates.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">Is this paying you back for one of these?</p>
              <div className="space-y-1">
                {tx.repaymentCandidates.map((c) => (
                  <button key={c.id} className="flex w-full justify-between rounded-xl bg-surface-2 px-3 py-2 text-left hover:ring-1 hover:ring-brand" onClick={() => link.mutate(c.id)}>
                    <span className="truncate">
                      {c.description} <span className="text-xs text-muted">{prettyDate(c.date)}</span>
                    </span>
                    <span className="tabular">{money(-c.amountCents)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-2 text-sm">
        <SectionTitle>Details</SectionTitle>
        {tx.rawDescription && tx.rawDescription !== tx.description && (
          <p>
            <span className="text-muted">Bank says:</span> <span className="font-mono text-xs">{tx.rawDescription}</span>
          </p>
        )}
        <p className="text-muted">
          {tx.source === 'import' ? 'Imported from statement' : tx.source === 'recurring' ? 'Added automatically (recurring)' : `Added by ${tx.createdByName ?? 'someone'}`} ·{' '}
          {timeAgo(tx.createdAt)}
        </p>
        {tx.history.slice(0, 5).map((h, i) => (
          <p key={i} className="text-muted">
            {historyText(h.action)} by {h.userName ?? 'the app'} · {timeAgo(h.at)}
          </p>
        ))}
        <div className="flex flex-wrap gap-2 pt-2">
          {!isManual && (
            <Button onClick={() => patch.mutate({ excluded: !tx.excluded })}>{tx.excluded ? 'Include again' : 'Exclude from totals'}</Button>
          )}
          {isManual && (
            <Button variant="danger" onClick={() => confirm('Delete this transaction?') && remove.mutate(undefined)}>
              Delete
            </Button>
          )}
        </div>
      </Card>

      <Sheet open={splitting} onClose={() => setSplitting(false)} title="Split across categories">
        <SplitEditor tx={tx} onDone={() => setSplitting(false)} />
      </Sheet>
    </div>
  );
}

function LinkedRow({ label, other }: { label: string; other: NonNullable<TxDetail['links'][number]['other']> }) {
  return (
    <Link to={`/tx/${other.id}`} className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 hover:ring-1 hover:ring-brand">
      <span className="min-w-0">
        <span className="block text-xs text-muted">{label}</span>
        <span className="block truncate font-semibold">
          {other.description} · {other.accountName}
        </span>
      </span>
      <span className="tabular shrink-0">{money(Math.abs(other.amountCents))} ›</span>
    </Link>
  );
}

function historyText(action: string): string {
  return (
    {
      create: 'Created',
      update: 'Edited',
      split: 'Split',
      unsplit: 'Un-split',
      merge: 'Merged with a quick-add',
      repayment_link: 'Linked as a repayment',
      unlink: 'Unlinked',
      dismiss: 'Marked as OK',
    }[action] ?? action
  );
}
