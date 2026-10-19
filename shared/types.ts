export const ACCOUNT_TYPES = ['checking', 'savings', 'credit_card', 'payment_app', 'cash', 'other', 'parent_paid'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const KINDS = ['spend', 'refund', 'repayment', 'income', 'transfer', 'parent_paid'] as const;
export type Kind = (typeof KINDS)[number];

/** Kinds that count toward "her spending". */
export const SPENDING_KINDS: readonly Kind[] = ['spend', 'refund', 'repayment'];

export const ATTENTION_REASONS = [
  'uncategorized',
  'venmo_incoming',
  'unknown_inflow',
  'possible_merge',
  'transfer_ambiguous',
  'transfer_unmatched',
] as const;
export type AttentionReason = (typeof ATTENTION_REASONS)[number];

export type Source = 'import' | 'manual' | 'recurring' | 'email' | 'sms' | 'receipt' | 'bank_sync';

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  importMapping: CsvMapping | null;
  archivedAt: string | null;
}

/** A row extracted from a statement file, before classification. */
export interface ParsedRow {
  date: string;
  amountCents: number;
  description: string;
  externalId?: string;
  /** Venmo detail */
  counterparty?: string;
  paymentNote?: string;
  fundingSource?: string;
  /** Hint from the parser, e.g. Venmo transfers and funding legs. */
  kindHint?: Kind;
  /** Category suggested by the statement itself (e.g. Citi's "Restaurant/Bar" line). */
  categoryHint?: string;
}

export interface ParsedStatement {
  format: 'csv' | 'ofx' | 'venmo' | 'pdf';
  rows: ParsedRow[];
  /** Balance at the end of the day before the statement period (e.g. $0 for a new account). */
  openingBalance?: { asOf: string; cents: number };
  /** End-of-day balance reported by the statement, if any. */
  balance?: { asOf: string; cents: number };
  /** For statements covering several accounts (Citi checking + savings in one PDF). */
  section?: { kind: 'checking' | 'savings'; label: string; last4: string | null };
  errors: string[];
}

export interface CsvMapping {
  /** Number of junk lines before the header row. */
  skipRows: number;
  hasHeader: boolean;
  dateCol: number;
  descriptionCol: number;
  /** Either a single signed amount column... */
  amountCol?: number;
  /** ...or separate debit/credit columns. */
  debitCol?: number;
  creditCol?: number;
  /** "inverted" when the bank shows purchases as positive numbers (common for credit cards). */
  sign: 'normal' | 'inverted';
  balanceCol?: number;
  dateFormat: 'auto' | 'MDY' | 'YMD' | 'DMY';
}

export interface Rule {
  id: string;
  matchType: 'merchant' | 'contains' | 'regex';
  pattern: string;
  accountId: string | null;
  setKind: Kind | null;
  setCategoryId: string | null;
  priority: number;
}

export interface Settings {
  /** Parent's full name as banks show it (e.g. "Nikhil Raghavan"). Bank names are often cut short. */
  parentZelleNames: string[];
  /** Her own name as banks show it, so Zelle to/from herself counts as a transfer. */
  ownNames: string[];
  venmoIncomingDefault: 'ask' | 'repayment';
}
