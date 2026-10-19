import { useState } from 'react';
import { parseAmount } from '../../../shared/money';
import { remainingCents, validateSplit } from '../../../shared/splits';
import { api, type Tx } from '../api/client';
import { useApiMutation, useCategoryLookup } from '../api/hooks';
import { money } from '../lib/format';
import { Button, ErrorText, Input, Select } from './ui';

interface Part {
  amount: string; // dollars as typed, always positive
  categoryId: string;
}

/** Split a transaction across categories (spec §5.3). The last part auto-fills with what's left. */
export function SplitEditor({ tx, onDone }: { tx: Tx; onDone: () => void }) {
  const { categories } = useCategoryLookup();
  const sign = Math.sign(tx.amountCents);
  const total = Math.abs(tx.amountCents);
  const [parts, setParts] = useState<Part[]>(() =>
    tx.lines.length > 1
      ? tx.lines.map((l) => ({ amount: (Math.abs(l.amountCents) / 100).toFixed(2), categoryId: l.categoryId ?? '' }))
      : [
          { amount: '', categoryId: tx.lines[0]?.categoryId ?? '' },
          { amount: '', categoryId: '' },
        ],
  );

  // All but the last are typed; the last gets the remainder.
  const typed = parts.slice(0, -1).map((p) => ({ amountCents: parseAmount(p.amount) ?? 0, categoryId: p.categoryId || null }));
  const lastCents = remainingCents(total, typed);
  const all = [...typed, { amountCents: lastCents, categoryId: parts[parts.length - 1].categoryId || null }];
  const signed = all.map((p) => ({ ...p, amountCents: p.amountCents * sign }));
  const error = lastCents <= 0 ? 'The parts add up to more than the total' : validateSplit(tx.amountCents, signed);

  const save = useApiMutation(() => api(`/transactions/${tx.id}/splits`, { method: 'PUT', body: { parts: signed } }), { onSuccess: onDone });

  const update = (i: number, patch: Partial<Part>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        Total {money(total)}. {lastCents > 0 ? `${money(lastCents)} left for the last part.` : ''}
      </p>
      {parts.map((p, i) => {
        const isLast = i === parts.length - 1;
        return (
          <div key={i} className="flex gap-2">
            <Input
              inputMode="decimal"
              placeholder="0.00"
              className="w-28 shrink-0"
              aria-label={`Part ${i + 1} amount`}
              value={isLast ? (lastCents / 100).toFixed(2) : p.amount}
              readOnly={isLast}
              onChange={(e) => update(i, { amount: e.target.value })}
            />
            <Select value={p.categoryId} onChange={(e) => update(i, { categoryId: e.target.value })} aria-label={`Part ${i + 1} category`}>
              <option value="">Choose category…</option>
              {categories
                .filter((c) => !c.hidden)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
            </Select>
            {parts.length > 2 && (
              <button className="px-2 text-xl text-muted" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))} aria-label={`Remove part ${i + 1}`}>
                ×
              </button>
            )}
          </div>
        );
      })}
      <Button variant="ghost" onClick={() => setParts((ps) => [...ps.slice(0, -1), { amount: '', categoryId: '' }, ps[ps.length - 1]])}>
        + Add a part
      </Button>
      {error && typed.some((t) => t.amountCents) && <p className="text-sm text-warn">{error}</p>}
      <ErrorText error={save.error} />
      <Button variant="primary" className="w-full" disabled={!!error || save.isPending} onClick={() => save.mutate(undefined)}>
        Save split
      </Button>
    </div>
  );
}
