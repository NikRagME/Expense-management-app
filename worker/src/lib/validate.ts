import { z } from 'zod';
import { isIsoDate } from '../../../shared/dates';
import { ACCOUNT_TYPES, KINDS } from '../../../shared/types';
import { HttpError } from './pipeline';

export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new HttpError(400, `${issue.path.join('.') || 'body'}: ${issue.message}`);
  }
  return r.data;
}

export const isoDate = z.string().refine(isIsoDate, 'must be a YYYY-MM-DD date');
export const cents = z.number().int();
export const kind = z.enum(KINDS);
export const accountType = z.enum(ACCOUNT_TYPES);
export const nullableId = z.string().min(1).nullable();

export const csvMapping = z.object({
  skipRows: z.number().int().min(0),
  hasHeader: z.boolean(),
  dateCol: z.number().int().min(0),
  descriptionCol: z.number().int().min(0),
  amountCol: z.number().int().min(0).optional(),
  debitCol: z.number().int().min(0).optional(),
  creditCol: z.number().int().min(0).optional(),
  sign: z.enum(['normal', 'inverted']),
  balanceCol: z.number().int().min(0).optional(),
  dateFormat: z.enum(['auto', 'MDY', 'YMD', 'DMY']),
});

export const parsedRow = z.object({
  date: isoDate,
  amountCents: cents.refine((n) => n !== 0, 'must not be 0'),
  description: z.string().max(500),
  externalId: z.string().max(200).optional(),
  counterparty: z.string().max(200).optional(),
  paymentNote: z.string().max(500).optional(),
  fundingSource: z.string().max(200).optional(),
  kindHint: kind.optional(),
});
