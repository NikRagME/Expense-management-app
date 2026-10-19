import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { detectFormat, guessMapping, parseCsv, parseCsvText, parseOfx, parseVenmo } from '../../../shared/parsers';
import type { CsvMapping, ParsedStatement } from '../../../shared/types';
import { api, type Account, type ImportBody, type ImportPreview } from '../api/client';
import { useAccounts, useApiMutation, useCategoryLookup } from '../api/hooks';
import { Button, Card, ErrorText, Field, PageHeader, SectionTitle, Select, Status } from '../components/ui';
import { KIND_LABELS, money, prettyDate } from '../lib/format';

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const HOW_TO: Record<string, string[]> = {
  citi: ['Sign in at citi.com on a computer', 'Open the account → "Download transactions"', 'Pick the date range and choose CSV (or Quicken/QFX)'],
  sfcu: ['Sign in to SFCU online banking', 'Open the account → "Export" / "Download"', 'Choose QFX/OFX if offered (best), otherwise CSV'],
  venmo: ['Go to venmo.com on a computer and sign in', 'Open "Statements"', 'Pick the month and click "Download CSV"'],
};

function howToFor(a: Account | undefined): string[] {
  const s = `${a?.institution ?? ''} ${a?.name ?? ''}`.toLowerCase();
  if (s.includes('venmo')) return HOW_TO.venmo;
  if (s.includes('citi')) return HOW_TO.citi;
  if (s.includes('sfcu') || s.includes('stanford')) return HOW_TO.sfcu;
  return ["Sign in to the bank's website", 'Find "Download" or "Export" transactions', 'Choose CSV, OFX or QFX'];
}

export function Import() {
  const accounts = useAccounts();
  const [params] = useSearchParams();
  const usable = (accounts.data ?? []).filter((a) => !a.archived && a.type !== 'parent_paid');
  const [accountId, setAccountId] = useState(params.get('accountId') ?? '');
  const account = usable.find((a) => a.id === accountId) ?? usable[0];
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [editMapping, setEditMapping] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<ImportPreview | null>(null);

  const format = file ? detectFormat(file.text) : null;
  const effectiveMapping = mapping ?? account?.importMapping ?? (file && format === 'csv' ? guessMapping(parseCsvText(file.text)) : null);
  const needsMapping = format === 'csv' && (!account?.importMapping || editMapping);

  const parsed: ParsedStatement | null = useMemo(() => {
    if (!file || !format) return null;
    if (format === 'ofx') return parseOfx(file.text);
    if (format === 'venmo') return parseVenmo(file.text);
    return effectiveMapping ? parseCsv(file.text, effectiveMapping) : null;
  }, [file, format, effectiveMapping]);

  const body = async (): Promise<ImportBody> => ({
    accountId: account!.id,
    fileName: file!.name,
    fileHash: await sha256(file!.text),
    format: parsed!.format,
    rows: parsed!.rows,
    balance: parsed!.balance ?? null,
    mapping: format === 'csv' ? effectiveMapping : null,
  });

  const doPreview = useApiMutation(async () => api<ImportPreview>('/imports/preview', { method: 'POST', body: await body() }), { onSuccess: setPreview });
  const doImport = useApiMutation(async () => api<ImportPreview>('/imports', { method: 'POST', body: await body() }), {
    onSuccess: (r) => {
      setDone(r);
      setPreview(null);
      setFile(null);
      setMapping(null);
      setEditMapping(false);
    },
  });

  if (done) return <ImportDone result={done} onAnother={() => setDone(null)} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Import a statement" back="/" action={<Link to="/more/imports" className="text-sm font-semibold text-brand">History</Link>} />

      <Card className="space-y-4">
        <Field label="Account" hint={account?.transactionsThrough ? `Has transactions through ${prettyDate(account.transactionsThrough, { year: true })}` : 'No transactions yet'}>
          <Select
            value={account?.id ?? ''}
            onChange={(e) => {
              setAccountId(e.target.value);
              setPreview(null);
              setMapping(null);
            }}
          >
            {usable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <details className="rounded-2xl bg-surface-2 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold">How do I download this statement?</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-2">
            {howToFor(account).map((s) => (
              <li key={s}>{s}</li>
            ))}
            <li>Overlapping dates are fine. Duplicates are skipped automatically.</li>
          </ol>
        </details>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink-2">Statement file (CSV, OFX, QFX)</span>
          <input
            type="file"
            accept=".csv,.ofx,.qfx,.txt,text/csv"
            className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-2xl file:border-0 file:bg-brand file:px-4 file:font-semibold file:text-brand-ink"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              setPreview(null);
              setMapping(null);
              setFile(f ? { name: f.name, text: await f.text() } : null);
            }}
          />
        </label>
        {file && format && (
          <p className="text-sm text-ink-2">
            Detected <b>{format === 'ofx' ? 'OFX/QFX' : format === 'venmo' ? 'Venmo statement' : 'CSV'}</b>
            {parsed && ` · ${parsed.rows.length} transactions`}
            {parsed?.balance && ` · balance ${money(parsed.balance.cents)} on ${prettyDate(parsed.balance.asOf)}`}
            {format === 'csv' && account?.importMapping && !editMapping && (
              <>
                {' · '}
                <button className="text-brand" onClick={() => setEditMapping(true)}>
                  change columns
                </button>
              </>
            )}
          </p>
        )}
      </Card>

      {file && needsMapping && effectiveMapping && (
        <MappingEditor
          text={file.text}
          mapping={effectiveMapping}
          onChange={(m) => {
            setMapping(m);
            setPreview(null);
          }}
        />
      )}

      {parsed && parsed.errors.length > 0 && (
        <Card>
          <Status tone="warn" icon="⚠">
            {parsed.errors.length} line{parsed.errors.length > 1 ? 's' : ''} couldn't be read
          </Status>
          <ul className="mt-2 text-xs text-muted">
            {parsed.errors.slice(0, 5).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Card>
      )}

      <ErrorText error={doPreview.error ?? doImport.error} />

      {parsed && !preview && (
        <Button variant="primary" className="w-full" disabled={!parsed.rows.length || doPreview.isPending} onClick={() => doPreview.mutate(undefined)}>
          {doPreview.isPending ? 'Checking…' : 'Preview import'}
        </Button>
      )}

      {preview && <PreviewCard preview={preview} onImport={() => doImport.mutate(undefined)} busy={doImport.isPending} />}
    </div>
  );
}

