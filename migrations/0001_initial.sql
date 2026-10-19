-- Initial schema (architecture §7). Money is integer cents; amounts are signed
-- from the account's point of view (money out negative). IDs are text UUIDs.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL DEFAULT '',
  role        TEXT NOT NULL CHECK (role IN ('daughter', 'parent')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL  -- JSON
);

CREATE TABLE accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  institution     TEXT NOT NULL DEFAULT '',
  type            TEXT NOT NULL CHECK (type IN ('checking','savings','credit_card','payment_app','cash','other','parent_paid')),
  import_mapping  TEXT,  -- JSON CsvMapping
  sort_order      INTEGER NOT NULL DEFAULT 0,
  archived_at     TEXT,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE category_groups (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  group_id    TEXT NOT NULL REFERENCES category_groups(id),
  name        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '',
  color       TEXT,
  hidden      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE merchants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  match_key  TEXT NOT NULL UNIQUE
);

CREATE TABLE imports (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  file_name       TEXT NOT NULL,
  file_hash       TEXT NOT NULL,
  format          TEXT NOT NULL CHECK (format IN ('csv','ofx','venmo')),
  date_from       TEXT,
  date_to         TEXT,
  rows_total      INTEGER NOT NULL,
  rows_new        INTEGER NOT NULL,
  rows_duplicate  INTEGER NOT NULL,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at       TEXT
);

