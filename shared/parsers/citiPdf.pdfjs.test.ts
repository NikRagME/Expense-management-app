/**
 * End-to-end PDF reading through pdf.js, using the made-up fixture
 * (tests/fixtures/citi-statement.pdf). Set REAL_CITI_PDF to try a real
 * statement on your own machine; real statements are never committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCitiPdf } from './citiPdf';
import { extractPdfPages } from './pdfText';

const file = process.env.REAL_CITI_PDF ?? path.join(import.meta.dirname, '..', '..', 'tests', 'fixtures', 'citi-statement.pdf');

describe('Citi PDF through pdf.js', () => {
  it('reads both accounts and each reconciles to the bank balances', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const statements = parseCitiPdf(await extractPdfPages(getDocument, new Uint8Array(fs.readFileSync(file))));
    expect(statements.map((s) => s.section?.kind)).toEqual(['checking', 'savings']);
    for (const s of statements) {
      expect(s.errors).toEqual([]);
      expect(s.openingBalance!.cents + s.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(s.balance!.cents);
    }
    if (!process.env.REAL_CITI_PDF) {
      expect(statements[0].rows).toHaveLength(9);
      expect(statements[0].rows[0]).toMatchObject({ amountCents: 50000, counterparty: 'Jordan River' });
      expect(statements[1].balance).toEqual({ asOf: '2026-10-01', cents: 19554 });
    }
  });
});
