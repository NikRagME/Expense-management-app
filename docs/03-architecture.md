# 03 — Architecture

> **Status:** Draft for review · **Stage:** 3 of 4 · Implements [`02-spec.md`](02-spec.md) (Phase 1)
>
> Decisions marked **[D#]** are summarised in §14 for confirmation.

## 1. Summary

| Layer | Choice |
|---|---|
| App | **React + TypeScript** single-page app, installable on iPhone as a **PWA** |
| API | **TypeScript on Cloudflare Workers** (Hono framework) |
| Database | **Cloudflare D1** (managed SQLite) with versioned SQL migrations |
| Sign-in | **Google OAuth**, checked against a two-email allow-list; app-issued session cookie |
| Backups | D1 point-in-time restore + **nightly export to Cloudflare R2** |
| Hosting | One Cloudflare Worker serves both the app and the API |
| CI/CD | GitHub Actions: test on every push, deploy `main` to production |
| Running cost | **$0/month** on free tiers (optional ~$10/year custom domain) |

**Why this shape:**
- It is near-free, as the objectives require.
- It has no servers to patch.
- One language (TypeScript) is used end to end.
- Everything deploys from this GitHub repo.
- Cloudflare's email and cron features fit the later automation phases (§12).

---

## 2. Options considered **[D1]**

| Option | Cost | Pros | Cons | Verdict |
|---|---|---|---|---|
| **Cloudflare Workers + D1** | $0 | Generous free tier that doesn't sleep; SQL database; point-in-time restore; cron jobs; email ingestion for Phase 3 | Smaller ecosystem than Vercel/Supabase; D1 is SQLite (fine at this scale) | **Recommended** |
| Vercel + Supabase (Postgres) | $0 → $25/mo | Very popular; built-in Google auth; Postgres | The free Supabase project **pauses after ~1 week of inactivity**, and **no automatic backups on the free tier**. Both are risky for weekly-use financial data. | Runner-up |
| Firebase (Firestore) | $0 | Built-in Google auth; easy hosting | A document database is a poor fit for relational, sum-heavy reporting (splits, transfers, balances); backups need the paid plan | Not chosen |
| Small VPS / home server | $4–6/mo | Full control | Has to be patched, secured and backed up by hand | Not chosen |

Free-tier limits are generous for two users. Our expected usage is a few hundred requests and a few
thousand rows a week, against limits measured in **100k requests/day** and **GBs** of storage.
These limits will be re-verified at build time.

---

## 3. System overview

```
 iPhone PWA / laptop browser
          │  HTTPS (session cookie)
          ▼
┌──────────────────────────────── Cloudflare ────────────────────────────────┐
│  Worker  "expense-app"                                                     │
│   ├─ Static assets   → React PWA (HTML/JS/CSS, manifest, service worker)   │
│   ├─ /auth/*         → Google OAuth login/callback/logout                  │
│   ├─ /api/*          → Hono REST API (session + allow-list enforced)       │
│   └─ Cron (nightly)  → backup export · recurring parent-paid entries       │
│            │                                   │                           │
│            ▼                                   ▼                           │
│      D1 database (SQLite)              R2 bucket (backups)                 │
└────────────────────────────────────────────────────────────────────────────┘
          ▲
          │ OAuth
     Google accounts (daughter, parent)
```

- **No bank credentials, ever.** Data enters only through files the users upload and what they type.
- **Statement files are parsed in the browser.** Only the extracted rows are sent to the API.
  The original files are not stored; only a fingerprint (hash) is kept to detect re-uploads. **[D5]**

---

## 4. Repository layout

```
/web              React PWA (Vite)
  src/screens/    one folder per screen in the spec (Home, Activity, Review, …)
  src/components/ shared UI (amount pad, category chips, split editor, …)
  src/api/        typed API client + TanStack Query hooks
/worker           Cloudflare Worker
  src/routes/     auth, accounts, transactions, imports, review, reports, …
  src/db/         Drizzle schema + query helpers
  src/jobs/       nightly cron (backup, recurring)
/shared           pure TypeScript domain logic, used by both web and worker
  money.ts        integer-cents helpers & formatting
  parsers/        CSV (with column mapping), OFX/QFX, Venmo CSV
  merchant.ts     description → clean merchant name
  classify.ts     kind/category rules engine
  matching.ts     transfer pairing, duplicate & manual-merge detection
  balance.ts      roll-forward & balance check
  periods.ts      date-range logic (calendar month now; open for A7)
/migrations       numbered SQL migrations
/tests/e2e        Playwright end-to-end tests (iPhone viewport)
/docs             these documents
```

`/shared` holds all the money logic as **pure functions with unit tests**. This is the part that must be
right, so it is kept free of UI and database code.

---

## 5. Front end

| Concern | Choice |
|---|---|
| Framework | React 19 + TypeScript, built with Vite |
| Routing | React Router (screens S1–S10) |
| Server state | TanStack Query (caching, refetch after edits) |
| Styling | Tailwind CSS with design tokens (light + dark mode) |
| Charts | Small hand-built SVG/CSS bars (Phase 1 needs only simple bars). No heavy chart library. |
| CSV parsing | PapaParse |
| PWA | `vite-plugin-pwa`: manifest, icons, iOS splash; service worker caches the **app shell only** (no offline data, per A9) |

**Mobile-first layout:**
- iPhone: bottom tab bar (Home · Activity · ＋ · Review · More).
- Laptop (≥ 900px): the same screens with a left sidebar.

**Design tone:**
- Playful and encouraging copy, friendly emoji category icons, and an "All caught up 🎉" state.
- Spending changes use neutral ▲/▼, never alarm-red.

---

## 6. API

REST + JSON under `/api`. Every route requires a valid session. Inputs are validated with **Zod** schemas
shared with the front end.

| Area | Endpoints |
|---|---|
| Session | `GET /api/me` |
| Accounts | `GET/POST /api/accounts` · `PATCH /api/accounts/:id` (edit/archive) · `POST /api/accounts/:id/balance` (enter balance → runs balance check) |
| Transactions | `GET /api/transactions?from&to&account&category&kind&q&needsAttention` · `POST` (manual) · `PATCH /:id` · `DELETE /:id` (manual only) · `PUT /:id/splits` · `DELETE /:id/splits` (un-split) · `POST /:id/links` (repayment/transfer/merge) |
| Imports | `POST /api/imports/preview` (dry run) · `POST /api/imports` (commit) · `GET /api/imports` · `POST /api/imports/:id/undo` |
| Review | `GET /api/review` (queue) · `POST /api/review/:id/resolve` |
| Categories | `GET/POST /api/categories` · `PATCH /:id` |
| Rules | `GET/POST /api/rules` · `PATCH/DELETE /:id` |
| Parent-paid | `GET/POST /api/recurring` · `PATCH/DELETE /:id` |
| Reports | `GET /api/reports/overview?from&to` (Home: spending, cost of living, money in, by group/category/account, balances, freshness) |
| Settings | `GET/PATCH /api/settings` (allow-list, parent's Zelle name, Venmo-incoming behaviour [A5]) |
| Export | `GET /api/export.zip` (CSV of every table) |

Reports take an arbitrary `from`/`to` range, so the definition of a "month" stays open (A7).

---

## 7. Data model

All money is stored as **integer cents**, never floating point. A transaction's amount is **signed
from the account's point of view**: money out is negative and money in is positive. Credit card
purchases are therefore negative, and a payment to the card is positive.

```
users ───────────┐ (created_by / updated_by on every table)
                 │
accounts ──< transactions ──< transaction_lines >── categories >── category_groups
   │              │   │  ╲
   │              │   │   ╲── transaction_links (transfer pair · repayment→spend · manual↔import merge)
   │              │   └── imports
   │              └── merchants ──< rules
   └──< balance_snapshots
recurring_items ──(generates)──> transactions (Paid by parent)
audit_log · settings · sessions
```

### 7.1 Tables

**users** — `id, email (unique), name, role ('daughter'|'parent'), created_at`

**sessions** — `id (random 256-bit), user_id, expires_at, created_at, last_seen_at`

**accounts**
- `id, name, institution, type ('checking'|'savings'|'credit_card'|'payment_app'|'cash'|'other'|'parent_paid')`
- `import_mapping (JSON, null until first import)`
- `archived_at, created_by, created_at`

**transactions** — one row per real-world money movement
- **Identity and source:**
  - `id, account_id, import_id (null for manual)`
  - `source ('import'|'manual'|'recurring'` + reserved `'email'|'sms'|'receipt'|'bank_sync')`
  - `external_id` (OFX FITID, unique per account when present), `dedupe_key` (account+date+amount+description hash)
- **What happened:**
  - `posted_date, amount_cents (signed), raw_description, merchant_id, description, note`
  - `kind ('spend'|'refund'|'repayment'|'income'|'transfer'|'parent_paid')`
  - `counterparty, payment_note, funding_source` (Venmo detail)
- **Status:**
  - `excluded (bool), needs_attention (reason code or null), recurring_item_id`
- **Reserved, Phase 2:** `rating ('worth_it'|'neutral'|'regret'), need_or_want`
- **Audit:** `created_by, updated_by, created_at, updated_at`

**transaction_lines** — how a transaction's amount is allocated to categories. **Every transaction
has at least one line.** Unsplit = 1 line; split = 2+ lines whose amounts sum exactly to the transaction.
- `id, transaction_id, amount_cents, category_id (null = uncategorised), note`
- Reserved, Phase 2: `budget_scope ('in'|'outside'|'unsure')`

> Keeping category on lines (not on the transaction) means reports are one uniform `SUM` over lines,
> and splits need no special cases anywhere. **[D4]**

**transaction_links** — `id, type ('transfer'|'repayment'|'merge'), from_id, to_id, created_by, created_at`

**imports**
- `id, account_id, file_name, file_hash, format ('csv'|'ofx'|'venmo')`
- `date_from, date_to, rows_total, rows_new, rows_duplicate`
- `created_by, created_at, undone_at`

**balance_snapshots** — known balances, used for roll-forward and the balance check
- `id, account_id, as_of_date, balance_cents, source ('statement'|'manual')`
- `computed_cents (app's figure at that date), difference_cents, import_id, created_by, created_at`

**merchants** — `id, name, match_key (normalised)`

**rules**
- `id, match_type ('merchant'|'contains'|'regex'), pattern, account_id (optional scope)`
- `set_kind, set_category_id, set_merchant_id`
- Reserved: `set_budget_scope`
- `priority, created_by, created_at`

**categories** — `id, group_id, name, emoji, color, hidden, sort_order` · **category_groups** — `id, name, sort_order`

**recurring_items**
- `id, account_id (Paid by parent), name, amount_cents, category_id`
- `frequency ('weekly'|'monthly'|'yearly'), interval, next_date, paused`

**settings** — key/value: `allowed_emails`, `parent_zelle_names`, `venmo_incoming_default ('ask'|'repayment')` [A5], `period_mode ('calendar_month')` [A7]

**audit_log** — `id, user_id, entity, entity_id, action, before_json, after_json, at` (powers "Edited by Dad · 2 days ago")

**Reserved for later phases** (added by migration when needed, no rework): `budgets`, `goals`, `receipts`,
`credit_card_details (limit, statement day, due day)`, `streaks/badges`.

### 7.2 Reporting definitions (single source of truth)

Line amounts are negated so that spending is positive:

- **Her spending** = Σ −line.amount over lines whose transaction kind ∈ {spend, refund, repayment}, on non-parent accounts, not excluded
  *(spend lines are negative → positive spending; refunds and repayments are positive → reduce it)*
- **Parent-paid** = Σ −line.amount where kind = parent_paid
- **Cost of living** = Her spending + Parent-paid
- **Money in** = Σ amount where kind = income
- **Transfers** are always excluded.

These are implemented **once**, in `/shared` and a single SQL view, and used by every screen.

### 7.3 Balances
- **Roll-forward:** balance(account, date) = latest snapshot on or before the date + Σ amounts of the
  account's transactions after the snapshot date, up to that date. Snapshots mean **end of day**.
- **Balance check:** on a new snapshot, store the app's `computed_cents` alongside it.
  - If the difference is 0, the account shows ✓.
  - Otherwise the app flags the gap and links to the transactions since the previous snapshot.
- Credit cards are stored as a negative balance (owed) and *displayed* as "$310 owed".

---

## 8. Import, matching and classification pipeline

```
Browser                                   Worker (one D1 transaction)
───────                                   ─────────────────────────────
file ─► detect format ─► parse ─► rows ─► 1 dedupe  (external_id, else dedupe_key)
        (CSV mapping /              │     2 clean merchant name
         OFX / Venmo)               │     3 classify (rules → built-in hints → needs attention)
                                    │     4 match transfers across ALL accounts
                                    │     5 suggest manual↔import merges
                                    │     6 record statement balance → balance check
                                    ▼
                         preview (dry run) ──► user confirms ──► commit (same steps, persisted)
```

- **Preview and commit run the same code.** Preview rolls back; commit persists. What she sees is exactly what she gets.
- **Undo import** deletes that import's transactions and their links in one database transaction, then
  re-runs matching for any counterparts left unpaired.
- **Transfer matching:** opposite-signed, equal absolute amount, different accounts, dates within ±5 days, both unmatched.
  - Exactly one candidate → auto-link.
  - Several candidates → Review queue.
  - Matching is re-run after every import, so a transfer completes when the second account's file arrives.
- **Venmo:**
  - The Venmo row is the spend, and the bank's "VENMO" line becomes a transfer when matched.
  - Incoming payments from friends follow `venmo_incoming_default`. It is currently `ask` (A5).
- **Allowance:** incoming Zelle whose description matches `parent_zelle_names` → income.
- **Bank-specific quirks** (sign conventions, date formats, header rows) live in small per-format
  presets, tuned when the real sample files arrive (A2). The generic column mapper works without them.

---

## 9. Authentication and security

**Sign-in** **[D3]**:
- **Google OAuth 2.0 authorization-code flow** with full-page redirects (`/auth/login` → Google → `/auth/callback`).
  Redirects are used rather than a pop-up, because pop-ups are unreliable inside an iPhone home-screen app.
- The Worker verifies the Google ID token, and requires `email_verified` and an email on the allow-list.
  Anyone else sees "This app is private".
- The Worker then issues its own session as a cookie: **HttpOnly, Secure, SameSite=Lax**, with a 60-day sliding expiry.
  Sessions are stored in D1, so they can be revoked (Settings → "Sign out everywhere").

**Protection:**
- Every `/api` route checks the session.
- State-changing requests also require a custom header (CSRF defence alongside SameSite).
- Strict Content-Security-Policy; no third-party scripts.
- Secrets (Google client secret, session signing key) are kept in **Worker secrets**, never in the repo.
- Data is encrypted in transit (HTTPS) and at rest (Cloudflare-managed).
- No bank credentials, no card numbers. Statement descriptions may include the last 4 digits only.
- Every change is recorded in `audit_log`.

**Backups and recovery** **[D6]**:
- **D1 Time Travel:** point-in-time restore to any minute within the retention window (7 days on the free plan).
- **Nightly cron:** a full export of every table to **R2** as JSON/CSV, keeping 30 daily and 12 monthly copies.
- **On demand:** a manual CSV export in Settings.
- A restore procedure is documented and **tested once before launch**.

---

## 10. Environments and delivery

| Environment | Purpose | Data |
|---|---|---|
| Local | `wrangler dev` with a local D1 | Seeded fake data |
| Preview | Deployed per pull request (`*.workers.dev`) | Separate D1, fake data |
| Production | The real app | Real data |

**GitHub Actions:**
- On every push: lint, typecheck, unit tests, integration tests, and e2e tests on an iPhone-sized viewport.
- On merge to `main`: apply D1 migrations, then deploy.
- Migrations are forward-only and run before the new code goes live.

**Tests:**
- **Unit (Vitest):** `/shared`, the money core. Parsers, merchant cleaning, classification, transfer matching,
  splits summing exactly, balance roll-forward and reporting definitions.
  Golden-file tests use (redacted) real statement samples once available.
- **Integration:** API routes against a real local D1 (Workers test pool).
- **End-to-end (Playwright):** sign in (stubbed Google), import → review → Home totals, split a
  transaction, enter a balance → ✓.

---

## 11. Cost

| Item | Cost |
|---|---|
| Cloudflare Workers, D1, R2, Cron (free tiers) | $0 |
| Google OAuth | $0 |
| GitHub (repo + Actions) | $0 |
| Custom domain (optional; needed later for Phase 3 email ingestion) | ~$10/year |
| **Total** | **$0/mo**, or about $1/mo with a domain |

---

## 12. How later phases fit

| Phase | Feature | Architecture hook |
|---|---|---|
| 2 | Ratings, need/want, budget scope | Reserved columns; rules gain `set_budget_scope` |
| 2 | Zero-based budget | New `budgets` table; reports already work on date ranges |
| 2 | Weekly review reminder, "rate this?" nudges | **Web Push**, which iOS supports for installed PWAs (iOS 16.4+), sent from a cron Worker |
| 2 | Parent digest, monthly insights | Cron Worker + email. Insights generated by an AI model call (low cost) or by rules. |
| 3 | Bank alert emails | **Cloudflare Email Routing → Email Worker** parses alerts forwarded to e.g. `alerts@yourdomain` (needs a domain) |
| 3 | Bank SMS alerts (iPhone) | An iOS Shortcuts automation posts the alert text to an `/api/ingest` endpoint with a per-device token |
| 3 | Receipt photos | Upload to R2; an AI vision model extracts the amount, merchant and date; matched like a manual entry |
| 3 | Bank sync | A provider such as Plaid writes into the same `transactions` table with `source='bank_sync'` |
| 4 | Credit card health | `credit_card_details` table on top of Phase 1 balances |
| 4 | Goals, streaks, badges | New tables; computed from existing data |

Every new data source feeds the **same pipeline** (dedupe → classify → match), so reconciliation is built once.

---

## 13. Build plan (Phase 1 milestones)

Each milestone ends with something working that you can try on the phone.

| # | Milestone | Delivers | Spec refs |
|---|---|---|---|
| **M0** | Foundations | Repo layout, CI, deploy to `workers.dev`, Google sign-in + allow-list, DB migrations, empty app shell installable on iPhone | S1, §3 |
| **M1** | Accounts and manual transactions | Accounts (add/edit/archive), categories, quick add, Activity list + filters, transaction detail, **splits**, audit history | S3–S5, S8, S10a, §4.2, §4.4, §5.3 |
| **M2** | Statement import | Column mapping, CSV/OFX/Venmo parsers, preview, dedupe, import history + undo | S6, §4.1 |
| **M3** | Smart classification | Merchant cleaning, rules + "always?", transfer and card-payment matching, allowance, Venmo handling, manual↔import merge, **Review queue** | S7, S10b, §5 |
| **M4** | Balances and overview | Balance snapshots, roll-forward, balance check, **Home** (spending, cost of living, money in, by category/account, net position, freshness) | S2, §4.5 |
| **M5** | Parent-paid and launch | Paid by parent (one-off + recurring cron), export, nightly backups + tested restore, polish and playful copy, tuning with real statement files, setup session (flow F1) | S9, S10, §4.3 |

---

## 14. Decisions to confirm

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| **D1** | Hosting platform | Cloudflare Workers + D1 + R2 | Vercel + Supabase |
| **D2** | Language and framework | TypeScript everywhere; React PWA; Hono API | Next.js full-stack |
| **D3** | Sign-in | Own Google OAuth flow + allow-list + session cookie | Cloudflare Access in front of the app (zero auth code, but a clunkier login inside the iPhone app) |
| **D4** | Splits model | Every transaction has 1+ category lines | Category on transaction + separate split table |
| **D5** | Statement files | Parsed in the browser; originals **not stored** (hash only) | Store originals in R2 for audit |
| **D6** | Backups | Time Travel + nightly R2 export + tested restore | Time Travel only |
| **D7** | Domain | Start on the free `*.workers.dev` address; buy a domain when Phase 3 needs email | Buy a domain now (nicer URL) |

### Setup you'll need to do (I'll guide you step by step at M0)
1. Create a free **Cloudflare** account.
2. Create a **Google Cloud** OAuth client (free) for the sign-in button.
3. Add a Cloudflare API token as a GitHub Actions secret, so pushes to `main` deploy automatically.
4. Provide the two Google email addresses for the allow-list.
