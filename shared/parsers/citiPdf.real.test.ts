/**
 * Runs only when REAL_CITI_PDF points at a real statement on this machine.
 * Real statements are never committed; see citiPdf.test.ts for the fixture tests.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCitiPdf } from './citiPdf';
import { extractPdfPages } from './pdfText';

const file = process.env.REAL_CITI_PDF;

describe.skipIf(!file)('real Citi statement', () => {
  it('parses and balances', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pages = await extractPdfPages(getDocument, new Uint8Array(fs.readFileSync(file!)));
    const statements = parseCitiPdf(pages);
    for (const s of statements) {
      const sum = s.rows.reduce((a, r) => a + r.amountCents, 0);
      console.log(s.section, 'rows', s.rows.length, 'open', s.openingBalance, 'close', s.balance, 'sum', sum, s.errors);
      for (const r of s.rows) console.log('  ', r.date, (r.amountCents / 100).toFixed(2).padStart(10), r.description, r.counterparty ?? '', r.categoryHint ?? '');
      expect(s.openingBalance!.cents + sum).toBe(s.balance!.cents);
    }
  });
});
