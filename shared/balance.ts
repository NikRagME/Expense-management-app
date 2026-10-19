/** Account balances: roll-forward from known balances, and the balance check (spec §4.5). */

export interface Snapshot {
  asOf: string; // end of day
  cents: number;
}

export interface Movement {
  date: string;
  amountCents: number;
}

/** Latest snapshot on or before `date`. */
export function snapshotAt(snapshots: Snapshot[], date: string): Snapshot | null {
  let best: Snapshot | null = null;
  for (const s of snapshots) if (s.asOf <= date && (!best || s.asOf >= best.asOf)) best = s;
  return best;
}

/** Balance at end of `date`, or null when no known balance exists on or before it. */
export function balanceAt(snapshots: Snapshot[], movements: Movement[], date: string): number | null {
  const base = snapshotAt(snapshots, date);
  if (!base) return null;
  let cents = base.cents;
  for (const m of movements) if (m.date > base.asOf && m.date <= date) cents += m.amountCents;
  return cents;
}

/**
 * Compare a newly known balance with what the app computes from the previous
 * snapshot. Returns null when there's nothing to compare against (first balance).
 */
export function checkBalance(
  previous: Snapshot[],
  movements: Movement[],
  incoming: Snapshot,
): { computedCents: number; differenceCents: number } | null {
  const computed = balanceAt(previous, movements, incoming.asOf);
  if (computed == null) return null;
  return { computedCents: computed, differenceCents: incoming.cents - computed };
}
