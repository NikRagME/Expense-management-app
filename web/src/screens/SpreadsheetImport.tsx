/** Bring in her tracking spreadsheet (spec §12.3 step 3, screen S12). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { findTables, ROLES, suggestAccount, suggestCategory, tableRows, type HistoryRow, type Role, type SheetTable } from '../../../shared/history';
import { parseCsvText } from '../../../shared/parsers/csv';
import { readXlsx, type Sheet } from '../../../shared/parsers/xlsx';
import { api, type HistoryPreview, type HistoryRowIn } from '../api/client';
import { useAccounts, useApiMutation, useCategoryLookup, useHistoryMappings } from '../api/hooks';
import { Button, Card, ErrorText, Field, PageHeader, SectionTitle, Select, Status } from '../components/ui';
import { money, prettyDate } from '../lib/format';

const ROLE_LABELS: Record<Role, string> = {
  date: 'Date',
  amount: 'Amount',
  debit: 'Money out',
  credit: 'Money in',
  direction: 'In / out',
  description: 'Description',
  category: 'Category',
  account: 'Account',
  note: 'Note',
};

const ANY = '__any__';

async function sha256(bytes: Uint8Array) {
  const buf = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface TableState {
  include: boolean;
  roles: Partial<Record<Role, number>>;
  expensesPositive: boolean;
  /** When there is no account column: one account for the whole tab, or any. */
  account: string;
}

