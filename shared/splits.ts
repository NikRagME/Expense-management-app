/** Splits: a transaction's category lines must add up exactly to its amount (spec §5.3). */

export interface SplitPart {
  amountCents: number;
  categoryId: string | null;
  note?: string;
}

export function validateSplit(totalCents: number, parts: SplitPart[]): string | null {
  if (parts.length < 2) return 'A split needs at least 2 parts';
  if (parts.some((p) => p.amountCents === 0)) return 'Each part needs an amount';
  if (parts.some((p) => Math.sign(p.amountCents) !== Math.sign(totalCents))) return 'Parts must have the same sign as the transaction';
  const sum = parts.reduce((a, p) => a + p.amountCents, 0);
  if (sum !== totalCents) return `Parts add up to ${sum / 100} but the transaction is ${totalCents / 100}`;
  return null;
}

/** Amount still unassigned while editing a split (the last part auto-fills with this). */
export function remainingCents(totalCents: number, parts: SplitPart[]): number {
  return totalCents - parts.reduce((a, p) => a + p.amountCents, 0);
}
