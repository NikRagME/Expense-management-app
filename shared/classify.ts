/**
 * Decide what a transaction *means* (its kind) and what it was *for* (its
 * category). When unsure, flag it for review instead of guessing (spec §5).
 */
import { CATEGORY_HINTS } from './categories';
import { cleanMerchant, merchantKey } from './merchant';
import type { AccountType, AttentionReason, Kind, ParsedRow, Rule, Settings } from './types';

export interface Classification {
  kind: Kind;
  categoryId: string | null;
  merchant: string;
  needsAttention: AttentionReason | null;
  /** Which step decided the outcome (handy for debugging and tests). */
  via: 'parser' | 'system' | 'rule' | 'hint' | 'default';
}

const TRANSFER_RE = /\b(transfer|xfer|trnsfr|online banking transfer|to (savings|checking)|from (savings|checking))\b/i;
const CARD_PAYMENT_RE = /\b(payment|pymt|pmt|autopay|thank you)\b/i;
const CARD_PAYMENT_FROM_BANK_RE = /\b(card ?(payment|pmt|pymt)|crcardpmt|loan pmt|credit card|visa pmt|sfcu (visa|card|credit))\b/i;
const VENMO_RE = /\bvenmo\b/i;
const ZELLE_RE = /\bzelle\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Does a bank name refer to one of these people? Banks often cut names short
 * ("JORDAN RIVER" for Jordan Riverton), so a long-enough start of the full
 * name counts, while a different person sharing a first name ("Jordan Tyler")
 * doesn't. A configured first name alone matches loosely (any "Jordan …").
 */
export function nameMatches(bankName: string | undefined, text: string, names: string[]): boolean {
  const candidates = bankName ? [norm(bankName)] : spansAfterKeywords(norm(text));
  return names.some((raw) => {
    const full = norm(raw);
    if (!full) return false;
    const fullName = full.includes(' ');
    return candidates.some((who) => {
      if (!who) return false;
      if (!fullName) return who === full || who.startsWith(`${full} `);
      return who.startsWith(full) || (who.length >= 8 && who.includes(' ') && full.startsWith(who));
    });
  });
}

/** For descriptions without a parsed name ("ZELLE FROM JORDAN R"), the words after from/to. */
function spansAfterKeywords(t: string): string[] {
  const m = /\b(?:from|to|name)\s+(.+)$/.exec(t);
  return m ? [m[1].trim()] : [t];
}

export function ruleMatches(rule: Rule, merchant: string, description: string, accountId: string): boolean {
  if (rule.accountId && rule.accountId !== accountId) return false;
  switch (rule.matchType) {
    case 'merchant':
      return merchantKey(merchant) === merchantKey(rule.pattern);
    case 'contains':
      return description.toLowerCase().includes(rule.pattern.toLowerCase()) || merchant.toLowerCase().includes(rule.pattern.toLowerCase());
    case 'regex':
      try {
        return new RegExp(rule.pattern, 'i').test(description);
      } catch {
        return false;
      }
  }
}