export function SpreadsheetImport() {
  const accounts = useAccounts();
  const usable = (accounts.data ?? []).filter((a) => !a.archived && a.type !== 'parent_paid');
  const { categories, groups, get } = useCategoryLookup();
  const saved = useHistoryMappings();
  const [file, setFile] = useState<{ name: string; hash: string; tables: SheetTable[] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [tables, setTables] = useState<Record<string, TableState>>({});
  const [accountMap, setAccountMap] = useState<Record<string, string>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [done, setDone] = useState<HistoryPreview | null>(null);

  async function onFile(f: File | undefined) {
    setFile(null);
    setPreview(null);
    setFileError(null);
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let sheets: Sheet[];
    try {
      sheets = /\.csv$/i.test(f.name) ? [{ name: f.name.replace(/\.csv$/i, ''), rows: parseCsvText(new TextDecoder().decode(bytes)) }] : await readXlsx(bytes);
    } catch (e) {
      setFileError(/\.xls$/i.test(f.name) ? 'This is an older .xls file. Open it in Excel and save as .xlsx, or export a CSV.' : (e as Error).message);
      return;
    }
    const found = sheets.flatMap(findTables);
    if (!found.length) {
      setFileError("Couldn't find a table with Date and Amount columns in this file.");
      return;
    }
    setTables(Object.fromEntries(found.map((t) => [t.key, { include: true, roles: t.roles, expensesPositive: t.expensesPositive, account: '' }])));
    setFile({ name: f.name, hash: await sha256(bytes), tables: found });
    setAccountMap({});
    setCategoryMap({});
  }

  // Rows from every included table, using the current column choices.
  const rows: HistoryRow[] = useMemo(
    () => (file ? file.tables.filter((t) => tables[t.key]?.include).flatMap((t) => tableRows(t, tables[t.key]).rows) : []),
    [file, tables],
  );
  const accountLabels = [...new Set(rows.map((r) => r.accountLabel).filter(Boolean))];
  const categoryLabels = [...new Set(rows.map((r) => r.categoryLabel).filter(Boolean))].sort();
  const accountFor = (label: string) => accountMap[label] ?? saved.data?.accounts[label] ?? suggestAccount(label, usable) ?? '';
  const targetFor = (label: string) =>
    categoryMap[label] ?? saved.data?.categories[label] ?? suggestCategory(label, categories, groups.map((g) => g.name));

  const tableOf = (r: HistoryRow) => file!.tables.find((t) => t.sheet === r.sheet && t.rows.some((x) => x.rowNumber === r.rowNumber))!;
  const payload = () => {
    const body: HistoryRowIn[] = rows.map((r) => {
      const t = tables[tableOf(r).key];
      let accountIds: string[] = [];
      if (t.roles.account !== undefined) accountIds = accountFor(r.accountLabel) ? [accountFor(r.accountLabel)] : [];
      else if (t.account === ANY) accountIds = usable.map((a) => a.id);
      else if (t.account) accountIds = [t.account];
      return { ...r, accountIds };
    });
    return {
      fileName: file!.name,
      fileHash: file!.hash,
      rows: body,
      categoryMap: Object.fromEntries(categoryLabels.map((l) => [l, targetFor(l)])),
      accountAliases: Object.fromEntries(accountLabels.filter((l) => accountFor(l)).map((l) => [l, accountFor(l)])),
    };
  };

  const doPreview = useApiMutation(() => api<HistoryPreview>('/history/preview', { method: 'POST', body: payload() }), { onSuccess: setPreview });
  const apply = useApiMutation(() => api<HistoryPreview>('/history', { method: 'POST', body: payload() }), { onSuccess: setDone });

  if (done) return <Done result={done} />;

  const targetOptions = (
    <>
      <option value="auto">Let Pocket decide</option>
      <option value="parent_pays">🤝 Paid by parent (out of budget)</option>
      <option value="skip">Skip these rows</option>
      {groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {categories
            .filter((c) => c.groupId === g.id && !c.hidden)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Her spreadsheet" back="/setup" />
      <Card className="space-y-3">
        <p className="text-sm text-ink-2">
          From Google Sheets: <b>File → Download → Microsoft Excel (.xlsx)</b>. From Excel, use the .xlsx file as it is. Bank statements should be imported first, so her rows can
          be matched to them.
        </p>
        <input
          type="file"
          accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
          aria-label="Spreadsheet file"
          className="block w-full text-sm file:mr-3 file:min-h-11 file:rounded-2xl file:border-0 file:bg-brand file:px-4 file:font-semibold file:text-brand-ink"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {fileError && <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{fileError}</p>}
      </Card>

      {file?.tables.map((t) => {
        const st = tables[t.key];
        const sample = tableRows(t, st).rows.slice(0, 3);
        return (
          <Card key={t.key} className="space-y-3">
            <label className="flex items-center gap-3">
              <input type="checkbox" className="size-5" checked={st.include} onChange={(e) => setTables((x) => ({ ...x, [t.key]: { ...st, include: e.target.checked } }))} />
              <span className="font-bold">
                {t.sheet} <span className="font-normal text-muted">· {t.rows.length} rows from row {t.headerRow + 2}</span>
              </span>
            </label>
            {st.include && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {t.headers.map((h) => {
                    const role = (Object.entries(st.roles).find(([, col]) => col === h.col)?.[0] ?? '') as Role | '';
                    return (
                      <Field key={h.col} label={`"${h.label}"`}>
                        <Select
                          value={role}
                          onChange={(e) => {
                            const roles = Object.fromEntries(Object.entries(st.roles).filter(([r, col]) => col !== h.col && r !== e.target.value));
                            if (e.target.value) roles[e.target.value] = h.col;
                            setTables((x) => ({ ...x, [t.key]: { ...st, roles } }));
                            setPreview(null);
                          }}
                        >
                          <option value="">Ignore</option>
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    );
                  })}
                </div>
                {st.roles.amount !== undefined && st.roles.direction === undefined && (
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={st.expensesPositive}
                      onChange={(e) => setTables((x) => ({ ...x, [t.key]: { ...st, expensesPositive: e.target.checked } }))}
                    />
                    Spending is written as positive amounts
                  </label>
                )}
                {st.roles.account === undefined && (
                  <Field label="Which account is this tab for?">
                    <Select value={st.account} onChange={(e) => setTables((x) => ({ ...x, [t.key]: { ...st, account: e.target.value } }))}>
                      <option value="">Choose…</option>
                      <option value={ANY}>Any account (match by amount and date)</option>
                      {usable.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <ul className="divide-y divide-line rounded-2xl bg-surface-2 px-3 text-sm">
                  {sample.map((r) => (
                    <li key={r.rowNumber} className="flex justify-between gap-2 py-1.5">
                      <span className="truncate">
                        {prettyDate(r.date)} · {r.description} {r.categoryLabel && <span className="text-muted">· {r.categoryLabel}</span>}
                      </span>
                      <span className={`tabular shrink-0 ${r.amountCents > 0 ? 'text-good' : ''}`}>{r.amountCents > 0 ? money(r.amountCents, { sign: true }) : money(r.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        );
      })}

      {file && accountLabels.length > 0 && (
        <Card className="space-y-2">
          <SectionTitle>Her account names</SectionTitle>
          {accountLabels.map((l) => (
            <div key={l} className="grid grid-cols-2 items-center gap-2">
              <span className="font-medium">“{l}”</span>
              <Select aria-label={`Account for ${l}`} value={accountFor(l)} onChange={(e) => setAccountMap((m) => ({ ...m, [l]: e.target.value }))}>
                <option value="">Not sure</option>
                {usable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          {accountLabels.some((l) => !accountFor(l)) && (
            <p className="text-xs text-warn">Rows with an unknown account wait in Review. Add the account first (e.g. Citi Savings) if it's missing.</p>
          )}
        </Card>
      )}

      {file && categoryLabels.length > 0 && (
        <Card className="space-y-2">
          <SectionTitle>Her categories</SectionTitle>
          {categoryLabels.map((l) => (
            <div key={l} className="grid grid-cols-2 items-center gap-2">
              <span className="font-medium">
                “{l}” <span className="text-xs text-muted">{rows.filter((r) => r.categoryLabel === l).length} rows</span>
              </span>
              <Select
                aria-label={`Category for ${l}`}
                value={targetFor(l)}
                onChange={(e) => {
                  setCategoryMap((m) => ({ ...m, [l]: e.target.value }));
                  setPreview(null);
                }}
              >
                {targetOptions}
              </Select>
            </div>
          ))}
        </Card>
      )}

      <ErrorText error={doPreview.error ?? apply.error} />
      {file && !preview && (
        <Button variant="primary" className="w-full" disabled={!rows.length || doPreview.isPending} onClick={() => doPreview.mutate(undefined)}>
          {doPreview.isPending ? 'Matching…' : `Preview ${rows.length} rows`}
        </Button>
      )}
      {preview && (
        <PreviewCard preview={preview} categoryName={(id) => get(id)?.name}>
          <Button variant="primary" className="w-full" disabled={apply.isPending} onClick={() => apply.mutate(undefined)}>
            {apply.isPending ? 'Applying…' : 'Apply to Pocket'}
          </Button>
        </PreviewCard>
      )}
    </div>
  );
}

function PreviewCard({ preview, categoryName, children }: { preview: HistoryPreview; categoryName: (id: string) => string | undefined; children?: React.ReactNode }) {
  const s = preview.summary;
  const [show, setShow] = useState<'unmatched' | 'added' | 'matched' | null>('unmatched');
  const list = preview.rows.filter((r) => r.status === show);
  const target = (t: string) => (t === 'auto' ? '' : t === 'parent_pays' ? 'Paid by parent' : t === 'skip' ? 'Skipped' : (categoryName(t) ?? t));
  const reason: Record<string, string> = {
    not_on_statement: 'not on the statement',
    ambiguous: 'several bank lines fit',
    no_account: "account isn't known",
    duplicate_row: 'same as a row on another tab',
  };
  return (
    <Card className="space-y-3">
      <SectionTitle>Preview</SectionTitle>
      <ul className="space-y-1 text-[15px]">
        <li>✓ {s.matched} matched to a bank line{s.amountDiffers ? ` (${s.amountDiffers} with a slightly different amount; the bank's is kept)` : ''}</li>
        <li>＋ {s.added} added (no statement covers them)</li>
        <li>👀 {s.unmatched} to decide in Review</li>
        {s.keptPocketChoices > 0 && <li className="text-muted">🔒 {s.keptPocketChoices} already set in Pocket, left as they are</li>}
        {s.skipped > 0 && <li className="text-muted">⤼ {s.skipped} skipped</li>}
      </ul>
      <div className="flex gap-2 text-sm">
        {(['unmatched', 'added', 'matched'] as const).map((k) => (
          <button key={k} className={`rounded-full px-3 py-1 font-semibold ${show === k ? 'bg-brand text-brand-ink' : 'bg-surface-2'}`} onClick={() => setShow(show === k ? null : k)}>
            {k === 'unmatched' ? 'To decide' : k === 'added' ? 'Added' : 'Matched'}
          </button>
        ))}
      </div>
      {show && (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-2xl bg-surface-2 px-3 text-sm">
          {list.map((r) => (
            <li key={`${r.sheet}-${r.rowNumber}`} className="py-1.5">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">
                  {prettyDate(r.date)} · {r.description}
                </span>
                <span className="tabular shrink-0">{r.amountCents > 0 ? money(r.amountCents, { sign: true }) : money(-r.amountCents)}</span>
              </div>
              <p className="text-xs text-muted">
                {r.sheet} row {r.rowNumber}
                {target(r.target) && ` · ${target(r.target)}`}
                {r.bank && ` · bank: ${r.bank.description} ${money(Math.abs(r.bank.amountCents))} on ${prettyDate(r.bank.date)}`}
                {r.reason && ` · ${reason[r.reason] ?? r.reason}`}
                {r.keptPocketChoice && ' · kept Pocket’s category'}
              </p>
            </li>
          ))}
          {!list.length && <li className="py-2 text-muted">None</li>}
        </ul>
      )}
      {children}
    </Card>
  );
}

function Done({ result }: { result: HistoryPreview }) {
  const { get } = useCategoryLookup();
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [suggestions, setSuggestions] = useState<{ merchant: string; categoryId: string; count: number }[] | null>(null);
  const load = useApiMutation(() => api<{ merchant: string; categoryId: string; count: number }[]>(`/history/${result.id}/rule-suggestions`), {
    onSuccess: (s) => {
      setSuggestions(s);
      setPicked(new Set(s.map((x) => x.merchant)));
    },
  });
  const create = useApiMutation(() => api(`/history/${result.id}/rules`, { method: 'POST', body: { rules: (suggestions ?? []).filter((s) => picked?.has(s.merchant)) } }));
  const s = result.summary;
  return (
    <div className="space-y-4">
      <PageHeader title="Spreadsheet applied" back="/setup" />
      <Card className="animate-pop space-y-3 text-center">
        <div className="text-5xl">🎉</div>
        <p className="text-lg font-bold">
          {s.matched} matched · {s.added} added · {s.unmatched} to decide
        </p>
        <div className="flex flex-col gap-2">
          {s.unmatched > 0 && (
            <Link to="/review" className="flex min-h-11 items-center justify-center rounded-2xl bg-brand font-semibold text-brand-ink">
              Decide {s.unmatched} rows in Review 👀
            </Link>
          )}
          <Link to="/setup" className="py-2 font-semibold text-brand">
            Back to setup
          </Link>
        </div>
      </Card>
      <Card className="space-y-3">
        <SectionTitle>Learn from her spreadsheet</SectionTitle>
        {!suggestions ? (
          <Button onClick={() => load.mutate(undefined)} disabled={load.isPending}>
            Find shops she always categorised the same way
          </Button>
        ) : !suggestions.length ? (
          <p className="text-sm text-muted">No new rules to suggest.</p>
        ) : create.isSuccess ? (
          <Status tone="good" icon="✓">
            Rules created. Future imports will sort these automatically
          </Status>
        ) : (
          <>
            <ul className="space-y-1">
              {suggestions.map((x) => (
                <li key={x.merchant}>
                  <label className="flex items-center gap-3 text-sm">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={picked?.has(x.merchant) ?? false}
                      onChange={(e) => setPicked((p) => new Set([...(p ?? [])].filter((m) => m !== x.merchant).concat(e.target.checked ? [x.merchant] : [])))}
                    />
                    <span>
                      Always put <b>{x.merchant}</b> in <b>{get(x.categoryId)?.name}</b> <span className="text-muted">({x.count}×)</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <Button variant="primary" disabled={!picked?.size || create.isPending} onClick={() => create.mutate(undefined)}>
              Create {picked?.size ?? 0} rules
            </Button>
          </>
        )}
        <ErrorText error={load.error ?? create.error} />
      </Card>
    </div>
  );
}
