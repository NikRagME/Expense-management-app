# 02 — Product Spec (Phase 1: Visibility)

> **Status:** Approved · **Stage:** 2 of 4 · Builds on [`01-objectives.md`](01-objectives.md)
>
> Items marked **[A#]** are assumptions or decisions. They are tracked together in §11.

## 1. What Phase 1 delivers

One trustworthy view of all her money in and out, across **Citibank, SFCU bank, the SFCU credit
card, Venmo** and **costs paid by her parent**. It answers three questions in under a minute on her phone:

1. **How much did I spend this month (or last month)?**
2. **What did I spend it on?**
3. **What does my life cost overall,** including what Dad/Mom pays?

Phase 1 does **not** include budgets, ratings, need/want tags, receipts or automation. The data model
reserves room for them (§9).

---

## 2. Key concepts

| Term | Meaning |
|---|---|
| **Account** | A place her money lives. It starts with Citibank, SFCU Checking, SFCU Credit Card and Venmo, and **more can be added at any time** (§4.4). There is also one **virtual account**, *Paid by parent*, for costs paid on her behalf. |
| **Balance** | How much is in an account (or, for the credit card, how much is owed), as of a given date (§4.5). |
| **Transaction** | One line of money in or out of an account, from a statement import or manual entry. |
| **Kind** | What a transaction *means*. This is the heart of "one trustworthy view" (see below). |
| **Category** | What the spending was *for*: Groceries, Eating out, and so on. Applies to spending kinds only. A transaction has one category by default, or can be **split** across several (§5.3). |
| **Merchant** | A cleaned-up payee name (`SQ *BLUE BOTTLE 0423 PALO ALTO` → *Blue Bottle*). |
| **Rule** | "Always treat merchant X as category Y / kind Z." Created when she categorises something. |
| **Import** | One uploaded statement file for one account. Can be undone as a whole. |
| **Needs attention** | Transactions the app couldn't confidently classify. They wait for her (or the parent) to confirm. |

### 2.1 Transaction kinds

Every transaction has exactly one kind. Only some kinds count as spending.

| Kind | Example | Counts toward |
|---|---|---|
| **Spend** | Chipotle on the SFCU card; paying a friend on Venmo for concert tickets | Her spending (+) |
| **Refund** | Amazon return credited to the card | Her spending (−), in the same category |
| **Repayment** | A friend pays her back on Venmo for their half of dinner | Her spending (−). Reduces the cost of the shared purchase. |
| **Income** | Allowance via Zelle from the parent | Money in |
| **Transfer** | Citibank → SFCU; paying the SFCU card bill; bank ↔ Venmo top-up or cash-out | **Nothing.** Money moved between her own accounts. |
| **Parent-paid** | Parent pays her phone plan or rent directly | Cost of living only (not her spending) |

**Definitions used everywhere in the app:**

- **Her spending** = Spend − Refunds − Repayments, across her 4 real accounts.
- **Cost of living** = Her spending + Parent-paid.
- **Money in** = Income.

---

## 3. Users and permissions

| | Daughter | Parent |
|---|---|---|
| Sign in with Google | ✓ | ✓ |
| See everything | ✓ | ✓ |
| Import statements, add or edit transactions | ✓ | ✓ |
| Manage accounts, categories and rules | ✓ | ✓ |
| Record parent-paid costs | ✓ (can view) | ✓ (primary) |

- Only the two Google emails on an **allow-list** can sign in. **[A1]**
- Every change records **who** made it and **when**, shown as "Edited by Dad · 2 days ago".
  When both of you can edit, this avoids "who changed my category?" confusion.

---

## 4. Getting transactions in

### 4.1 Statement import (primary)

Weekly routine: log in to each bank or Venmo, download the recent transactions, upload them to the app.

| Account | Expected format **[A2]** | Notes |
|---|---|---|
| Citibank | CSV (Citi's online banking download) | |
| SFCU Checking | OFX/QFX preferred, CSV fallback | OFX includes unique transaction IDs, which makes duplicate detection exact |
| SFCU Credit Card | OFX/QFX preferred, CSV fallback | |
| Venmo | CSV (Venmo web → Statements) | Includes who, the note ("🍕 pizza"), and which account funded the payment |

**Import flow:**

1. Pick the account, or let the app guess from the file contents.
2. **First time per account only:** confirm the column mapping (date, description, amount or
   debit/credit, sign convention). The mapping is saved, so later imports are one tap.
3. **Preview:**
   - *N new* transactions
   - *M duplicates* skipped (already imported)
   - *K transfers* matched
   - *J need attention*
4. Confirm. The app shows a short summary: "38 new · 4 transfers matched · 3 need a look 👀".
5. Any import can be **undone** in one step, which removes everything it added.

**Duplicate detection:**

- **OFX:** the bank's own transaction ID.
- **CSV:** the same account + date + amount + description is treated as a duplicate.
- Overlapping date ranges between imports are expected and handled. She doesn't need to track
  exactly which dates she downloaded.

### 4.2 Manual entry (secondary)

For the occasional cash spend, or logging a purchase right away. Fields: amount, merchant/description,
category, account (defaults to the last used), date (defaults to today), note.

When a later statement import contains a line that looks like a manual entry (same account, same amount,
date within ±3 days), the app **suggests merging** them so the purchase isn't counted twice. **[A3]**

### 4.3 Parent-paid costs

The parent records costs paid on her behalf, in the virtual *Paid by parent* account:

- **One-off:** for example a textbook order.
- **Recurring:** for example "Phone plan, $45, monthly on the 15th". The app adds each month's entry
  automatically, and it can be edited or skipped. **[A4]**

### 4.4 Adding accounts later

The four starting accounts are just the initial setup. **Either user can add accounts at any time,
for any number of accounts**, e.g. a new savings account, a second credit card, Cash App or PayPal,
or a cash wallet.

- **Account types:** Checking · Savings · Credit card · Payment app (Venmo-like) · Cash · Other.
  The type decides default behaviour: a credit card's balance is shown as *owed*, and a payment
  app gets Venmo-style repayment handling.
- **A new account works exactly like the starting ones:** its own import mapping (set on the first
  import), transfer matching with every other account, and its own balance.
- **Archive, not delete:** a closed account is archived. Its history stays in all past totals, and
  it disappears from pickers and the Home balances.
- Nothing in the app is hard-coded to the four starting accounts or to specific banks.

### 4.5 Account balances

Every real account shows a **current balance**, with an **"as of" date** so it's clear how fresh it is.

**How a balance is known:**
1. **From the statement:** OFX/QFX files contain the bank's own balance, and many CSVs have a
   running-balance column. When present, the import records it automatically.
2. **Entered by hand:** "My SFCU Checking balance today is $412.30". This takes a few seconds from the
   bank's app and is needed at least once per account to set a starting point.
3. **Between known balances,** the app rolls forward: latest known balance + transactions imported after it.

**Balance check (reconciliation):**
- When a new known balance arrives (from a statement or typed in), the app compares it with its own
  calculation.
- **If they match:** ✓ "Balanced". This is a strong signal the data is complete.
- **If they differ:** "Off by $23.10 — something may be missing or duplicated since Oct 2" with a link to that
  period's transactions. The bank's figure always wins for the displayed balance. The difference
  is flagged, never silently absorbed.

**Display rules:**
- Checking, savings, Venmo and cash show money available.
- The credit card shows the **amount owed**, labelled as such (never as negative money).
- Home shows a **"Net position"** line: cash across her accounts − card owed.
- *Paid by parent* has no balance.
- Phase 4 adds the credit limit, utilisation, statement amount and due date on top of this.

---

## 5. Classification rules

These rules make the single view trustworthy. When a rule isn't confident, the transaction goes to
**Needs attention** instead of being guessed silently.

| Situation | How it's recognised | Result |
|---|---|---|
| **Allowance** | Incoming Zelle whose description contains the parent's name (configured once) | Income · "Allowance" |
| **Card bill payment** | SFCU card credit "PAYMENT" + matching debit from Citibank or SFCU checking (same amount, ±5 days) | Both sides → Transfer, linked as a pair |
| **Between her bank accounts** | Debit in one bank + credit of the same amount in the other within ±5 days, or a description containing "TRANSFER" | Transfer pair |
| **Venmo paid from a bank** | Bank line "VENMO" + Venmo row whose funding source is that bank, same amount | Bank line → Transfer. The **Venmo row is the Spend** (it has the who and the what). |
| **Venmo top-up / cash-out** | Venmo "Standard Transfer" + matching bank line | Transfer pair |
| **Friend pays her on Venmo** | Incoming Venmo payment from anyone other than the parent | **Needs attention**: "Is this a repayment for something you paid for, or something else?" Optionally link it to the original spend. **[A5 — open]** |
| **Card refund** | Credit on the card that isn't a payment | Refund, in the original merchant's category |
| **Unmatched transfer-looking line** | A transfer description with no matching other side yet | Transfer (unconfirmed). It pairs up automatically once the other account is imported. |

### 5.1 Categorisation

1. Clean the merchant name (strip card-processor prefixes such as `SQ *`, `TST*` and `PAYPAL *`, plus
   store numbers and city).
2. If a **rule** exists for that merchant, apply it.
3. Otherwise, apply **built-in keyword hints** (e.g. *Uber/Lyft* → Transport, *Safeway/Trader Joe's* →
   Groceries).
4. Otherwise, mark it **uncategorised** and send it to *Needs attention*.

When she categorises a transaction from a new merchant, the app offers:
"Always put **Blue Bottle** in **Coffee & snacks**?" → `Yes` / `Just this once`.

Rules can be viewed, edited and deleted in Settings.

### 5.3 Splits

Some purchases cover several categories, such as a Target run of groceries plus clothing.

- **The default is one category.** Splitting is optional, behind a **Split** button on the transaction.
- A split divides the transaction into **2 or more parts**, each with its own amount, category and
  optional note.
  - The parts must add up exactly to the transaction amount. The last part auto-fills with the remainder.
  - Rules only ever set a single category. Splits are always done by hand.
- **Reports** (Home, category totals, filters) count each part under its own category. The bank
  line itself still appears **once** in Activity, marked "Split · 2 categories".
- **Un-split** returns the transaction to a single category.
- Refunds and repayments can be split the same way.

### 5.2 Default categories **[A6]**

| Group | Categories |
|---|---|
| Food | Groceries · Eating out · Coffee & snacks · Food delivery |
| Getting around | Rideshare · Public transit · Gas & parking · Flights & travel |
| Home | Rent & housing · Utilities · Phone & internet · Household supplies |
| School | Tuition & fees · Books & supplies · Tech |
| Life | Clothing · Personal care · Health & medical · Fitness |
| Fun | Going out · Entertainment · Subscriptions · Hobbies · Gifts |
| Other | Fees & interest · Miscellaneous |

She can rename, add, hide or recolour any category. Groups are used for the overview roll-up.

---

## 6. Screens

The app is designed mobile-first for her iPhone, with a bottom tab bar. On a laptop the same screens
use a wider layout with a sidebar.

```
┌───────────────────────────────────────┐
│  Home  │  Activity  │  ＋  │  Review(3) │  More  │
└───────────────────────────────────────┘
```

### S1 · Sign in
A friendly welcome and a "Continue with Google" button. Anyone not on the allow-list sees
"This app is private" and cannot get in.

### S2 · Home (Overview)
The one-minute answer to her three questions.

```
┌─────────────────────────────┐
│  ‹  October 2026  ›         │
│                             │
│  You spent                  │
│  $842                       │
│  ▲ $96 vs September         │
│                             │
│  Cost of living   $2,310    │
│  (you $842 + parent $1,468) │
│  Money in         $900      │
│                             │
│  👀 3 things need a look  › │
│                             │
│  WHERE IT WENT              │
│  Food          ████▌  $310  │
│  Fun           ██▌    $180  │
│  Getting around █▌    $122  │
│  Life          █      $95   │
│  … see all                › │
│                             │
│  BY ACCOUNT    spent  balance│
│  SFCU Card     $520  $310 owed│
│  Venmo         $190     $24 │
│  Citi           $92    $618 │
│  SFCU Chk       $40    $412 │
│  Net position          $744 │
│                             │
│  Last updated: Citi 2d ago, │
│  Venmo 9d ago ⚠             │
└─────────────────────────────┘
```

- **Period switcher.** Defaults to calendar months, but the period definition is **left open [A7]**,
  and the app must not hard-code it. Every total is computed for an arbitrary *from–to* date range,
  so we can later switch to allowance-to-allowance months, weeks or custom ranges without rework.
  A **custom range** option is available from day one.
- **Cost of living** toggle: show her spending alone, or including parent-paid costs.
- **Category bars:**
  - groups first; tap a group to see its categories
  - tap a category to see its transactions (S3, pre-filtered).
- **By account:** each account's spending for the period, plus its current balance
  (✓ when the last balance check matched). Tap an account for its transactions.
- **Freshness line:** shows when each account was last imported, and flags any account not updated in
  more than 7 days. This is what makes the totals trustworthy.
- **Playful touch** (light, for Phase 1): friendly copy, plus an "All caught up 🎉" state when nothing needs attention.

### S3 · Activity (all transactions)

```
┌─────────────────────────────┐
│ 🔍 Search          [Filter] │
│ Oct 2026 · All accounts     │
│                             │
│ TODAY                       │
│ ☕ Blue Bottle      -$6.50  │
│    Coffee · SFCU Card       │
│ 🍕 Maya (Venmo)    -$18.00  │
│    "pizza night" · Eating out│
│ YESTERDAY                   │
│ ↔ SFCU card payment  $400   │
│    Transfer · not counted   │
│ 💵 Allowance       +$300    │
│    Income · Citibank        │
│ 🏠 Rent (parent)   $1,200   │
│    Paid by parent           │
└─────────────────────────────┘
```

- One combined list across all accounts, newest first, grouped by day.
- **Filters:** month or date range, account, category, kind, needs attention, "paid by parent".
- **Search:** merchant, description, Venmo note.
- Transfers are shown greyed out and labelled "not counted", so she understands why they don't add up.
- The list shows a running total for the current filter, e.g. "Eating out in Oct: $142".

### S4 · Transaction detail / edit

- Amount, date, account, original bank description (read-only), cleaned merchant name.
- **Kind** (Spend / Refund / Repayment / Income / Transfer), **Category** and **Note**.
- **Split** button: divides the transaction into parts, each with an amount and a category (§5.3).
  The remaining amount is shown live ("$12.40 left to assign").
- **Linked items:** a transfer's other side; a repayment's original spend (e.g. "Maya paid back $18 of
  your $36 dinner → your share was $18").
- "Create rule for this merchant" prompt.
- History: "Imported from SFCU Card · Oct 12 · Category changed by Dad, Oct 14".
- Delete (manual entries only); "Exclude" for imported lines that should be ignored.

### S5 · Quick add (＋)
A big amount pad, then merchant, then category chips (her most-used first), then account and date
(both defaulted). Save takes **3 taps plus typing**. Parents also see a "Paid by parent" toggle.
A small **Split** link sits under the category chips for the rare case it's needed.

### S6 · Import

```
┌─────────────────────────────┐
│ Import a statement          │
│                             │
│ [ Choose file ]             │
│                             │
│ Detected: SFCU Credit Card  │
│ Oct 1 – Oct 18              │
│                             │
│ ✓ 38 new                    │
│ ⤼ 12 duplicates (skipped)   │
│ ↔ 4 transfers matched       │
│ 👀 3 need a look            │
│                             │
│ [ Import 38 transactions ]  │
└─────────────────────────────┘
```

- **First time per account:** a column-mapping step with a live preview of the first 5 rows.
- Includes "How to download this statement" help for each bank (Citi, SFCU, Venmo), with steps and
  screenshots added once we've done it once with real files.
- **Import history:** a list of past imports with date, account and row count, plus **Undo**.

### S7 · Review (Needs attention)
A focused queue, one card at a time. This keeps the weekly tidy-up fast.

```
┌─────────────────────────────┐
│ 3 to review                 │
│                             │
│ 💸 +$18.00 from Maya (Venmo)│
│ "pizza 🍕"  · Oct 14        │
│                             │
│ What is this?               │
│ [ Paying me back ]          │
│ [ Income / gift ]           │
│ [ Something else ]          │
│                             │
│ Link to: 🍕 Pizza -$36 Oct 13│
│                             │
│          Skip ›             │
└─────────────────────────────┘
```

**Card types:**
- uncategorised spend (category chips + "always?")
- incoming Venmo (§5)
- possible duplicate or merge
- unmatched transfer older than 7 days

When the queue is empty: "All caught up 🎉".

### S8 · Accounts
- All real accounts plus *Paid by parent*.
- Each one shows the institution, type, **current balance (as of date, ✓ if balanced)**, last
  import date and "transactions through" date.
- **"Update balance"** button: type the balance shown in the bank's app, and the app runs the
  balance check (§4.5). **[A8]**
- **Add account** at any time (§4.4): name, institution, type and an optional starting balance.
- **Edit / archive** accounts, and view or reset each account's saved import mapping.

### S9 · Paid by parent (parent-focused)
- A list of parent-paid costs by month.
- **Recurring items:** name, amount, category, frequency and next date. Each can be paused or edited.
- Monthly total, which feeds the Home "Cost of living" figure.

### S10 · More / Settings
- Categories (S10a), Rules (S10b), Accounts (S8), Paid by parent (S9).
- Allowed users (the two Google emails) and the parent's Zelle name for allowance detection.
- **Export:** all data as CSV, so the data is never locked in.
- "Install on iPhone" help (Safari → Share → Add to Home Screen).

---

## 7. Key user flows

### F1 · First-time setup (parent + daughter, together, ~20 min)
1. Parent signs in and adds the daughter's Google email to the allow-list.
2. Create the 4 starting accounts with today's balance for each, and set the parent's Zelle name.
3. Import one statement per account (the column mapping is confirmed once).
4. Review the first batch together. This is the moment most rules get created.
5. Parent adds recurring parent-paid costs (rent, phone, etc.).
6. Daughter installs the app on her iPhone home screen.

### F2 · Weekly update (daughter, target < 10 min)
1. Download recent transactions from Citi, SFCU (checking and card) and Venmo.
2. Import each file. Transfers auto-match and rules auto-categorise.
3. Clear the Review queue.
4. Glance at Home → balances show ✓ and "All caught up 🎉".

*(Phase 2 turns step 4 into the weekly reflection ritual.)*

### F3 · Shared dinner on Venmo
1. She pays $36 on her SFCU card → **Spend**, Eating out.
2. Maya pays her $18 on Venmo → the Review card asks what it is → "Paying me back", linked to the dinner.
3. Home shows Eating out **+$18** (her real share).
4. She later cashes out Venmo to SFCU → **Transfer**, not counted.

### F4 · Parent adds a cost
Parent → ＋ → toggles "Paid by parent" → "Textbook $89, Books & supplies" → it appears in her
Cost of living, tagged "Paid by Dad".

---

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| **Devices** | iPhone Safari as an installed PWA (primary); any modern desktop browser (parent) |
| **Speed** | Home loads in < 2 s on a phone; an import of ~200 rows is processed in < 5 s |
| **Offline** | Not required for Phase 1. Quick add *may* queue offline as a stretch goal. **[A9]** |
| **Privacy** | Private by default. Only the 2 allow-listed users can sign in. All traffic over HTTPS; data encrypted at rest by the hosting provider. **No bank passwords are ever entered into or stored in the app.** |
| **Backups** | Automatic daily backups, plus CSV export at any time |
| **Accessibility** | Readable text sizes, sufficient contrast, colour never the only signal (bars are labelled with amounts) |
| **Tone** | Playful and encouraging; never shaming. Spending increases are shown neutrally (▲ arrow, not red alarms). |
| **Cost** | Within the near-free target (< $5/mo) |

---

## 9. Reserved for later phases (data model leaves room)

Phase 1 does not build these, but the data model includes the fields so later phases need no rework:

- **Phase 2:**
  - on each transaction: `rating` (worth it / neutral / regret), `need_or_want`, and `budget_scope`
    (in / outside / not sure yet)
  - rules can also set `budget_scope`, which is how the agreed grey-area rules will apply
    automatically
  - budgets per category per month.
- **Phase 3:**
  - `source` on each transaction (import / manual / email / sms / receipt / bank-sync)
  - receipt attachments
  - email and SMS alert ingestion.
- **Phase 4:**
  - credit limit, utilisation, statement amount and due dates (built on Phase 1 balances)
  - savings goals
  - streaks and badges.

---

## 10. Out of scope for Phase 1

Budgets, ratings, need/want tags, weekly reflection, insights, notifications or reminders, receipts,
email or SMS capture, bank sync, credit health (limit, utilisation, due dates), goals, gamification beyond friendly copy,
multiple currencies.

---

## 11. Assumptions and decisions

| # | Topic | Status | Decision |
|---|---|---|---|
| **A1** | Who can sign in | Accepted | Exactly two Google accounts on an allow-list |
| **A2** | Statement formats | **Deferred** | Sample files from Citi, SFCU checking, the SFCU card and Venmo will be collected later. The importer is built with a configurable column mapping, so it doesn't depend on knowing the formats up front; it will be tuned once real files arrive. |
| **A3** | Manual entry vs import | **Confirmed** | Suggest a merge when the same account and amount appear within ±3 days |
| **A4** | Recurring parent-paid costs | **Confirmed** | Added automatically each period; each one can be edited or skipped |
| **A5** | Incoming Venmo from friends | **Open** | Not decided yet. Interim behaviour: always ask in the Review queue (the safe option, since nothing is guessed). Built as a **setting**, so it can switch to "default to Repayment" once we see real usage. |
| **A6** | Default categories | **Confirmed** | The list in §5.2 |
| **A7** | What a "month" is | **Open** | Calendar month by default; all totals work on arbitrary date ranges so the definition can change later (§6, S2) |
| **A8** | Account balances | **Decided: in Phase 1** | Balances per account, from statements or typed in, with a balance check (§4.5) |
| **A9** | Offline | **Confirmed** | Not required in Phase 1 |
| **A10** | Splitting a purchase | **Decided: in Phase 1** | One category by default, with a **Split** button to divide it across categories (§5.3) |
| **A11** | Adding accounts | **Decided** | Any number of accounts of any type can be added later; nothing is hard-coded to the starting four (§4.4) |

"Accepted" means no change was requested to the proposed default. Any decision can still be revisited.

---

## 12. History setup: bringing accounts up to date from opening day

> **Status:** Built · added after Phase 1. §12.8 records what we learned from her real Citi statement and tracking sheet.
> Changes the earlier "start tracking from this month" decision: Pocket now holds the **full history** of each account.

### 12.1 Situation

- Her accounts are **all under a year old**, so each bank still lets her download statements back to the day the account was opened.
- She has been tracking **everything** in an Excel spreadsheet: purchases, allowance, transfers, card payments and Venmo. It holds her categories and notes.
- The spreadsheet layout isn't known yet (one sheet with an account column, one tab per account, or no account column). Setup handles all three.

### 12.2 Approach: statements are the truth, the spreadsheet adds her knowledge

| Source | What it contributes |
|---|---|
| **Bank statements from opening day** | Exact amounts, dates and balances. Duplicates and transfers are handled exactly as in regular imports (§4–5). |
| **Her spreadsheet** | Her **categories, notes and descriptions**, copied onto the matching bank lines. Rows with no bank line (e.g. cash) are added on their own. |

The spreadsheet is never the source of amounts for anything the bank also recorded, so a typo in the spreadsheet can't make a balance wrong.

### 12.3 The setup flow (More → Set up history)

A guided, four-step checklist. Each step shows its status (✓ done / in progress / not started), and the steps can be revisited.

**Step 1 · Accounts and opening day**
- For each account: **opening date** and **opening balance** (default $0; the card defaults to $0 owed).
- This becomes the account's first known balance, recorded at the end of the day before opening, so every later balance rolls forward from it.

**Step 2 · Bank statements back to opening**
- One row per account showing coverage, e.g. "Statements cover Mar 3 – Oct 15", with gaps flagged.
- Uses the existing import screen (§4.1). Several files per account are fine; overlaps are skipped.
- Done when each account is covered from its opening date to roughly today.

**Step 3 · Bring in the spreadsheet**
1. Upload the **Excel file (.xlsx)** directly, or a CSV export.
2. **Pick the sheet(s).** If there's one tab per account, each tab is assigned to an account.
3. **Match the columns** (with a live preview):

   | Column | Required? |
   |---|---|
   | Date | Yes |
   | Amount, or separate money-out / money-in columns | Yes |
   | Description | Yes |
   | Category | Optional |
   | Account | Optional |
   | Note | Optional |
   | Type (e.g. "transfer", "income") | Optional |

   Plus a sign setting: are expenses shown as positive or negative?
4. **Match her categories to Pocket's.** Each distinct spreadsheet category (e.g. "Food – eating out") is mapped to a Pocket category, or creates a new one. Obvious names are pre-filled. The mapping is saved.
5. **Preview** before anything changes:
   - matched to a bank line
   - will be added (no bank line)
   - couldn't be matched
   - categories applied.
6. **Apply.** One step to undo, as with imports.

**Step 4 · Check the balances**
- Enter today's balance for each account from the bank's app. Pocket runs the balance check (§4.5) over the whole history: ✓ means everything from opening day to today adds up.

### 12.4 Matching rules (spreadsheet row ↔ bank line)

| Rule | Detail |
|---|---|
| **Amount** | Same amount, after applying the sign setting. |
| **Account** | Same account when the row says which one; otherwise, any account. |
| **Date** | Within **±4 days**. Card purchases often post a few days after she wrote them down. |
| **Ties** | Broken by closest date, then by how similar the descriptions are. A row is only matched when one candidate is clearly best; otherwise it goes to Review. |
| **One-to-one** | Each bank line takes at most one spreadsheet row. |

**When matched**, the bank line keeps its amount, date and account, and takes from the spreadsheet:
- her **category**: overwritten only if the line was uncategorised or categorised by a built-in hint, never one she or you set in Pocket
- her **note**
- her **description**, as the display name (the bank's original text stays visible)
- her **type**, if given. E.g. "transfer" or "income" resolves a "money in: what is it?" card.

**Not matched:**

| Case | What happens |
|---|---|
| Row for a cash account, or for a date no statement covers | **Added** as its own transaction, marked "from spreadsheet". |
| Row that should have a bank line but none was found | Goes to **Review** as "In your spreadsheet but not on the statement", with options to add it anyway, pick the bank line by hand, or skip. |
| Bank line with no spreadsheet row | Classified as usual (rules, hints, Review). |

**Learning rules:** after applying, Pocket offers to **create rules from the spreadsheet**, e.g. "34 shops she always categorised the same way" (excluding Venmo friends), so future imports sort themselves.

### 12.5 Screens

| ID | Screen |
|---|---|
| **S11** | **Set up history**: the four-step checklist with per-account coverage and balance status. Reachable from More, and offered on Home while setup is incomplete. |
| **S12** | **Spreadsheet import**: sheet picker → column mapping → category mapping → preview → apply. |
| **S7 (extended)** | New Review card: "In your spreadsheet but not on the statement". |

### 12.6 Data model additions

- `accounts.opened_on`, plus an opening-balance snapshot.
- `imports.format` gains `'spreadsheet'`.
- New table `history_matches (import_id, transaction_id, before_json)`. It records what each matched bank line looked like before the spreadsheet changed it, so **undo restores it exactly**.
- New table `category_mappings (source_name, category_id)` holds the saved category mapping.
- Transactions added from the spreadsheet have `source = 'import'` with the spreadsheet import's id, so they undo with it.

### 12.7 Assumptions

| # | Assumption | Alternative |
|---|---|---|
| **H1** | Statements are imported **before** the spreadsheet; setup leads in that order. | If the spreadsheet comes first, its rows are held as "waiting for a statement" and matched when statements arrive. |
| **H2** | Opening balance defaults to $0. | Ask for the first deposit amount instead. |
| **H3** | Date window ±4 days. | Tighter or looser once we see her real data. |
| **H4** | Her categories never overwrite a category already chosen in Pocket. | The spreadsheet always wins. |
| **H5** | Excel `.xlsx` is read directly; older `.xls` files need to be re-saved as `.xlsx` or CSV. | |
| **H6** | A sample of her spreadsheet (amounts can be blurred) will tune the column guessing, like the bank statement samples. | |

### 12.8 What her real files showed, and the decisions taken

These come from a real Citi statement (Sep 9 – Oct 1) and a PDF of her Google Sheet. Neither file is stored in the repository; tests use made-up copies with the same layout.

| Finding | Decision |
|---|---|
| Citi sends **PDF statements** covering **Checking and Savings together**, with the bank's opening ($0.00) and closing balances | Pocket reads Citi PDFs directly; one PDF fills both accounts and checks both balances. CSV/OFX downloads still work, and a period imported both ways isn't double counted. The SFCU PDF format will be added when a sample arrives. |
| She has a **Citi Savings** account | It's a fifth account (added like any other). |
| Her sheet has two tabs: **Budget Tracker** (date, amount, description, category, account) and a **Citi money-in/money-out ledger** (no account column; "PAYMENT IN/OUT" instead of a category) | The importer finds each tab's table, treats "PAYMENT IN/OUT" as the direction, and lets you set the account for a tab that has none. |
| **OoB** = "out of budget, I (parent) will pay"; **PP** = "Pop pays" | Both map to *Paid by parent*: the purchase stays on her account but counts in her cost of living, not her own spending, and is tagged *outside budget*. A card payment marked PP counts as money from the parent. Pocket still suggests a real category (Rideshare, Phone…). |
| A **$35,000 deposit** went straight to **Stanford tuition** ($34,805) | Tuition is *Paid by parent* (cost of living, not her spending). The deposit is answered in Review as "From parent, to cover a cost", so it isn't counted as her income. |
| **Zelle to herself** (her own name, cut short) moves money to her own SFCU account | Settings → *Her full name*; Zelle to/from her own name is a transfer. |
| **Bank names are cut short** (first name + part of the surname), and a friend shares the parent's first name | Settings asks for the parent's **full name**; a truncated bank name matches it, while a different person with the same first name doesn't. Friends' Zelle payments ask "what is it?", like Venmo. |
| Her amounts are sometimes **rounded** (Walmart $50.00 vs $50.24; iCloud $1.00 vs $0.99) | A near amount (within $1 or 3%) matches when the descriptions agree; the bank's amount is kept and the difference is shown. |
| Some rows are **bookkeeping, not transactions** ("Initial Budget $500", entries "technically September") and one expense is on **both tabs** | These go to Review: pick the bank line by hand (searched ±1 month), add it, or skip it. A row repeated on another tab is flagged as a likely duplicate. |
| Merchant text includes store codes and cities ("D0964 TRADER JOE S #20 … CAUS07154") | Cleaned up to "Trader Joe's"; Citi's own category lines (e.g. "Restaurant/Bar") are used as hints. |

**Updated assumptions:** H1 (statements first) and H3 (±4 days) unchanged; H4 (Pocket choices never overwritten) is enforced. A person's edits are remembered on each transaction for this. H5 also covers Google Sheets: *File → Download → Microsoft Excel (.xlsx)*.