export function classify(
  row: ParsedRow,
  ctx: { accountId: string; accountType: AccountType; rules: Rule[]; settings: Settings },
): Classification {
  const description = row.description;
  const merchant = row.counterparty && ctx.accountType === 'payment_app' ? row.counterparty : cleanMerchant(description);
  const text = `${description} ${row.paymentNote ?? ''}`;
  const out = (kind: Kind, via: Classification['via'], categoryId: string | null = null, needsAttention: AttentionReason | null = null): Classification => ({
    kind,
    categoryId,
    merchant,
    needsAttention,
    via,
  });

  // 0. Virtual "Paid by parent" account.
  if (ctx.accountType === 'parent_paid') return withCategory(out('parent_paid', 'system'), row, ctx);

  // 1. Parser already knows (Venmo funding legs, cash-outs).
  if (row.kindHint === 'transfer') return out('transfer', 'parser');

  // 2. User rules that set a kind win over system detection.
  const rule = [...ctx.rules].sort((a, b) => b.priority - a.priority).find((r) => ruleMatches(r, merchant, text, ctx.accountId));
  if (rule?.setKind) {
    const c = out(rule.setKind, 'rule', rule.setCategoryId);
    return c.kind === 'transfer' || c.kind === 'income' || c.categoryId ? c : withCategory(c, row, ctx);
  }

  const inflow = row.amountCents > 0;

  // 3. System detection.
  const isParent = nameMatches(row.counterparty, description, ctx.settings.parentZelleNames);
  const isSelf = nameMatches(row.counterparty, description, ctx.settings.ownNames ?? []);

  if (ctx.accountType === 'payment_app') {
    if (isSelf) return out('transfer', 'system');
    if (inflow) {
      if (isParent) return out('income', 'system', 'allowance');
      if (ctx.settings.venmoIncomingDefault === 'repayment') return withCategory(out('repayment', 'system'), row, ctx, rule);
      return out('repayment', 'system', null, 'venmo_incoming');
    }
    return withCategory(out('spend', 'system'), row, ctx, rule);
  }

  if (ctx.accountType === 'credit_card') {
    if (inflow && CARD_PAYMENT_RE.test(description) && !/refund|return|credit adj/i.test(description)) return out('transfer', 'system');
    if (inflow) return withCategory(out('refund', 'system'), row, ctx, rule);
    return withCategory(out('spend', 'system'), row, ctx, rule);
  }

  // Bank-like accounts (checking, savings, cash, other).
  if (ZELLE_RE.test(description)) {
    if (isSelf) return out('transfer', 'system'); // e.g. Citi → her own SFCU account
    if (inflow && isParent) return out('income', 'system', 'allowance');
    // A friend paying her: ask, like Venmo (spec A5).
    if (inflow) {
      if (ctx.settings.venmoIncomingDefault === 'repayment') return withCategory(out('repayment', 'system'), row, ctx, rule);
      return out('repayment', 'system', null, 'venmo_incoming');
    }
  }
  if (VENMO_RE.test(description)) return out('transfer', 'system');
  if (TRANSFER_RE.test(description)) return out('transfer', 'system');
  if (!inflow && CARD_PAYMENT_FROM_BANK_RE.test(description)) return out('transfer', 'system');
  if (inflow) {
    if (/refund|return|reversal/i.test(description)) return withCategory(out('refund', 'system'), row, ctx, rule);
    if (/interest|dividend/i.test(description)) return out('income', 'system');
    // Could be income, a refund, or the other side of a transfer: ask.
    return out('income', 'default', null, 'unknown_inflow');
  }
  return withCategory(out('spend', 'default'), row, ctx, rule);
}

/** Fill in the category from a rule, then built-in hints; otherwise flag as uncategorised. */
function withCategory(
  c: Classification,
  row: ParsedRow,
  ctx: { accountId: string; rules: Rule[] },
  rule?: Rule,
): Classification {
  const r = rule ?? [...ctx.rules].sort((a, b) => b.priority - a.priority).find((x) => ruleMatches(x, c.merchant, row.description, ctx.accountId));
  if (r?.setCategoryId) return { ...c, categoryId: r.setCategoryId, via: 'rule' };
  const text = `${row.description} ${c.merchant} ${row.paymentNote ?? ''}`;
  const hint = CATEGORY_HINTS.find(([re]) => re.test(text))?.[1] ?? row.categoryHint;
  if (hint) {
    const via = c.via === 'system' || c.via === 'default' ? 'hint' : c.via;
    // Tuition is paid with money from her parent (decided with the family): cost of living, not her spending.
    if (hint === 'tuition' && c.kind === 'spend') return { ...c, kind: 'parent_paid', categoryId: hint, via };
    return { ...c, categoryId: hint, via };
  }
  return { ...c, categoryId: null, needsAttention: c.needsAttention ?? 'uncategorized' };
}
