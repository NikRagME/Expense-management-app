/**
 * Reporting definitions — the single source of truth used by every screen
 * (architecture §7.2). Inputs are category lines; spending is shown positive.
 */
import type { AccountType, Kind } from './types';

export interface ReportLine {
  transactionId: string;
  date: string;
  kind: Kind;
  accountId: string;
  accountType: AccountType;
  categoryId: string | null;
  amountCents: number; // signed line amount (money out negative)
  excluded: boolean;
}

export interface Totals {
  spendingCents: number;
  parentPaidCents: number;
  costOfLivingCents: number;
  moneyInCents: number;
  byCategory: Map<string | null, number>;
  byAccount: Map<string, number>;
  transactionCount: number;
}

export function isHerSpending(l: ReportLine): boolean {
  return !l.excluded && l.accountType !== 'parent_paid' && (l.kind === 'spend' || l.kind === 'refund' || l.kind === 'repayment');
}

export function isParentPaid(l: ReportLine): boolean {
  return !l.excluded && l.kind === 'parent_paid';
}

export function computeTotals(lines: ReportLine[], opts: { includeParentPaidInCategories?: boolean } = {}): Totals {
  const byCategory = new Map<string | null, number>();
  const byAccount = new Map<string, number>();
  const txIds = new Set<string>();
  let spending = 0;
  let parent = 0;
  let moneyIn = 0;

  for (const l of lines) {
    if (l.excluded || l.kind === 'transfer') continue;
    if (isHerSpending(l)) {
      spending += -l.amountCents;
      byCategory.set(l.categoryId, (byCategory.get(l.categoryId) ?? 0) - l.amountCents);
      byAccount.set(l.accountId, (byAccount.get(l.accountId) ?? 0) - l.amountCents);
      txIds.add(l.transactionId);
    } else if (isParentPaid(l)) {
      parent += -l.amountCents;
      if (opts.includeParentPaidInCategories) byCategory.set(l.categoryId, (byCategory.get(l.categoryId) ?? 0) - l.amountCents);
      txIds.add(l.transactionId);
    } else if (l.kind === 'income') {
      moneyIn += l.amountCents;
    }
  }

  return {
    spendingCents: spending,
    parentPaidCents: parent,
    costOfLivingCents: spending + parent,
    moneyInCents: moneyIn,
    byCategory,
    byAccount,
    transactionCount: txIds.size,
  };
}
