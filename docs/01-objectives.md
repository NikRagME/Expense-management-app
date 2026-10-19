# 01 — Objectives

> **Status:** Draft for review · **Stage:** 1 of 4 (Objectives → Spec → Architecture → Build)
> Next stage (`02-spec.md`) starts once this document is approved.

## 1. Vision

A personal money app that helps a student, managing her own finances for the first time,
**see all her spending in one place** and, over time, **build the habit of thinking about
whether her spending is a good use of money**.

This is a **multi-year learning journey**, not a one-off tool. The app should grow with her:
visibility first, then reflection and budgeting, then goals and good credit habits.

## 2. Background and problem

- She has **3 accounts**: 2 bank accounts and 1 credit card, all in the **USA (USD)**.
  She uses each one differently, so her spending is spread across three places.
- She has **never budgeted before**. She doesn't need rules imposed on her yet. She first
  needs a clear, trustworthy picture of where her money goes.
- Her income is an **allowance from her parent**.

## 3. Users and roles

| User | Role | Access |
|---|---|---|
| **Daughter** | Primary user. Records, categorises and reviews her spending. | Full view and edit |
| **Parent** | Supporter and coach. Can log the allowance, adjust budgets and help tidy data. | Full view and edit (agreed: full visibility) |

- Exactly **two people**, each signing in with their **own Google account**. Nobody else can sign in.
- There is no requirement to support other families or users.

## 4. Guiding principles

1. **Visibility before control.** Phase 1 is only about seeing everything clearly and accurately.
2. **Awareness, not restriction.** Budgets are guides, not limits. Overspending is fine and is shown
   neutrally, with no alarming reds and no guilt. The value is in noticing and reflecting.
3. **One trustworthy view.** Money moving between her own accounts (transfers, credit card payments)
   must never be counted as spending twice.
4. **Low effort to keep up.** Keeping the data current should take minutes a week, or it won't stick.
5. **Playful.** Gamification (streaks, badges, light challenges) makes the habit enjoyable.
   It is introduced gradually, once there is a habit to reward.
6. **Near-free to run.** Target under ~$5/month. Prefer free tiers; paid services only when they clearly earn their cost.
7. **Simple to maintain.** Built and maintained by the parent with Claude, on a mainstream, low-maintenance stack.

## 5. Platform

- A **web app that installs on her iPhone home screen (PWA)**. The parent uses the same app from any phone or laptop.
- No App Store app for now.
- **Constraint:** iPhones do not allow apps to read SMS. "SMS scanning" will instead use an
  **iOS Shortcuts automation** that forwards bank alert texts to the app (a later phase).

## 6. Phased roadmap

These phases are a proposal. Only Phase 1 is committed; later phases are recorded so the
architecture leaves room for them, and will be specced when we get there.

### Phase 1 — Visibility *(committed; ASAP)*
Goal: **all three accounts in one accurate, single view of spending, from this month onward.**

- Set up her 3 accounts (2 bank, 1 credit card).
- Get transactions in by:
  - **importing bank/card statements** (CSV/OFX downloads), with automatic duplicate detection
  - **quick manual entry** on her phone (cash, or logging a purchase right after making it).
- **Categories**, with automatic categorisation of repeat merchants once she has categorised one.
- **Transfers and card payments** recognised and excluded from spending.
- **Allowance** recorded as income.
- **Single view:** one list of all transactions across accounts, plus a simple overview of
  spending by month, category and account.
- Google sign-in for the two users; works on the iPhone home screen.

### Phase 2 — Reflection and budgeting
- **Rate each spend:** Worth it / Neutral / Regret.
- **Need vs want** tag on each spend.
- **Weekly review ritual:** a guided ~5-minute check-in, with a reminder at a time she chooses.
- **Zero-based budget:** give each allowance dollar a job. Soft, never restrictive.
- **Monthly insights** in plain English (e.g. "Food up 30% vs last month, mostly weekends").
- **Nudges:** a "Rate this?" prompt on new transactions, and a weekly or monthly digest for the parent.

### Phase 3 — Less typing (automation upgrades)
- **Receipt and bill photos:** snap a photo, details are read automatically and matched to a transaction.
- **Email alert parsing:** read bank and card alert emails (with permission) to capture spends as they happen.
- **Bank text alerts** via an iOS Shortcuts automation.
- **Reconciliation:** match manual entries, photos and alerts against statement lines so nothing is counted twice.
- **Automatic bank sync** (e.g. Plaid), only if a free or very cheap tier fits the budget.

### Phase 4 — Goals, credit habits and gamification
- **Simple savings goals** (e.g. "Spring break: $400 by March") with progress.
- **Credit card health:**
  - balance, statement amount and due date, with a reminder before the due date
  - a "paid in full?" check each month
  - credit utilisation, with a plain-English explanation of why it matters.
- **Gamification:** streaks, badges and challenges tied to the habits above.

## 7. Phase 1 success criteria

Phase 1 succeeds when:

1. **All 3 accounts** are in the app and up to date from the start month onward.
2. **The numbers can be trusted:** totals reconcile with the bank and card statements, and
   transfers and card payments are not double counted.
3. **She can answer** "How much did I spend last month, and on what?" in under a minute, on her phone.
4. **Keeping it current takes under ~10 minutes a week** (statement import plus tidying categories).

Habit, behaviour-change and goal metrics are **deliberately deferred** until later phases.

## 8. Out of scope (for now)

- Multiple currencies (USD only).
- Paid bank sync in Phase 1.
- Native iOS or Android apps.
- Other users or families, multi-tenancy and billing.
- Investments, taxes, loans and bill payment. The app **never moves money**; it only records it.

## 9. Constraints and assumptions

| Area | Decision / assumption |
|---|---|
| Country / currency | USA, USD |
| Devices | Daughter: iPhone. Parent: any browser. |
| Sign-in | Google accounts, restricted to the two named users |
| Running cost | Near-free (target < $5/month) |
| History | Start tracking from the current month; no back-import required |
| Maintenance | Parent + Claude; no stack preference (to be chosen in the Architecture stage) |
| Data sensitivity | Real personal financial data. Must be private, encrypted in transit, and backed up. |

## 10. Open questions for the Spec stage

1. **Which banks and card issuer?** Each one exports statements in its own CSV/OFX format, so the spec needs the names.
2. **How is the allowance paid** (Zelle, Venmo, direct transfer, cash)? If she uses **Venmo, Cash App or
   PayPal**, should each be treated as a fourth "account"?
3. How much **cash** does she spend? This sets how prominent manual entry should be.
4. Are there **shared costs** the parent pays directly (phone plan, rent, tuition) that should appear in her picture?
5. **Starting categories:** use a sensible student default list (food, groceries, transport, going out,
   shopping, subscriptions, school, personal care, …) and let her edit it?
6. Should she have **input on these objectives** before we spec, so she feels ownership of the app?
