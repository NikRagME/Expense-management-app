import { api } from '../api/client';
import { useAccounts, useApiMutation, useCategoryLookup, useRules } from '../api/hooks';
import { Button, Card, Empty, ErrorText, Loading, PageHeader } from '../components/ui';
import { KIND_LABELS } from '../lib/format';

const MATCH: Record<string, string> = { merchant: 'Merchant is', contains: 'Description contains', regex: 'Matches pattern' };

/** Rules are created from "Always put X in Y?" prompts; here they can be reviewed or deleted. */
export function Rules() {
  const q = useRules();
  const accounts = useAccounts();
  const { get } = useCategoryLookup();
  const remove = useApiMutation((id: string) => api(`/rules/${id}`, { method: 'DELETE' }));
  if (q.isLoading) return <Loading />;
  const rules = q.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Rules" back="/more" />
      <p className="text-sm text-ink-2">Rules are made when you choose "Always" for a merchant. They categorise new imports automatically.</p>
      <ErrorText error={q.error ?? remove.error} />
      {!rules.length ? (
        <Card>
          <Empty emoji="🪄" title="No rules yet">
            They'll appear as you categorise things.
          </Empty>
        </Card>
      ) : (
        <Card className="p-1">
          <ul className="divide-y divide-line">
            {rules.map((r) => {
              const c = get(r.setCategoryId);
              const account = accounts.data?.find((a) => a.id === r.accountId);
              return (
                <li key={r.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      <span className="text-muted">{MATCH[r.matchType]}</span> <b>{r.pattern}</b>
                      {account && <span className="text-muted"> on {account.name}</span>}
                    </p>
                    <p className="text-sm">
                      → {[r.setKind && KIND_LABELS[r.setKind], c && `${c.emoji} ${c.name}`].filter(Boolean).join(' · ')}
                      {r.createdByName && <span className="text-xs text-muted"> · by {r.createdByName}</span>}
                    </p>
                  </div>
                  <Button variant="danger" className="min-h-9 px-3" onClick={() => confirm(`Delete the rule for "${r.pattern}"?`) && remove.mutate(r.id)}>
                    Delete
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
