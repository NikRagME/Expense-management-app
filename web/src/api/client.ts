/** Typed API client. All money values are integer cents. */
import type { AccountType, AttentionReason, CsvMapping, Kind, ParsedRow, Source } from '../../../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method !== 'GET' ? { 'X-Requested-With': 'expense-app' } : {}),
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: 'daughter' | 'parent';
}

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  importMapping: CsvMapping | null;
  archived: boolean;
  lastImportAt: string | null;
  transactionsThrough: string | null;
  transactionCount: number;
  balanceCents: number | null;
  asOf: string | null;
  balanced: boolean | null;
  lastDifferenceCents: number | null;
}

export interface Category {
  id: string;
  groupId: string;
  name: string;
  emoji: string;
  hidden: boolean;
  uses: number;
}

export interface CategoryGroup {
  id: string;
  name: string;
}

export interface Line {
  id: string;
  amountCents: number;
  categoryId: string | null;
  note: string;
}

export interface Tx {
  id: string;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  importId: string | null;
  source: Source;
  date: string;
  amountCents: number;
  rawDescription: string;
  description: string;
  merchantName: string | null;
  note: string;
  kind: Kind;
  counterparty: string | null;
  paymentNote: string | null;
  fundingSource: string | null;
  excluded: boolean;
  needsAttention: AttentionReason | null;
  transferLinked: boolean;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  lines: Line[];
}

export interface TxDetail extends Tx {
  links: { id: string; type: 'transfer' | 'repayment' | 'merge_suggestion'; direction: 'in' | 'out'; other: Tx | null }[];
  history: { action: string; at: string; userName: string | null; details: Record<string, unknown> | null }[];
  repaymentCandidates: Tx[];
}

export interface TxList {
  items: Tx[];
  hasMore: boolean;
  count: number;
  spendingCents: number;
  parentPaidCents: number;
  moneyInCents: number;
}

export interface ReviewItem extends Tx {
  mergeWith?: Tx | null;
  repaymentCandidates?: Tx[];
}

export interface Overview {
  from: string;
  to: string;
  previous: { from: string; to: string; spendingCents: number };
  spendingCents: number;
  parentPaidCents: number;
  costOfLivingCents: number;
  moneyInCents: number;
  transactionCount: number;
  groups: GroupTotal[];
  groupsWithParent: GroupTotal[];
  uncategorizedCents: number;
  accounts: { id: string; name: string; type: AccountType; spendingCents: number; balanceCents: number | null; balanceAsOf: string | null; balanced: boolean | null }[];
  netPositionCents: number | null;
  allBalancesKnown: boolean;
  needsAttentionCount: number;
  freshness: { accountId: string; name: string; lastImportAt: string | null; through: string | null; stale: boolean; daysSinceImport: number | null }[];
}

export interface GroupTotal {
  id: string;
  name: string;
  cents: number;
  categories: { id: string; name: string; emoji: string; cents: number }[];
}

export interface ImportPreview {
  id?: string;
  summary: { total: number; new: number; duplicates: number; transfersMatched: number; needsAttention: number; dateFrom: string | null; dateTo: string | null };
  alreadyImported: boolean;
  balance: { asOf: string; cents: number; computedCents: number | null; differenceCents: number | null } | null;
  rows: { date: string; amountCents: number; description: string; rawDescription: string; kind: Kind; categoryId: string | null; needsAttention: AttentionReason | null; transferMatched: boolean }[];
  duplicates: ParsedRow[];
}

export interface ImportBody {
  accountId: string;
  fileName: string;
  fileHash: string;
  format: 'csv' | 'ofx' | 'venmo';
  rows: ParsedRow[];
  balance: { asOf: string; cents: number } | null;
  mapping: CsvMapping | null;
}

export interface ImportRecord {
  id: string;
  accountId: string;
  accountName: string;
  fileName: string;
  format: string;
  dateFrom: string | null;
  dateTo: string | null;
  rowsTotal: number;
  rowsNew: number;
  rowsDuplicate: number;
  createdByName: string | null;
  createdAt: string;
  undone: boolean;
}

export interface Rule {
  id: string;
  matchType: 'merchant' | 'contains' | 'regex';
  pattern: string;
  accountId: string | null;
  setKind: Kind | null;
  setCategoryId: string | null;
  priority: number;
  createdByName: string | null;
  createdAt: string;
}

export interface RecurringItem {
  id: string;
  name: string;
  amountCents: number;
  categoryId: string | null;
  frequency: 'weekly' | 'monthly' | 'yearly';
  interval: number;
  nextDate: string;
  paused: boolean;
}

export interface SettingsDto {
  parentZelleNames: string[];
  venmoIncomingDefault: 'ask' | 'repayment';
  users: { id: string; email: string; name: string; role: string }[];
}
