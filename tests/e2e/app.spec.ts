/**
 * End-to-end: the first-time setup and weekly update flows (spec F1–F4),
 * driven through the real UI on an iPhone-sized screen against a real
 * local Worker + D1.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fixtures = path.join(import.meta.dirname, '..', 'fixtures');
const OCT = 'from=2026-10-01&to=2026-10-31';
const shots = process.env.SCREENSHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!shots) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });
}

test.describe.configure({ mode: 'serial' });

test('signs in, sets up accounts, imports statements, reviews and sees the picture', async ({ page }) => {
  test.setTimeout(180_000);
  // Sign-in page
  await page.goto('/login');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await shot(page, '01-login');
  await page.goto('/login?error=private');
  await expect(page.getByRole('alert')).toContainText('This app is private');

  // Parent signs in (dev login stands in for Google locally).
  await page.goto('/auth/dev-login?email=dad@example.com&name=Dad');
  await expect(page.getByText('Welcome to Pocket!')).toBeVisible();

  // F1: add the starting accounts with today's balances.
  await page.getByRole('link', { name: 'Add accounts' }).click();
  const accounts: [string, string, string, string, string][] = [
    ['Citi Checking', 'Citibank', 'checking', '500', '2026-09-30'],
    ['SFCU Checking', 'SFCU', 'checking', '200', '2026-09-30'],
    ['SFCU Card', 'SFCU', 'credit_card', '120', '2026-09-30'],
    ['Venmo', 'Venmo', 'payment_app', '24', '2026-09-30'],
  ];
  for (const [name, inst, type, bal, asOf] of accounts) {
    await page.getByRole('button', { name: '+ Add' }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Name').fill(name);
    await sheet.getByLabel('Bank / app').fill(inst);
    await sheet.getByLabel('Type').selectOption(type);
    await sheet.getByLabel(/Balance today|Amount owed today/).fill(bal);
    await sheet.getByLabel('As of').fill(asOf);
    await sheet.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('$120.00 owed', { exact: true })).toBeVisible();
  await shot(page, '02-accounts');

  // Allowance detection.
  await page.goto('/more/settings');
  await page.getByLabel(/Parent's name/).fill('Nikhil');
  await page.getByRole('button', { name: 'Save' }).click();

  // F2: import Citi (separate debit/credit columns are detected).
  await page.goto('/import');
  await page.getByLabel('Account').selectOption({ label: 'Citi Checking' });
  await page.getByLabel(/Statement file/).setInputFiles(path.join(fixtures, 'citi.csv'));
  await expect(page.getByText('Match the columns (first time only)')).toBeVisible();
  await expect(page.getByText('Zelle From Nikhil R').or(page.getByText('ZELLE FROM NIKHIL R')).first()).toBeVisible();
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText('✓ 7 new')).toBeVisible();
  await shot(page, '03-import-preview');
  await page.getByRole('button', { name: 'Import 7 transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Imported!' })).toBeVisible();

  // SFCU card: purchases are positive in the file, so flip the sign.
  await page.getByRole('button', { name: 'Import another statement' }).click();
  await page.getByLabel('Account').selectOption({ label: 'SFCU Card' });
  await page.getByLabel(/Statement file/).setInputFiles(path.join(fixtures, 'sfcu-card.csv'));
  await page.getByLabel(/Purchases show as positive/).check();
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText('↔ 1 transfers matched')).toBeVisible();
  await page.getByRole('button', { name: 'Import 7 transactions' }).click();
  await expect(page.getByRole('heading', { name: 'Imported!' })).toBeVisible();

  // Venmo: format detected automatically; statement balance checks out.
  await page.getByRole('button', { name: 'Import another statement' }).click();
  await page.getByLabel('Account').selectOption({ label: 'Venmo' });
  await page.getByLabel(/Statement file/).setInputFiles(path.join(fixtures, 'venmo.csv'));
  await expect(page.getByText('Venmo statement')).toBeVisible();
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText(/Balanced: \$22\.00 matches the bank/)).toBeVisible();
  await page.getByRole('button', { name: /Import 4 transactions/ }).click();
  await expect(page.getByRole('heading', { name: 'Imported!' })).toBeVisible();

  // Re-importing the same file adds nothing.
  await page.getByRole('button', { name: 'Import another statement' }).click();
  await page.getByLabel('Account').selectOption({ label: 'Citi Checking' });
  await page.getByLabel(/Statement file/).setInputFiles(path.join(fixtures, 'citi.csv'));
  await page.getByRole('button', { name: 'Preview import' }).click();
  await expect(page.getByText('⤼ 7 already here (skipped)')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nothing new to import' })).toBeDisabled();

  // F3: review queue — Maya paying back her half of pizza.
  await page.goto('/review');
  await shot(page, '04-review');
  for (let i = 0; i < 10; i++) {
    const card = page.locator('section').first();
    if (await page.getByText('All caught up!').isVisible()) break;
    if (await card.getByText('Money in — what is it?').isVisible()) {
      await card.getByRole('button', { name: /^Maya L/ }).click();
    } else if (await card.getByText('Needs a category').isVisible()) {
      const isTarget = await card.getByRole('paragraph').filter({ hasText: /^Target$/ }).isVisible();
      await card.getByRole('button', { name: 'More…' }).click();
      await card.getByRole('button', { name: isTarget ? /Groceries/ : /Entertainment/ }).click();
    } else {
      await card.getByRole('button', { name: 'Skip ›' }).click();
    }
    await page.waitForTimeout(300);
  }
  await expect(page.getByText('All caught up!')).toBeVisible();

  // Split the Target run: groceries + clothing.
  await page.goto(`/activity?${OCT}&q=target`);
  await page.getByRole('link', { name: /Target/ }).click();
  await page.getByRole('button', { name: '✂️ Split' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Part 1 amount').fill('30');
  await sheet.getByLabel('Part 2 category').selectOption({ label: '👕 Clothing' });
  await expect(sheet.getByLabel('Part 2 amount')).toHaveValue('22.40');
  await sheet.getByRole('button', { name: 'Save split' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText('👕 Clothing')).toBeVisible();
  await shot(page, '05-transaction-split');

  // F4: parent adds a cost they paid directly.
  await page.goto('/add');
  await page.getByLabel('Amount').fill('1200');
  await page.getByLabel('What was it?').fill('October rent');
  await page.getByRole('button', { name: /More…/ }).click();
  await page.getByRole('button', { name: /Rent & housing/ }).click();
  await page.getByLabel('Date').fill('2026-10-01');
  await page.getByText('🤝 Paid by parent').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/✓ Added October rent/)).toBeVisible();
  await shot(page, '06-quick-add');

  // Home: the one-minute answer.
  await page.goto(`/?${OCT}`);
  await expect(page.getByText('October 2026')).toBeVisible();
  // Citi 89.80 + card 179.39 + Venmo (36 − 18 + 20) = 307.19
  await expect(page.getByText('$307.19', { exact: true })).toBeVisible();
  await expect(page.getByText('$1,507.19', { exact: true })).toBeVisible(); // cost of living incl. rent
  await expect(page.getByText('$600.00', { exact: true })).toBeVisible(); // allowance in
  await expect(page.getByText('All caught up 🎉')).toBeVisible();
  // $120 owed − $120 payment + $179.39 new purchases
  await expect(page.getByText('$179.39 owed', { exact: true })).toBeVisible();
  await shot(page, '07-home');
  await page.getByRole('button', { name: /^Food/ }).click();
  await shot(page, '08-home-food');

  // Activity shows transfers as not counted.
  await page.goto(`/activity?${OCT}`);
  await expect(page.getByText(/Transfer · not counted/).first()).toBeVisible();
  await shot(page, '09-activity');
});

test('the daughter sees the same picture', async ({ page }) => {
  await page.goto('/auth/dev-login?email=kid@example.com&name=Kid');
  await page.goto(`/?${OCT}`);
  await expect(page.getByText('$307.19', { exact: true })).toBeVisible();
  await page.goto('/more');
  await expect(page.getByText('Signed in as Kid (daughter)')).toBeVisible();
});
