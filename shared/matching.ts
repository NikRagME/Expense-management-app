/** Duplicate detection, transfer pairing and manual↔import merge suggestions (spec §4, §5). */
import { daysBetween } from './dates';
import type { AttentionReason, Kind, ParsedRow, Source } from './types';

export function dedupeKey(row: Pick<ParsedRow, 'date' | 'amountCents' | 'description'>): string {
  return `${row.date}|${row.amountCents}|${row.description.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

export interface ExistingKeys {
  externalIds: Set<string>;
  /** How many transactions already exist with each dedupe key (same account). */
  keyCounts: Map<string, number>;
}

/**
 * Split parsed rows into new rows and duplicates. Identical lines in one file
 * (two $5 coffees on the same day) are legitimate, so we compare counts: if the
 * file has 2 of a key and the database has 1, one is new.
 */
export function splitDuplicates<T extends ParsedRow>(rows: T[], existing: ExistingKeys): { fresh: T[]; duplicates: T[] } {
  const fresh: T[] = [];
  const duplicates: T[] = [];
  const seen = new Map<string, number>();
  const seenIds = new Set<string>();
  for (const row of rows) {
    if (row.externalId) {
      if (existing.externalIds.has(row.externalId) || seenIds.has(row.externalId)) duplicates.push(row);
      else {
        seenIds.add(row.externalId);
        fresh.push(row);
      }
      continue;
    }
    const key = dedupeKey(row);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n <= (existing.keyCounts.get(key) ?? 0)) duplicates.push(row);
    else fresh.push(row);
  }
  return { fresh, duplicates };
}

export interface MatchTx {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  kind: Kind;
  needsAttention: AttentionReason | null;
  source: Source;
  linked: boolean;
}

const TRANSFER_WINDOW_DAYS = 5;

function canBeOtherSide(t: MatchTx): boolean {
  return t.kind === 'transfer' || t.needsAttention === 'unknown_inflow';
}

/**
 * Pair transfers across accounts: opposite sign, same absolute amount, different
 * accounts, within ±5 days, both unlinked. A transfer pairs only when the match
 * is unambiguous (closest date, mutually); otherwise it's sent for review.
 */
export function findTransferPairs(txs: MatchTx[]): { pairs: [MatchTx, MatchTx][]; ambiguous: string[] } {
  const open = new Map(txs.filter((t) => !t.linked && canBeOtherSide(t)).map((t) => [t.id, t]));
  const pairs: [MatchTx, MatchTx][] = [];

  const candidatesFor = (a: MatchTx): MatchTx[] => {
    const list = [...open.values()].filter(
      (b) =>
        b.id !== a.id &&
        b.accountId !== a.accountId &&
        b.amountCents === -a.amountCents &&
        Math.abs(daysBetween(a.date, b.date)) <= TRANSFER_WINDOW_DAYS &&
        (a.kind === 'transfer' || b.kind === 'transfer'),
    );
    if (list.length <= 1) return list;
    const best = Math.min(...list.map((b) => Math.abs(daysBetween(a.date, b.date))));
    return list.filter((b) => Math.abs(daysBetween(a.date, b.date)) === best);
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const a of [...open.values()]) {
      if (!open.has(a.id)) continue;
      const ca = candidatesFor(a);
      if (ca.length !== 1) continue;
      const b = ca[0];
      const cb = candidatesFor(b);
      if (cb.length === 1 && cb[0].id === a.id) {
        pairs.push(a.amountCents < 0 ? [a, b] : [b, a]);
        open.delete(a.id);
        open.delete(b.id);
        changed = true;
      }
    }
  }

  const ambiguous = [...open.values()].filter((a) => a.kind === 'transfer' && candidatesFor(a).length > 1).map((a) => a.id);
  return { pairs, ambiguous };
}

/** Suggest merging an imported line with a manual entry for the same purchase (spec A3). */
export function findMergeCandidate(imported: MatchTx, manual: MatchTx[]): MatchTx | null {
  const hits = manual.filter(
    (m) =>
      m.source === 'manual' &&
      !m.linked &&
      m.accountId === imported.accountId &&
      m.amountCents === imported.amountCents &&
      Math.abs(daysBetween(m.date, imported.date)) <= 3,
  );
  if (!hits.length) return null;
  return hits.sort((a, b) => Math.abs(daysBetween(a.date, imported.date)) - Math.abs(daysBetween(b.date, imported.date)))[0];
}
