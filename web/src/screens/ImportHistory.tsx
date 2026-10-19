import { Link } from 'react-router';
import { api } from '../api/client';
import { useApiMutation, useHistoryImports, useImports } from '../api/hooks';
import { Button, Card, Empty, ErrorText, Loading, PageHeader } from '../components/ui';
import { prettyDate, timeAgo } from '../lib/format';

export function ImportHistory() {
  const q = useImports();
  const undo = useApiMutation((id: string) => api<{ removed: number }>(`/imports/${id}/undo`, { method: 'POST', body: {} }));
  const sheets = useHistoryImports();
  const undoSheet = useApiMutation((id: string) => api<{ restored: number; removed: number }>(`/history/${id}/undo`, { method: 'POST', body: {} }));
  if (q.isLoading) return <Loading />;
  const imports = q.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Import history" back="/more" action={<Link to="/import" className="text-sm font-semibold text-brand">+ Import</Link>} />
      <ErrorText error={q.error ?? undo.error ?? undoSheet.error} />
      {undoSheet.data && (
        <p className="rounded-2xl bg-good-soft px-3 py-2 text-sm text-good">
          Spreadsheet undone. {undoSheet.data.restored} bank lines restored, {undoSheet.data.removed} added rows removed.
        </p>
      )}
      {(sheets.data?.length ?? 0) > 0 && (
        <Card className="p-1">
          <p className="px-3 pt-2 text-xs font-bold uppercase tracking-wider text-muted">Spreadsheets</p>
          <ul className="divide-y divide-line">
            {sheets.data!.map((h) => (
              <li key={h.id} className={`flex items-center gap-3 px-3 py-3 ${h.undone ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">📒 {h.fileName}</p>
                  <p className="text-sm text-muted">
                    {h.rowsMatched} matched, {h.rowsAdded} added, {h.rowsUnmatched} to decide · {timeAgo(h.createdAt)}
                    {h.createdByName && ` by ${h.createdByName}`}
                    {h.undone && ' · undone'}
                  </p>
                </div>
                {!h.undone && (
                  <Button
                    variant="danger"
                    className="min-h-9 px-3"
                    disabled={undoSheet.isPending}
                    onClick={() => confirm('Undo this spreadsheet? Bank lines go back to how they were, and rows it added are removed.') && undoSheet.mutate(h.id)}
                  >
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {undo.data && <p className="rounded-2xl bg-good-soft px-3 py-2 text-sm text-good">Undone. Removed {undo.data.removed} transactions.</p>}
      {!imports.length ? (
        <Card>
          <Empty emoji="🗂️" title="No imports yet" />
        </Card>
      ) : (
        <Card className="p-1">
          <ul className="divide-y divide-line">
            {imports.map((i) => (
              <li key={i.id} className={`flex items-center gap-3 px-3 py-3 ${i.undone ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {i.accountName} <span className="font-normal text-muted">· {i.fileName}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {i.dateFrom && i.dateTo ? `${prettyDate(i.dateFrom)} – ${prettyDate(i.dateTo)} · ` : ''}
                    {i.rowsNew} new, {i.rowsDuplicate} duplicates · {timeAgo(i.createdAt)}
                    {i.createdByName && ` by ${i.createdByName}`}
                    {i.undone && ' · undone'}
                  </p>
                </div>
                {!i.undone && (
                  <Button
                    variant="danger"
                    className="min-h-9 px-3"
                    disabled={undo.isPending}
                    onClick={() => confirm(`Undo this import? It removes the ${i.rowsNew} transactions it added.`) && undo.mutate(i.id)}
                  >
                    Undo
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
