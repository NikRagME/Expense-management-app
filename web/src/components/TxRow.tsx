import { Link } from 'react-router';
import type { Tx } from '../api/client';
import { useCategoryLookup } from '../api/hooks';
import { KIND_LABELS, money } from '../lib/format';

const KIND_EMOJI: Record<string, string> = { transfer: '↔️', income: '💵', refund: '↩️', repayment: '🤝' };

/** One transaction in a list. Transfers are greyed and say "not counted". */
export function TxRow({ tx }: { tx: Tx }) {
  const { get } = useCategoryLookup();
  const isSplit = tx.lines.length > 1;
  const cat = get(tx.lines[0]?.categoryId);
  const emoji = tx.kind === 'spend' || tx.kind === 'parent_paid' ? (isSplit ? '✂️' : (cat?.emoji ?? '❔')) : (KIND_EMOJI[tx.kind] ?? cat?.emoji ?? '•');
  const muted = tx.kind === 'transfer' || tx.excluded;

  const subtitle = [
    tx.kind === 'transfer' ? 'Transfer · not counted' : tx.excluded ? 'Excluded' : isSplit ? `Split · ${tx.lines.length} categories` : (cat?.name ?? (tx.kind === 'spend' ? 'Uncategorized' : KIND_LABELS[tx.kind])),
    tx.paymentNote ? `“${tx.paymentNote}”` : null,
    tx.accountName,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Link to={`/tx/${tx.id}`} className={`flex items-center gap-3 rounded-2xl px-2 py-2.5 hover:bg-surface-2 ${muted ? 'opacity-55' : ''}`}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-2 text-lg" aria-hidden>
        {emoji}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{tx.description}</span>
          {tx.needsAttention && (
            <span className="shrink-0 text-xs" title="Needs a look">
              👀
            </span>
          )}
        </span>
        <span className="block truncate text-sm text-muted">{subtitle}</span>
      </span>
      <span className={`tabular shrink-0 text-right font-semibold ${tx.amountCents > 0 && tx.kind !== 'transfer' ? 'text-good' : ''}`}>
        {tx.amountCents > 0 ? money(tx.amountCents, { sign: true }) : money(-tx.amountCents)}
      </span>
    </Link>
  );
}
