/** Thin helpers over D1. */

export type Bind = string | number | null;

export const uuid = () => crypto.randomUUID();

export async function all<T>(db: D1Database, sql: string, ...params: Bind[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

export async function first<T>(db: D1Database, sql: string, ...params: Bind[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export function stmt(db: D1Database, sql: string, ...params: Bind[]): D1PreparedStatement {
  return db.prepare(sql).bind(...params);
}

/** Build "?, ?, ?" for IN clauses. */
export const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** D1 limits bound parameters per statement; chunk IN-lists to stay well under it. */
export async function allIn<T>(db: D1Database, sqlWithIn: (ph: string) => string, ids: string[], ...extra: Bind[]): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    out.push(...(await all<T>(db, sqlWithIn(placeholders(chunk.length)), ...chunk, ...extra)));
  }
  return out;
}

export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}
