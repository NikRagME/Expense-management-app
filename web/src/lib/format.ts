import { formatCents } from '../../../shared/money';
import type { AccountType, Kind } from '../../../shared/types';

export { formatCents };

/** Spending is shown as a positive number ("you spent $842"). */
export const money = (cents: number, opts?: { whole?: boolean; sign?: boolean }) => formatCents(cents, opts);

export function prettyDate(iso: string, opts: { year?: boolean } = {}): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: opts.year ? 'numeric' : undefined });
}

export function dayHeading(iso: string, today: string): string {
  if (iso === today) return 'Today';
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
  if (iso === yesterday) return 'Yesterday';
  const [yy, mm, dd] = iso.split('-').map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: yy !== y ? 'numeric' : undefined });
}

/** "2 days ago" from an ISO-ish UTC timestamp ("2026-10-12 18:00:00"). */
export function timeAgo(ts: string | null | undefined, now = Date.now()): string {
  if (!ts) return 'never';
  const t = Date.parse(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`);
  const mins = Math.round((now - t) / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return `${Math.round(days / 30)} mo ago`;
}

export const KIND_LABELS: Record<Kind, string> = {
  spend: 'Spend',
  refund: 'Refund',
  repayment: 'Paid back',
  income: 'Income',
  transfer: 'Transfer',
  parent_paid: 'Paid by parent',
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  payment_app: 'Payment app',
  cash: 'Cash',
  other: 'Other',
  parent_paid: 'Paid by parent',
};

export const ACCOUNT_EMOJI: Record<AccountType, string> = {
  checking: '🏦',
  savings: '🐷',
  credit_card: '💳',
  payment_app: '📲',
  cash: '💵',
  other: '👛',
  parent_paid: '🤝',
};

/** Balance text: credit cards show what's owed, never "negative money". */
export function balanceText(type: AccountType, cents: number | null): string {
  if (cents == null) return 'Balance unknown';
  if (type === 'credit_card') return cents <= 0 ? `${money(-cents)} owed` : `${money(cents)} credit`;
  return money(cents);
}

export const ATTENTION_LABELS: Record<string, string> = {
  uncategorized: 'Needs a category',
  venmo_incoming: 'Money in — what is it?',
  unknown_inflow: 'Money in — what is it?',
  possible_merge: 'Possible duplicate',
  transfer_ambiguous: 'Which transfer is this?',
  transfer_unmatched: "Transfer's other side is missing",
};
