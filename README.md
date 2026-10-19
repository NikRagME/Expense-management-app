# Pocket: money, made visible

A private money app for a student managing her finances for the first time. It brings
**Citibank, SFCU checking, the SFCU credit card, Venmo** and **costs paid by her parent** into one
trustworthy view, answering three questions in under a minute on her phone:

1. How much did I spend this month?
2. What did I spend it on?
3. What does my life cost overall?

## Documents

| Stage | Document |
|---|---|
| 1. Objectives | [docs/01-objectives.md](docs/01-objectives.md) |
| 2. Product spec (Phase 1) | [docs/02-spec.md](docs/02-spec.md) |
| 3. Architecture | [docs/03-architecture.md](docs/03-architecture.md) |
| Setup & deployment | [docs/SETUP.md](docs/SETUP.md) |

## What's built (Phase 1: Visibility)

- **Google sign-in** for exactly two allow-listed people. Both have full access, and every edit records who made it.
- **Accounts:** add any number of accounts of any type at any time, archive old ones, and see a balance for each.
- **Balance check:** compares the bank's own figure with the app's ("Balanced ✓" or "Off by $23.10").
- **History from opening day:** a guided setup brings every account up to date.
  - Citi **PDF** statements (checking + savings in one file, with the bank's opening and closing balances).
  - Her tracking **spreadsheet** (.xlsx or CSV): rows are matched to bank lines and her categories, notes and descriptions copied across; rows with no bank line are added or sent to Review; "OoB"/"PP" become *Paid by parent*; exact undo.
- **Statement import:**
  - PDF (Citi), CSV (column mapping saved per account), OFX/QFX and Venmo CSV
  - files are parsed in the browser
  - a preview shows exactly what will be imported
  - duplicate detection, and one-tap undo.
- **Smart classification:**
  - merchant-name cleanup, and "Always put X in Y?" rules
  - built-in category hints
  - Zelle allowance → income
  - card payments, bank ↔ bank and bank ↔ Venmo transfers are paired automatically and never counted as spending.
- **Venmo shared costs:** a friend's repayment is linked to the original purchase, so only her share counts.
- **Review queue:** one card at a time for anything the app wasn't sure about.
- **Quick add**, with a suggested merge when the bank line arrives later.
- **Splits:** one category by default; a ✂️ Split button divides a purchase across categories.
- **Paid by parent:** one-off and recurring costs that appear in her *cost of living* but not her spending.
- **Home:**
  - spending vs the previous period
  - cost of living and money in
  - where it went, by group and category
  - spending and balance per account, and net position
  - how recently each account was updated.
- **Export** (CSV and full JSON). A nightly backup is saved to R2.
- Installs on the iPhone home screen as a PWA, and supports light and dark mode.

## Stack

React + TypeScript PWA (Vite, Tailwind) · Cloudflare Workers (Hono) · D1 (SQLite) · R2 backups.
It runs on free tiers. All money logic lives in [`shared/`](shared) as pure, unit-tested functions.

```
web/         React PWA (screens, components, API client)
worker/      Cloudflare Worker: auth, API routes, import pipeline, nightly job
shared/      Money core: parsers, classification, matching, balances, reports
migrations/  D1 schema
tests/       End-to-end tests and statement fixtures
```

## Develop

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev          # http://localhost:8787, then /auth/dev-login?email=<allowed email>
npm test             # unit + API integration tests
npm run test:e2e     # end-to-end in an iPhone-sized browser
```

See [docs/SETUP.md](docs/SETUP.md) to deploy.