function MappingEditor({ text, mapping, onChange }: { text: string; mapping: CsvMapping; onChange: (m: CsvMapping) => void }) {
  const rows = parseCsvText(text);
  const header = rows[mapping.skipRows] ?? [];
  const sample = parseCsv(text, mapping).rows.slice(0, 5);
  const cols = header.map((h, i) => ({ i, label: mapping.hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}` }));
  const split = mapping.amountCol === undefined;
  const colSelect = (label: string, value: number | undefined, set: (v: number | undefined) => void, optional = false) => (
    <Field label={label}>
      <Select value={value ?? ''} onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}>
        {optional && <option value="">None</option>}
        {cols.map((c) => (
          <option key={c.i} value={c.i}>
            {c.label}
          </option>
        ))}
      </Select>
    </Field>
  );

  return (
    <Card className="space-y-3">
      <SectionTitle>Match the columns (first time only)</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {colSelect('Date', mapping.dateCol, (v) => onChange({ ...mapping, dateCol: v ?? 0 }))}
        {colSelect('Description', mapping.descriptionCol, (v) => onChange({ ...mapping, descriptionCol: v ?? 0 }))}
      </div>
      <Field label="Amounts are in">
        <Select
          value={split ? 'split' : 'single'}
          onChange={(e) =>
            onChange(
              e.target.value === 'split'
                ? { ...mapping, amountCol: undefined, debitCol: mapping.debitCol ?? 0, creditCol: mapping.creditCol ?? 0 }
                : { ...mapping, amountCol: mapping.amountCol ?? 0, debitCol: undefined, creditCol: undefined },
            )
          }
        >
          <option value="single">One amount column</option>
          <option value="split">Separate debit & credit columns</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        {split ? (
          <>
            {colSelect('Money out (debit)', mapping.debitCol, (v) => onChange({ ...mapping, debitCol: v }))}
            {colSelect('Money in (credit)', mapping.creditCol, (v) => onChange({ ...mapping, creditCol: v }))}
          </>
        ) : (
          colSelect('Amount', mapping.amountCol, (v) => onChange({ ...mapping, amountCol: v ?? 0 }))
        )}
        {colSelect('Balance (optional)', mapping.balanceCol, (v) => onChange({ ...mapping, balanceCol: v }), true)}
      </div>
      {!split && (
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" className="size-5" checked={mapping.sign === 'inverted'} onChange={(e) => onChange({ ...mapping, sign: e.target.checked ? 'inverted' : 'normal' })} />
          Purchases show as positive numbers (common for credit cards)
        </label>
      )}
      <div>
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">Preview</p>
        <ul className="divide-y divide-line rounded-2xl bg-surface-2 px-3 text-sm">
          {sample.map((r, i) => (
            <li key={i} className="flex justify-between gap-2 py-1.5">
              <span className="truncate">
                {prettyDate(r.date)} · {r.description}
              </span>
              <span className={`tabular shrink-0 ${r.amountCents > 0 ? 'text-good' : ''}`}>{r.amountCents > 0 ? money(r.amountCents, { sign: true }) : money(r.amountCents)}</span>
            </li>
          ))}
          {!sample.length && <li className="py-2 text-bad">No rows could be read with these columns.</li>}
        </ul>
        <p className="mt-1 text-xs text-muted">Purchases should show as negative (−), money in as positive (+).</p>
      </div>
    </Card>
  );
}

function PreviewCard({ preview, onImport, busy }: { preview: ImportPreview; onImport: () => void; busy: boolean }) {
  const { get } = useCategoryLookup();
  const s = preview.summary;
  return (
    <Card className="space-y-3">
      <SectionTitle>Preview</SectionTitle>
      {preview.alreadyImported && (
        <Status tone="warn" icon="⚠">
          This exact file was imported before
        </Status>
      )}
      <ul className="space-y-1 text-[15px]">
        <li>✓ {s.new} new</li>
        <li className="text-muted">⤼ {s.duplicates} already here (skipped)</li>
        <li>↔ {s.transfersMatched} transfers matched</li>
        <li>👀 {s.needsAttention} need a look</li>
      </ul>
      {preview.balance && <BalanceLine b={preview.balance} />}
      {preview.rows.length > 0 && (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-2xl bg-surface-2 px-3 text-sm">
          {preview.rows.map((r, i) => {
            const c = get(r.categoryId);
            return (
              <li key={i} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.description}</span>
                  <span className="block text-xs text-muted">
                    {prettyDate(r.date)} · {r.kind === 'spend' ? (c ? `${c.emoji} ${c.name}` : 'Uncategorised') : KIND_LABELS[r.kind]}
                    {r.transferMatched && ' · matched'}
                    {r.needsAttention && ' · 👀'}
                  </span>
                </span>
                <span className="tabular shrink-0">{r.amountCents > 0 ? money(r.amountCents, { sign: true }) : money(-r.amountCents)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="primary" className="w-full" disabled={!s.new || busy} onClick={onImport}>
        {busy ? 'Importing…' : s.new ? `Import ${s.new} transaction${s.new === 1 ? '' : 's'}` : 'Nothing new to import'}
      </Button>
    </Card>
  );
}

function BalanceLine({ b }: { b: NonNullable<ImportPreview['balance']> }) {
  if (b.differenceCents == null) return <p className="text-sm text-ink-2">Balance from statement: {money(b.cents)} on {prettyDate(b.asOf)} (first balance for this account)</p>;
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

function ImportDone({ result, onAnother }: { result: ImportPreview; onAnother: () => void }) {
  const s = result.summary;
  return (
    <div className="space-y-4">
      <PageHeader title="Imported!" back="/" />
      <Card className="animate-pop text-center">
        <div className="mb-2 text-5xl">🎉</div>
        <p className="text-lg font-bold">
          {s.new} new · {s.transfersMatched} transfers matched · {s.needsAttention} need a look
        </p>
        {result.balance && (
          <div className="mt-2">
            <BalanceLine b={result.balance} />
          </div>
        )}
        <div className="mt-4 flex flex-col gap-2">
          {s.needsAttention > 0 && (
            <Link to="/review" className="flex min-h-11 items-center justify-center rounded-2xl bg-brand font-semibold text-brand-ink">
              Review {s.needsAttention} now 👀
            </Link>
          )}
          <Button onClick={onAnother}>Import another statement</Button>
          <Link to="/" className="py-2 font-semibold text-brand">
            Back to home
          </Link>
        </div>
      </Card>
    </div>
  );
}
