/**
 * A tiny D1Database stand-in backed by Node's built-in SQLite, so API tests
 * run against the real migrations without Cloudflare tooling.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

class Statement {
  constructor(
    private db: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params as SQLInputValue[]);
  }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows.map((r) => ({ ...r })), success: true, meta: {} };
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  runSync() {
    return this.db.prepare(this.sql).run(...this.params);
  }
}

export function createTestD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  const dir = path.join(import.meta.dirname, '..', '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));

  const d1 = {
    raw: db,
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => {
          const r = s.runSync();
          return { success: true, results: [], meta: { changes: Number(r.changes) } };
        });
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
  return d1 as unknown as D1Database & { raw: DatabaseSync };
}
