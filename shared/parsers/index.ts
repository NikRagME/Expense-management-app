import type { CsvMapping, ParsedStatement } from '../types';
import { guessMapping, parseCsv, parseCsvText } from './csv';
import { looksLikeOfx, parseOfx } from './ofx';
import { looksLikeVenmo, parseVenmo } from './venmo';

export { guessMapping, parseCsv, parseCsvText, parseOfx, parseVenmo };

export type DetectedFormat = 'ofx' | 'venmo' | 'csv';

export function detectFormat(text: string): DetectedFormat {
  if (looksLikeOfx(text)) return 'ofx';
  if (looksLikeVenmo(text)) return 'venmo';
  return 'csv';
}

/** Parse any supported statement. CSV needs a mapping (saved per account, or guessed). */
export function parseStatement(text: string, mapping?: CsvMapping | null): ParsedStatement {
  const format = detectFormat(text);
  if (format === 'ofx') return parseOfx(text);
  if (format === 'venmo') return parseVenmo(text);
  return parseCsv(text, mapping ?? guessMapping(parseCsvText(text)));
}
