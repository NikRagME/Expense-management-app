# Setup guide

One-time steps to put Pocket online. Everything here is on free plans. Allow about 30–45 minutes.
You'll need a laptop, and the two Google email addresses (yours and your daughter's).

## 1. Cloudflare account and resources

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. On your laptop, in this repository:

   ```bash
   npm install
   npx wrangler login                       # opens the browser to authorise
   npx wrangler d1 create expense-db        # prints a database_id
   npx wrangler r2 bucket create expense-backups
   ```

   > R2 asks you to add a payment method even on the free tier. If you'd rather not, delete the
   > `r2_buckets` block in `wrangler.jsonc`. Nightly backups are then skipped, but D1's own 7-day
   > point-in-time restore and the CSV/JSON export in Settings still work.

3. Paste the printed `database_id` into `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.
4. Create the tables:

   ```bash
   npm run db:migrate:remote
   ```

5. Deploy once to get the app's address:

   ```bash
   npm run deploy
   ```

   Wrangler prints a URL like `https://expense-app.<your-subdomain>.workers.dev`. That's the app.

## 2. Google sign-in

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "Pocket"), and select it.
2. **APIs & Services → OAuth consent screen**:
   - choose **External**
   - set the app name to "Pocket" and add your email as the support email
   - under **Test users**, add both Google addresses.

   Leaving the app in **Testing** mode is fine: only test users can sign in, which is exactly what we want.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorised redirect URI: `https://expense-app.<your-subdomain>.workers.dev/auth/callback`
4. Copy the **Client ID** into `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID`.
5. Store the secrets (you'll be prompted for each value):

   ```bash
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put ALLOWED_USERS
   ```

   For `ALLOWED_USERS`, enter `daughter@gmail.com:daughter,you@gmail.com:parent`, using your real addresses.
6. Deploy again: `npm run deploy`. Then open the URL and sign in.

## 3. Automatic deploys from GitHub (optional, recommended)

Pushes to `main` will then test and deploy automatically.

1. In Cloudflare: **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** template.
   Also grant **D1: Edit** under account permissions.
2. In GitHub, go to the repository → **Settings → Secrets and variables → Actions**:
   - **Secrets:** `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (shown in the Cloudflare dashboard sidebar)
   - **Variables:** `DEPLOY_ENABLED` = `true`

## 4. First-time setup in the app (flow F1, together, ~30–45 min)

1. **More → Settings**: enter **your full name** and **her full name** as banks show them. This is how the allowance and her transfers to herself are recognised.
2. **More → Accounts → + Add**: Citi Checking, Citi Savings, SFCU Checking, SFCU Card (credit card) and Venmo (payment app).
   You don't need balances here; statements provide them.
3. **More → Set up history** walks through the rest:
   1. **Opening day:** a Citi PDF statement fills this in by itself; for others, enter the date and the balance at opening (usually $0).
   2. **Statements back to opening:** import every monthly statement from opening day to today.
      - Citi: the monthly **PDF** (one file covers checking and savings).
      - SFCU and Venmo: CSV or QFX downloads.
   3. **Her spreadsheet:** in Google Sheets, *File → Download → Microsoft Excel (.xlsx)*, then upload it. Check the column, account and category matches; "OoB" and "PP" are pre-set to *Paid by parent*. Preview, then apply.
   4. **Balances:** enter today's balance for each account from the bank's app. ✓ means everything adds up from opening day.
4. **Review**: clear what's left together. This is when most "Always put X in Y?" rules get created.
5. **More → Paid by parent**: add recurring costs you pay directly (rent, phone…).
6. On her iPhone: open the URL in **Safari → Share → Add to Home Screen**.

Any import or spreadsheet can be undone from **More → Import history**.

## Local development

```bash
cp .dev.vars.example .dev.vars    # DEV_LOGIN=true enables /auth/dev-login locally
npm run dev                       # builds the app, migrates local D1, starts on http://localhost:8787
# then open http://localhost:8787/auth/dev-login?email=<an ALLOWED_USERS email>
```

For hot-reloading front-end work, run `npm run dev` in one terminal and `npm run dev:web`
(Vite on :5173, proxying the API) in another.

| Command | What it does |
|---|---|
| `npm test` | Unit and API integration tests (Vitest) |
| `npm run test:e2e` | End-to-end tests in a phone-sized browser (Playwright) |
| `npm run typecheck` | TypeScript checks for the web app and the Worker |

## Restoring from a backup

- **Within 7 days:** `npx wrangler d1 time-travel restore expense-db --timestamp=<ISO time>`
  rewinds the whole database to that minute.
- **Older:** download a nightly JSON from the `expense-backups` R2 bucket (`daily/` or `monthly/`).
  It contains every table, and can be re-inserted into a fresh database.
