/** OFX/QFX (SGML v1 and XML v2) statement parser. */
import { parseDate } from '../dates';
import { parseAmount } from '../money';
import type { ParsedRow, ParsedStatement } from '../types';

export function looksLikeOfx(text: string): boolean {
  return /<OFX>/i.test(text) || /OFXHEADER/i.test(text);
}

function tag(block: string, name: string): string | undefined {
  // Works for both <NAME>value</NAME> and SGML <NAME>value\n
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? decode(m[1].trim()) : undefined;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"');
}

export function parseOfx(text: string): ParsedStatement {
  const rows: ParsedRow[] = [];
  const errors: string[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(tag(block, 'DTPOSTED') ?? '');
    const amount = parseAmount(tag(block, 'TRNAMT'));
    const name = tag(block, 'NAME') ?? '';
    const memo = tag(block, 'MEMO') ?? '';
    const fitid = tag(block, 'FITID');
    if (!date || amount == null) {
      errors.push(`Couldn't read transaction ${fitid ?? '(no id)'}`);
      continue;
    }
    if (amount === 0) continue;
    const description = memo && !name.includes(memo) ? `${name} ${memo}`.trim() : name || memo;
    rows.push({ date, amountCents: amount, description, externalId: fitid });
  }

  let balance: ParsedStatement['balance'];
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>)/i.exec(text);
  if (ledger) {
    const cents = parseAmount(tag(ledger[1], 'BALAMT'));
    const asOf = parseDate(tag(ledger[1], 'DTASOF') ?? '');
    if (cents != null && asOf) balance = { asOf, cents };
  }
  return { format: 'ofx', rows, balance, errors };
}
