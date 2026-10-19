/**
 * History setup through the UI (spec §12): a Citi PDF statement from opening
 * day, her spreadsheet matched onto it, and the leftovers decided in Review.
 * Uses made-up fixtures (tests/fixtures/generate.mts).
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixtures = path.join(import.meta.dirname, '..', 'fixtures');
const shots = process.env.SCREENSHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

test('brings accounts up to date from opening day with a PDF statement and her spreadsheet', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/auth/dev-login?email=dad@example.com&name=Dad');

  await page.goto('/more/settings');
  await page.getByLabel("Parent's full name").fill('Jordan Riverton');
  await page.getByLabel('Her full name').fill('Alex Riverton');
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByLabel('Her full name')).toHaveValue('Alex Riverton');

  // Her accounts (no balances typed: the statement provides them).
  await page.goto('/more/accounts');
  for (const [name, type] of [
    ['Alex Citi Checking', 'checking'],
    ['Alex Citi Savings', 'savings'],
    ['Alex SFCU Card', 'credit_card'],
  ]) {
    await page.getByRole('button', { name: '+ Add' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Name').fill(name);
    await sheet.getByLabel('Type').selectOption(type);
    await sheet.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // Step 2: one Citi PDF fills checking and savings, from $0 at opening.
  await page.goto('/import');
  await page.getByLabel(/Statement file/).setInputFiles(path.join(fixtures, 'citi-statement.pdf'));
  await expect(page.getByText('Citi PDF statement')).toBeVisible();
  const intos = page.getByLabel('Import into');
  await intos.nth(0).selectOption({ label: 'Alex Citi Checking' });
  await intos.nth(1).selectOption({ label: 'Alex Citi Savings' });
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText(/Balanced: \$306\.35 matches the bank/)).toBeVisible();
  await expect(page.getByText(/Balanced: \$195\.54 matches the bank/)).toBeVisible();
  await shot(page, 'h1-pdf-preview');
  await page.getByRole('button', { name: /Import 12 transactions/ }).click();
  await expect(page.getByText(/12 transactions imported/)).toBeVisible();

  // The $35,000 deposit that paid tuition: money from parent, not her income.
  await page.goto('/review');
  for (let i = 0; i < 8; i++) {
    const card = page.locator('section').first();
    if (await card.getByText('Deposit Teller').isVisible()) break;
    await card.getByRole('button', { name: /^Skip/ }).first().click();
  }
  await shot(page, 'h2-review-deposit');
  await page.getByRole('button', { name: /From parent, to cover a cost/ }).click();
  await expect(page.locator('section').first().getByText('Deposit Teller')).toBeHidden();

  // Step 3: her spreadsheet.
  await page.goto('/setup');
  await expect(page.getByRole('heading', { name: 'When each account opened' })).toBeVisible();
  await page.getByRole('link', { name: 'Bring in her spreadsheet' }).click();
  await page.getByLabel('Spreadsheet file').setInputFiles(path.join(fixtures, 'spreadsheet.xlsx'));
  await expect(page.getByText('Budget Tracker', { exact: false }).first()).toBeVisible();
  await page.getByLabel('Account for Citi Checking').selectOption({ label: 'Alex Citi Checking' });
  await page.getByLabel('Account for SFCU Credit').selectOption({ label: 'Alex SFCU Card' });
  await page.getByLabel('Which account is this tab for?').selectOption({ label: 'Alex Citi Checking' });
  await expect(page.getByLabel('Category for OoB')).toHaveValue('parent_pays');
  await expect(page.getByLabel('Category for Groceries')).toHaveValue('groceries');
  await shot(page, 'h3-spreadsheet-mapping');
  await page.getByRole('button', { name: /Preview 7 rows/ }).click();
  await expect(page.getByText('✓ 4 matched to a bank line (1 with a slightly different amount; the bank\'s is kept)')).toBeVisible();
  await expect(page.getByText('＋ 2 added (no statement covers them)')).toBeVisible();
  await expect(page.getByText('👀 1 to decide in Review')).toBeVisible();
  await shot(page, 'h4-spreadsheet-preview');
  await page.getByRole('button', { name: 'Apply to Pocket' }).click();
  await expect(page.getByText('4 matched · 2 added · 1 to decide')).toBeVisible();

  // "Initial Budget" isn't a real transaction on the statement: skip it.
  await page.goto('/review');
  for (let i = 0; i < 12; i++) {
    const card = page.locator('section').first();
    if (await card.getByText('Initial Budget').isVisible()) break;
    await card.getByRole('button', { name: /^Skip/ }).last().click();
  }
  await expect(page.getByText("In her spreadsheet but not on the statement")).toBeVisible();
  await shot(page, 'h5-review-sheet-row');
  await page.getByRole('button', { name: 'Skip: not a real transaction' }).click();
  await expect(page.locator('section').first().getByText('Initial Budget')).toBeHidden();

  // Her words and choices are on the bank lines.
  await page.goto('/activity?from=2026-09-01&to=2026-09-30&q=Uber');
  await page.getByRole('link', { name: /Uber to PA/ }).click();
  await expect(page.getByRole('button', { name: 'Paid by parent' })).toHaveClass(/bg-brand/);
  await expect(page.getByText('Bank says:')).toBeVisible();

  // September for her: her spending excludes tuition and the Uber you pay for.
  await page.goto('/?from=2026-09-01&to=2026-09-30');
  // Walmart 50.24 + Fake Reeses 6.00 + Coupa 24.44 − 2.00 paid back = 78.68
  await expect(page.getByText('$78.68', { exact: true })).toBeVisible();
  await expect(page.getByText('$34,898.65', { exact: true })).toBeVisible(); // + tuition 34,805 + Uber 14.97
  await expect(page.getByText('Money in').locator('..').getByText('$500.00', { exact: true })).toBeVisible(); // allowance only

  await page.goto('/setup');
  await expect(page.getByText(/Statements cover Sep 9 – Oct 1, 2026/).first()).toBeVisible();
  await shot(page, 'h6-setup');
});
