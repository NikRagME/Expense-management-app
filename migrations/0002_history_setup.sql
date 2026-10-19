-- History setup (spec §12): opening days, PDF statements, spreadsheet matching.
-- Additive only (no table rebuilds), so it is safe to apply to a database with data.

ALTER TABLE accounts ADD COLUMN opened_on TEXT;

-- Set when a person changes a transaction's kind, category, name or note, so a
-- spreadsheet import never overwrites a choice made in Pocket (spec H4).
ALTER TABLE transactions ADD COLUMN user_edited INTEGER NOT NULL DEFAULT 0;

-- The real file type of a statement import ('csv','ofx','venmo','pdf'). The older
-- `format` column keeps its CHECK; PDFs store 'csv' there and 'pdf' here.
ALTER TABLE imports ADD COLUMN file_type TEXT;

-- A spreadsheet import (her tracking sheet). Separate from statement imports
-- because one spreadsheet covers several accounts.
CREATE TABLE history_imports (
  id              TEXT PRIMARY KEY,
  file_name       TEXT NOT NULL,
  file_hash       TEXT NOT NULL,
  rows_total      INTEGER NOT NULL,
  rows_matched    INTEGER NOT NULL,
  rows_added      INTEGER NOT NULL,
  rows_unmatched  INTEGER NOT NULL,
  created_by      TEXT REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  undone_at       TEXT
);

-- Transactions added from a spreadsheet (no bank line, e.g. cash) undo with it.
ALTER TABLE transactions ADD COLUMN history_import_id TEXT REFERENCES history_imports(id);

-- What each bank line looked like before a spreadsheet import changed it (exact undo).
CREATE TABLE history_matches (
  history_import_id  TEXT NOT NULL REFERENCES history_imports(id) ON DELETE CASCADE,
  transaction_id     TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  before_json        TEXT NOT NULL,
  PRIMARY KEY (history_import_id, transaction_id)
);

-- Every row read from her spreadsheet, and what happened to it.
CREATE TABLE spreadsheet_rows (
  id                 TEXT PRIMARY KEY,
  history_import_id  TEXT NOT NULL REFERENCES history_imports(id) ON DELETE CASCADE,
  sheet              TEXT NOT NULL,
  row_number         INTEGER NOT NULL,
  posted_date        TEXT NOT NULL,
  amount_cents       INTEGER NOT NULL,
  description        TEXT NOT NULL,
  category_label     TEXT NOT NULL DEFAULT '',
  account_ids        TEXT NOT NULL DEFAULT '[]',   -- JSON: accounts this row could belong to
  note               TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL CHECK (status IN ('matched','added','unmatched','skipped')),
  reason             TEXT,                         -- why it is unmatched
  transaction_id     TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  amount_differs     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sheet_rows_import ON spreadsheet_rows(history_import_id);
CREATE INDEX idx_sheet_rows_status ON spreadsheet_rows(status);

-- Her spreadsheet's category names → Pocket (a category id, or 'auto' / 'parent_pays' / 'skip').
CREATE TABLE category_mappings (
  source_name  TEXT PRIMARY KEY COLLATE NOCASE,
  target       TEXT NOT NULL
);

-- Her spreadsheet's account names ("SFCU Credit") → Pocket accounts.
CREATE TABLE account_aliases (
  alias       TEXT PRIMARY KEY COLLATE NOCASE,
  account_id  TEXT NOT NULL REFERENCES accounts(id)
);

INSERT INTO settings (key, value) VALUES ('own_names', '[]');
