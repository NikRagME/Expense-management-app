/**
 * Generates made-up fixtures shaped like the real files (never real data):
 *   citi-statement.pdf  – a Citi-style PDF (checking + savings, opening/closing balances)
 *   spreadsheet.xlsx    – a tracking sheet like hers (two tabs, side tables, OoB tags)
 *
 * Run: node --experimental-strip-types tests/fixtures/generate.mts
 * (uses Playwright's Chromium to print the PDF; set PW_CHROMIUM to its path if needed)
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { writeXlsx, type Cell } from '../../shared/testing/xlsxWriter.ts';

const dir = path.dirname(new URL(import.meta.url).pathname);

// ---- PDF -------------------------------------------------------------------------
// Text is placed at the same x positions (in points) as Citi's real layout.
type Item = [x: number, text: string];
const page = (lines: [top: number, ...Item[]][]) =>
  `<div class="page">${lines.map(([top, ...items]) => items.map(([x, t]) => `<span style="left:${x}pt;top:${top}pt">${t}</span>`).join('')).join('')}</div>`;

const H: [number, ...Item[]] = [156, [51, 'Date'], [80, 'Description'], [315, 'Amount Subtracted'], [419, 'Amount Added'], [526, 'Balance']];

const pages = [
  page([
    [40, [40, 'Citibank Client Services']],
    [60, [380, 'Statement Period'], [460, 'Sep 9 - Oct 1, 2026']],
    [90, [40, 'ALEX RIVERTON']],
  ]),
  page([
    [60, [43, 'CHECKING ACTIVITY']],
    [80, [50, 'Regular Checking']],
    [100, [50, '42049551111'], [377, 'Beginning Balance:'], [538, '$0.00']],
    [112, [377, 'Ending Balance:'], [532, '$306.35']],
    H,
    [180, [50, '09/11'], [79, 'Zelle Credit'], [128, 'PAY ID:A1 ORG ID:CTI NAME:JORDAN RIVER'], [454, '500.00']],
    [194, [50, '09/11'], [79, 'Transfer From Money Market 07:04p #4065'], [441, '34,805.00'], [521, '35,305.00']],
    [204, [79, 'ONLINE'], [146, 'Reference # 000135']],
    [218, [50, '09/14'], [79, 'Debit PIN Purchase'], [162, 'WAL-MART #2280'], [238, 'MOUNTAIN VIEWCAUS05154'], [376, '50.24']],
    [232, [50, '09/15'], [79, 'ACH Electronic Debit'], [167, 'Stanford Univ'], [217, 'Stanford'], [250, 'OPU17102198'], [358, '34,805.00'], [534, '449.76']],
    [246, [50, '09/21'], [79, 'Zelle Debit'], [125, 'PAY ID:A2 ORG ID:BAC NAME:CASEY KIM'], [381, '6.00']],
    [260, [50, '09/24'], [79, 'Zelle Debit'], [125, 'PAY ID:A3 ORG ID:0NJ NAME:Alex River'], [371, '100.00']],
    [274, [50, '09/28'], [79, 'Zelle Credit'], [128, 'PAY ID:A4 ORG ID:JPM NAME:DEV PATEL'], [464, '2.00']],
    [288, [50, '09/29'], [79, 'Debit Card Purchase 09/27 06:28p #4065'], [376, '24.44']],
    [298, [79, 'COUPA CAFE 4'], [152, 'STANFORD'], [202, 'CA 26271']],
    [308, [79, 'Restaurant/Bar']],
    [322, [50, '09/29'], [79, 'Mobile Purchase Sign Based 09/27 07:21p #4065'], [376, '14.97'], [539, '306.35']],
    [332, [79, 'UBER'], [104, '*TRIP'], [145, '8005928996'], [191, 'CA 26271']],
    [342, [79, 'Misc Transportation']],
    [360, [50, 'Total Subtracted/Added'], [358, '35,000.65'], [441, '35,307.00']],
  ]),
  page([
    [60, [43, 'SAVINGS ACTIVITY']],
    [80, [50, 'Citi® Savings']],
    [100, [50, '42049552222'], [377, 'Beginning Balance:'], [538, '$0.00']],
    [112, [377, 'Ending Balance:'], [532, '$195.54']],
    H,
    [180, [50, '09/11'], [79, 'Deposit Teller'], [441, '35,000.00']],
    [194, [50, '09/11'], [79, 'Transfer to Checking 07:04p #4065'], [358, '34,805.00'], [534, '195.00']],
    [204, [79, 'ONLINE'], [146, 'Reference # 000135']],
    [218, [50, '10/01'], [79, 'Interest paid for 23 days, Annual Percentage Yield Earned 1.78%'], [464, '0.54'], [534, '195.54']],
  ]),
];

const html = `<!doctype html><html><head><style>
  @page { size: 612pt 792pt; margin: 0 }
  body { margin: 0; font: 8pt Helvetica, Arial, sans-serif }
  .page { position: relative; width: 612pt; height: 792pt; page-break-after: always; overflow: hidden }
  span { position: absolute; white-space: nowrap }
</style></head><body>${pages.join('')}</body></html>`;

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const p = await browser.newPage();
await p.setContent(html);
await p.pdf({ path: path.join(dir, 'citi-statement.pdf'), width: '8.5in', height: '11in', printBackground: false });
await browser.close();

// ---- Spreadsheet ---------------------------------------------------------------
const d = (iso: string) => ({ date: iso });
const budget: Cell[][] = [
  ['Budget Tracker', null, null, null, null, null, 'Bankwise Spending'],
  [null, 'START', 'END', 'OoB'],
  [null, 350, 220.1, 59.97],
  [],
  ['Expenses'],
  ['Date', 'Amount', 'Description', 'Category', 'Account', null, 'Recurring Bills and Dates'],
  [d('2026-09-30'), 24.44, 'Coupa w Sam', 'Food', 'Citi Checking', null, 'BILL', 'AMOUNT', 'DATE', 'BANK'],
  [d('2026-09-28'), 14.97, 'Uber to PA', 'OoB', 'Citi Checking', null, 'Phone', '51.31', '28th', 'Citi Checking'],
  [d('2026-10-04'), 45, 'Big Game Tickets', 'OoB', 'SFCU Credit'],
  [d('2026-10-09'), 21.47, 'Trader Joes', 'Groceries', 'SFCU Credit'],
  [d('2026-10-26')],
];
const ledger: Cell[][] = [
  ['Citi Checking & Saving Balance'],
  [null, 'GIVEN', 'REMAINING'],
  [],
  ['Date', 'Amount', 'Description', 'Category', 'One Time'],
  ['10/1/2026', '$500.00', 'Initial Budget', 'PAYMENT IN'],
  ['9/14/2026', '$50.00', 'Walmart', 'PAYMENT OUT'],
  ['9/21/2026', '$6.00', 'Fake Reeses', 'PAYMENT OUT'],
];
fs.writeFileSync(path.join(dir, 'spreadsheet.xlsx'), await writeXlsx([{ name: 'Budget Tracker', rows: budget }, { name: 'Citi Checking & Saving Balance', rows: ledger }]));
console.log('fixtures written to', dir);
