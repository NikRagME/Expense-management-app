import { describe, expect, it } from 'vitest';
import { looksLikeCitiPdf, parseCitiPdf, type PdfPage } from './citiPdf';

/** Build a page from [y, [x, text]...] rows, mimicking pdf.js output for Citi's layout. */
const page = (rows: [number, ...[number, string][]][]): PdfPage => rows.flatMap(([y, ...items]) => items.map(([x, str]) => ({ x, y, str })));

const HEADER: [number, ...[number, string][]] = [636, [51, 'Date'], [80, 'Description'], [315, 'Amount Subtracted'], [419, 'Amount Added'], [526, 'Balance']];

const pages: PdfPage[] = [
  page([
    [760, [40, 'Citibank Client Services']],
    [740, [400, 'Statement Period'], [480, 'Dec 9 - Jan 8, 2027']],
  ]),
  page([
    [700, [43, 'CHECKING ACTIVITY']],
    [690, [50, 'Regular Checking']],
    [665, [50, '42049551234'], [377, 'Beginning Balance:'], [538, '$0.00']],
    [655, [377, 'Ending Balance:'], [532, '$420.00']],
    HEADER,
    [625, [50, '12/11'], [79, 'Zelle Credit'], [128, 'PAY ID:X ORG ID:CTI NAME:NIKHIL RAGHA'], [454, '500.00']],
    [615, [50, '12/14'], [79, 'Debit PIN Purchase'], [162, 'WAL-MART #2280'], [238, 'MOUNTAIN VIEWCAUS05154'], [376, '50.24'], [521, '449.76']],
    [599, [50, '12/30'], [79, 'Debit Card Purchase 12/27 06:28p #4065'], [376, '24.44']],
    [592, [79, 'COUPA CAFE 4'], [152, 'STANFORD'], [202, 'CA 26271']],
    [585, [79, 'Restaurant/Bar']],
    [575, [50, '01/02'], [79, 'Mobile Purchase Returns 12/31 #4065'], [459, '22.14']],
    [568, [79, 'D0964 THREDUP'], [167, '6175759676'], [213, 'CA 26271']],
    [560, [50, '01/05'], [79, 'Transfer to Money Market 02:23a #4065'], [371, '27.46'], [539, '420.00']],
    [553, [79, 'ONLINE'], [146, 'Reference # 000038']],
    [540, [50, 'Total Subtracted/Added'], [376, '102.14'], [459, '522.14']],
  ]),
  page([
    [700, [43, 'SAVINGS ACTIVITY']],
    [690, [50, 'Citi® Savings']],
    [665, [50, '42049559299'], [377, 'Beginning Balance:'], [538, '$100.00']],
    [655, [377, 'Ending Balance:'], [532, '$127.50']],
    HEADER,
    [625, [50, '01/05'], [79, 'Transfer From Checking 02:23a #4065'], [459, '27.46']],
    [615, [79, 'ONLINE'], [146, 'Reference # 000038']],
    [605, [50, '01/08'], [79, 'Interest paid for 30 days, Annual Percentage Yield Earned 1.78%'], [464, '0.04'], [534, '127.50']],
  ]),
];

describe('Citi PDF statements', () => {
  it('detects the layout', () => {
    expect(looksLikeCitiPdf(pages)).toBe(true);
  });

  it('splits checking and savings, with opening and closing balances that reconcile', () => {
    const [checking, savings] = parseCitiPdf(pages);
    expect(checking.section).toEqual({ kind: 'checking', label: 'Citi Regular Checking', last4: '1234' });
    expect(savings.section).toMatchObject({ kind: 'savings', label: 'Citi Savings', last4: '9299' });
    for (const s of [checking, savings]) {
      expect(s.openingBalance!.cents + s.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(s.balance!.cents);
    }
    // A period crossing New Year gets the right years.
    expect(checking.openingBalance).toEqual({ asOf: '2026-12-08', cents: 0 });
    expect(checking.balance).toEqual({ asOf: '2027-01-08', cents: 42000 });
  });

  it('cleans up each kind of entry', () => {
    const [checking, savings] = parseCitiPdf(pages);
    expect(checking.rows).toEqual([
      { date: '2026-12-11', amountCents: 50000, description: 'Zelle from NIKHIL RAGHA', counterparty: 'Nikhil Ragha' },
      { date: '2026-12-14', amountCents: -5024, description: 'WAL-MART MOUNTAIN VIEWCAUS05154' },
      { date: '2026-12-30', amountCents: -2444, description: 'COUPA CAFE 4 STANFORD CA 26271', categoryHint: 'eating_out' },
      { date: '2027-01-02', amountCents: 2214, description: 'Return: D0964 THREDUP 6175759676 CA 26271' },
      { date: '2027-01-05', amountCents: -2746, description: 'Transfer to Money Market' },
    ]);
    expect(savings.rows.map((r) => [r.description, r.amountCents])).toEqual([
      ['Transfer From Checking', 2746],
      ['Interest paid', 4],
    ]);
  });
});
