import { describe, expect, it } from 'vitest';
import { detectFormat, guessMapping, parseCsv, parseCsvText, parseOfx, parseStatement, parseVenmo } from './index';

describe('CSV', () => {
  it('parses quoted fields and CRLF', () => {
    expect(parseCsvText('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('guesses a single signed amount column (Citi-style)', () => {
    const text = 'Status,Date,Description,Debit,Credit\nCleared,10/02/2026,"TRADER JOE S #123",45.10,\nCleared,10/03/2026,ZELLE FROM JORDAN,,300.00\n';
    const mapping = guessMapping(parseCsvText(text));
    expect(mapping).toMatchObject({ skipRows: 0, dateCol: 1, descriptionCol: 2, debitCol: 3, creditCol: 4 });
    const { rows, errors } = parseCsv(text, mapping);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { date: '2026-10-02', amountCents: -4510, description: 'TRADER JOE S #123' },
      { date: '2026-10-03', amountCents: 30000, description: 'ZELLE FROM JORDAN' },
    ]);
  });

  it('skips junk lines before the header, inverts card signs, reads balances', () => {
    const text = 'Account: SFCU Visa\nExported 10/19/2026\nPosted Date,Description,Amount,Balance\n10/05/2026,CHIPOTLE 1234,12.50,312.50\n10/06/2026,PAYMENT THANK YOU,-300.00,12.50\nTotal,,,\n';
    const mapping = { ...guessMapping(parseCsvText(text)), sign: 'inverted' as const };
    expect(mapping.skipRows).toBe(2);
    const { rows, balance } = parseCsv(text, mapping);
    expect(rows.map((r) => r.amountCents)).toEqual([-1250, 30000]);
    expect(balance).toEqual({ asOf: '2026-10-06', cents: 1250 });
  });

  it('reports unreadable data rows', () => {
    const { errors } = parseCsv('Date,Description,Amount\nnot-a-date,Thing,5.00\n', guessMapping([['Date', 'Description', 'Amount']]));
    expect(errors).toHaveLength(1);
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005120000[-8:PST]
<TRNAMT>-6.50
<FITID>202610050001
<NAME>SQ *BLUE BOTTLE
<MEMO>PALO ALTO CA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261006
<TRNAMT>300.00
<FITID>202610060002
<NAME>ZELLE FROM JORDAN &amp; CO
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>412.30
<DTASOF>20261018
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe('OFX', () => {
  it('parses transactions, ids and the ledger balance', () => {
    expect(detectFormat(OFX_SGML)).toBe('ofx');
    const s = parseOfx(OFX_SGML);
    expect(s.rows).toEqual([
      { date: '2026-10-05', amountCents: -650, description: 'SQ *BLUE BOTTLE PALO ALTO CA', externalId: '202610050001' },
      { date: '2026-10-06', amountCents: 30000, description: 'ZELLE FROM JORDAN & CO', externalId: '202610060002' },
    ]);
    expect(s.balance).toEqual({ asOf: '2026-10-18', cents: 41230 });
  });

  it('parses XML OFX', () => {
    const xml = '<?xml version="1.0"?><?OFX OFXHEADER="200"?><OFX><STMTTRN><DTPOSTED>20261001</DTPOSTED><TRNAMT>-1.00</TRNAMT><FITID>a</FITID><NAME>X</NAME></STMTTRN></OFX>';
    expect(parseOfx(xml).rows).toHaveLength(1);
  });
});

const VENMO = `Account Statement - (@daughter) ,,,,,,,,,,,,,,,,,
Account Activity,,,,,,,,,,,,,,,,,
,ID,Datetime,Type,Status,Note,From,To,Amount (total),Amount (tip),Amount (tax),Amount (fee),Tax Rate,Tax Exempt,Funding Source,Destination,Beginning Balance,Ending Balance
,,,,,,,,,,,,,,,,$24.00,
,4001,2026-10-13T19:02:11,Payment,Complete,pizza 🍕,Daughter R,Maya L,- $36.00,,0,,0,,Citibank Checking *1234,,,
,4002,2026-10-14T09:15:40,Payment,Complete,pizza 🍕,Maya L,Daughter R,+ $18.00,,0,,0,,,Venmo balance,,
,4003,2026-10-15T10:00:00,Payment,Complete,coffee,Daughter R,Sam K,- $6.00,,0,,0,,Venmo balance,,,
,4004,2026-10-16T08:00:00,Standard Transfer,Issued,,,,- $12.00,,,,,,,SFCU Checking *9876,,
,4005,2026-10-16T08:00:00,Payment,Pending,x,Daughter R,Sam K,- $1.00,,0,,0,,Venmo balance,,,
,,,,,,,,,,,,,,,,,$24.00
`;

describe('Venmo', () => {
  it('detects and parses payments, funding legs, transfers and the ending balance', () => {
    expect(detectFormat(VENMO)).toBe('venmo');
    const s = parseVenmo(VENMO);
    expect(s.errors).toEqual([]);
    expect(s.rows.map((r) => [r.externalId, r.amountCents, r.kindHint ?? '', r.counterparty ?? ''])).toEqual([
      ['4001:funding', 3600, 'transfer', ''],
      ['4001', -3600, '', 'Maya L'],
      ['4002', 1800, '', 'Maya L'],
      ['4003', -600, '', 'Sam K'],
      ['4004', -1200, 'transfer', ''],
    ]);
    expect(s.rows[1].paymentNote).toBe('pizza 🍕');
    expect(s.balance).toEqual({ asOf: '2026-10-16', cents: 2400 });
    // Net Venmo movement is 0, consistent with beginning and ending balance of $24.
    expect(s.rows.reduce((a, r) => a + r.amountCents, 0)).toBe(0);
  });

  it('routes through parseStatement', () => {
    expect(parseStatement(VENMO).format).toBe('venmo');
  });

  it('does not mistake a bank CSV that mentions Venmo for a Venmo statement', () => {
    expect(detectFormat('Date,Description,Amount\n10/13/2026,VENMO PAYMENT 1023,-36.00\n')).toBe('csv');
  });
});
