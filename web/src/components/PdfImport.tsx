/** Importing a PDF statement that covers several accounts (Citi checking + savings). */
import { useState } from 'react';
import { Link } from 'react-router';
import { suggestAccount } from '../../../shared/history';
import type { ParsedStatement } from '../../../shared/types';
import { api, type Account, type ImportPreview } from '../api/client';
import { useApiMutation } from '../api/hooks';
import { money, prettyDate } from '../lib/format';
import { Button, Card, ErrorText, Field, SectionTitle, Select, Status } from './ui';

interface Props {
  fileName: string;
  fileHash: string;
  statements: ParsedStatement[];
  accounts: Account[];
  onDone: () => void;
}

export function PdfImport({ fileName, fileHash, statements, accounts, onDone }: Props) {
  const [targets, setTargets] = useState<string[]>(() =>
    statements.map((s) => (s.section ? (suggestAccount(s.section.label, accounts) ?? '') : '')),
  );
  const [previews, setPreviews] = useState<(ImportPreview | null)[] | null>(null);
  const [done, setDone] = useState<ImportPreview[] | null>(null);

  const bodyFor = (s: ParsedStatement, i: number) => ({
    accountId: targets[i],
    fileName,
    fileHash: `${fileHash}:${s.section?.kind ?? i}`,
    format: 'pdf' as const,
    rows: s.rows,
    openingBalance: s.openingBalance ?? null,
    balance: s.balance ?? null,
    mapping: null,
  });
  const chosen = statements.map((s, i) => ({ s, i })).filter(({ i }) => targets[i]);

  const preview = useApiMutation(
    async () => Promise.all(statements.map((s, i) => (targets[i] ? api<ImportPreview>('/imports/preview', { method: 'POST', body: bodyFor(s, i) }) : null))),
    { onSuccess: setPreviews },
  );
  const commit = useApiMutation(
    async () => {
      const out: ImportPreview[] = [];
      for (const { s, i } of chosen) out.push(await api<ImportPreview>('/imports', { method: 'POST', body: bodyFor(s, i) }));
      return out;
    },
    { onSuccess: setDone },
  );

  if (done) {
    const total = done.reduce((a, r) => a + r.summary.new, 0);
    const attention = done.reduce((a, r) => a + r.summary.needsAttention, 0);
    return (
      <Card className="animate-pop space-y-3 text-center">
        <div className="text-5xl">🎉</div>
        <p className="text-lg font-bold">
          {total} transactions imported · {attention} need a look
        </p>
        {done.map((r, k) => r.balance && <BalanceLine key={k} b={r.balance} />)}
        <div className="flex flex-col gap-2">
          {attention > 0 && (
            <Link to="/review" className="flex min-h-11 items-center justify-center rounded-2xl bg-brand font-semibold text-brand-ink">
              Review {attention} now 👀
            </Link>
          )}
          <Button onClick={onDone}>Import another statement</Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {statements.map((s, i) => {
        const p = previews?.[i];
        return (
          <Card key={i} className="space-y-3">
            <SectionTitle>{s.section?.label ?? `Section ${i + 1}`}{s.section?.last4 ? ` ··${s.section.last4}` : ''}</SectionTitle>
            <p className="text-sm text-ink-2">
              {s.rows.length} transactions
              {s.openingBalance && ` · starts at ${money(s.openingBalance.cents)} (${prettyDate(s.openingBalance.asOf, { year: true })})`}
              {s.balance && ` · ends at ${money(s.balance.cents)} (${prettyDate(s.balance.asOf, { year: true })})`}
            </p>
            <Field label="Import into">
              <Select
                value={targets[i]}
                onChange={(e) => {
                  setTargets((t) => t.map((x, j) => (j === i ? e.target.value : x)));
                  setPreviews(null);
                }}
              >
                <option value="">Don't import this section</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            {p && (
              <ul className="space-y-1 text-[15px]">
                <li>✓ {p.summary.new} new</li>
                <li className="text-muted">⤼ {p.summary.duplicates} already here (skipped)</li>
                <li>↔ {p.summary.transfersMatched} transfers matched</li>
                <li>👀 {p.summary.needsAttention} need a look</li>
                {p.balance && (
                  <li>
                    <BalanceLine b={p.balance} />
                  </li>
                )}
              </ul>
            )}
          </Card>
        );
      })}
      <ErrorText error={preview.error ?? commit.error} />
      {!previews ? (
        <Button variant="primary" className="w-full" disabled={!chosen.length || preview.isPending} onClick={() => preview.mutate(undefined)}>
          {preview.isPending ? 'Checking…' : 'Preview import'}
        </Button>
      ) : (
        <Button variant="primary" className="w-full" disabled={commit.isPending} onClick={() => commit.mutate(undefined)}>
          {commit.isPending ? 'Importing…' : `Import ${previews.reduce((a, p) => a + (p?.summary.new ?? 0), 0)} transactions`}
        </Button>
      )}
    </div>
  );
}

export function BalanceLine({ b }: { b: NonNullable<ImportPreview['balance']> }) {
  if (b.differenceCents == null) return <span className="text-sm text-ink-2">Statement balance {money(b.cents)} on {prettyDate(b.asOf)}</span>;
  if (b.differenceCents === 0)
    return (
      <Status tone="good" icon="✓">
        Balanced: {money(b.cents)} matches the bank
      </Status>
    );
  return (
    <Status tone="warn" icon="⚠">
      Off by {money(Math.abs(b.differenceCents))}. Something may be missing or duplicated
    </Status>
  );
}