CREATE TABLE recurring_items (
  id            TEXT PRIMARY KEY,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  name          TEXT NOT NULL,
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  category_id   TEXT REFERENCES categories(id),
  frequency     TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','yearly')),
  interval      INTEGER NOT NULL DEFAULT 1 CHECK (interval >= 1),
  next_date     TEXT NOT NULL,
  paused        INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transactions (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES accounts(id),
  import_id          TEXT REFERENCES imports(id),
  source             TEXT NOT NULL CHECK (source IN ('import','manual','recurring','email','sms','receipt','bank_sync')),
  external_id        TEXT,
  dedupe_key         TEXT,
  posted_date        TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  raw_description    TEXT NOT NULL DEFAULT '',
  merchant_id        TEXT REFERENCES merchants(id),
  description        TEXT NOT NULL,
  note               TEXT NOT NULL DEFAULT '',
  kind               TEXT NOT NULL CHECK (kind IN ('spend','refund','repayment','income','transfer','parent_paid')),
  counterparty       TEXT,
  payment_note       TEXT,
  funding_source     TEXT,
  excluded           INTEGER NOT NULL DEFAULT 0,
  needs_attention    TEXT,
  dismissed_attention TEXT,  -- computed review reasons she chose to dismiss (e.g. transfer_unmatched)
  recurring_item_id  TEXT REFERENCES recurring_items(id),
  -- Reserved for Phase 2
  rating             TEXT CHECK (rating IN ('worth_it','neutral','regret')),
  need_or_want       TEXT CHECK (need_or_want IN ('need','want')),
  created_by         TEXT REFERENCES users(id),
  updated_by         TEXT REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_tx_external ON transactions(account_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX idx_tx_account_date ON transactions(account_id, posted_date);
CREATE INDEX idx_tx_date ON transactions(posted_date);
CREATE INDEX idx_tx_dedupe ON transactions(account_id, dedupe_key);
CREATE INDEX idx_tx_attention ON transactions(needs_attention) WHERE needs_attention IS NOT NULL;
CREATE INDEX idx_tx_import ON transactions(import_id);

-- Every transaction has 1+ lines; split = 2+ lines summing to the transaction amount.
CREATE TABLE transaction_lines (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  amount_cents    INTEGER NOT NULL,
  category_id     TEXT REFERENCES categories(id),
  note            TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  budget_scope    TEXT CHECK (budget_scope IN ('in','outside','unsure'))  -- Phase 2
);
CREATE INDEX idx_lines_tx ON transaction_lines(transaction_id);
CREATE INDEX idx_lines_category ON transaction_lines(category_id);

CREATE TABLE transaction_links (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('transfer','repayment','merge_suggestion')),
  from_id     TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_links_from ON transaction_links(from_id);
CREATE INDEX idx_links_to ON transaction_links(to_id);

CREATE TABLE balance_snapshots (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  as_of_date        TEXT NOT NULL,
  balance_cents     INTEGER NOT NULL,
  source            TEXT NOT NULL CHECK (source IN ('statement','manual')),
  computed_cents    INTEGER,
  difference_cents  INTEGER,
  import_id         TEXT REFERENCES imports(id) ON DELETE CASCADE,
  created_by        TEXT REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_snapshots_account ON balance_snapshots(account_id, as_of_date);

CREATE TABLE rules (
  id               TEXT PRIMARY KEY,
  match_type       TEXT NOT NULL CHECK (match_type IN ('merchant','contains','regex')),
  pattern          TEXT NOT NULL,
  account_id       TEXT REFERENCES accounts(id),
  set_kind         TEXT CHECK (set_kind IN ('spend','refund','repayment','income','transfer','parent_paid')),
  set_category_id  TEXT REFERENCES categories(id),
  set_budget_scope TEXT CHECK (set_budget_scope IN ('in','outside','unsure')),  -- Phase 2
  priority         INTEGER NOT NULL DEFAULT 0,
  created_by       TEXT REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT REFERENCES users(id),
  entity       TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  before_json  TEXT,
  after_json   TEXT,
  at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

-- Seed data
INSERT INTO accounts (id, name, institution, type, sort_order) VALUES ('parent_paid', 'Paid by parent', '', 'parent_paid', 999);
INSERT INTO settings (key, value) VALUES
  ('parent_zelle_names', '[]'),
  ('venmo_incoming_default', '"ask"'),
  ('period_mode', '"calendar_month"');
INSERT INTO category_groups (id, name, sort_order) VALUES
  ('food', 'Food', 0),
  ('getting_around', 'Getting around', 1),
  ('home', 'Home', 2),
  ('school', 'School', 3),
  ('life', 'Life', 4),
  ('fun', 'Fun', 5),
  ('other', 'Other', 6);
INSERT INTO categories (id, group_id, name, emoji, sort_order) VALUES
  ('groceries', 'food', 'Groceries', '🛒', 0),
  ('eating_out', 'food', 'Eating out', '🍽️', 1),
  ('coffee_snacks', 'food', 'Coffee & snacks', '☕', 2),
  ('food_delivery', 'food', 'Food delivery', '🛵', 3),
  ('rideshare', 'getting_around', 'Rideshare', '🚗', 4),
  ('transit', 'getting_around', 'Public transit', '🚆', 5),
  ('gas_parking', 'getting_around', 'Gas & parking', '⛽', 6),
  ('travel', 'getting_around', 'Flights & travel', '✈️', 7),
  ('rent', 'home', 'Rent & housing', '🏠', 8),
  ('utilities', 'home', 'Utilities', '💡', 9),
  ('phone_internet', 'home', 'Phone & internet', '📱', 10),
  ('household', 'home', 'Household supplies', '🧻', 11),
  ('tuition', 'school', 'Tuition & fees', '🎓', 12),
  ('books', 'school', 'Books & supplies', '📚', 13),
  ('tech', 'school', 'Tech', '💻', 14),
  ('clothing', 'life', 'Clothing', '👕', 15),
  ('personal_care', 'life', 'Personal care', '🧴', 16),
  ('health', 'life', 'Health & medical', '🩺', 17),
  ('fitness', 'life', 'Fitness', '🏋️', 18),
  ('going_out', 'fun', 'Going out', '🎉', 19),
  ('entertainment', 'fun', 'Entertainment', '🎬', 20),
  ('subscriptions', 'fun', 'Subscriptions', '🔁', 21),
  ('hobbies', 'fun', 'Hobbies', '🎨', 22),
  ('gifts', 'fun', 'Gifts', '🎁', 23),
  ('fees', 'other', 'Fees & interest', '🧾', 24),
  ('misc', 'other', 'Miscellaneous', '📦', 25),
  ('allowance', 'other', 'Allowance', '💵', 26);
