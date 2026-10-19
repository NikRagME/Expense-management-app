import type { Rule, Settings } from '../../../shared/types';
import { all, parseJson } from './db';

export async function loadSettings(db: D1Database): Promise<Settings> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const map = new Map(rows.map((r) => [r.key, parseJson<unknown>(r.value, null)]));
  return {
    parentZelleNames: (map.get('parent_zelle_names') as string[] | null) ?? [],
    venmoIncomingDefault: map.get('venmo_incoming_default') === 'repayment' ? 'repayment' : 'ask',
  };
}

interface RuleRow {
  id: string;
  match_type: Rule['matchType'];
  pattern: string;
  account_id: string | null;
  set_kind: Rule['setKind'];
  set_category_id: string | null;
  priority: number;
}

export async function loadRules(db: D1Database): Promise<Rule[]> {
  const rows = await all<RuleRow>(db, 'SELECT * FROM rules ORDER BY priority DESC, created_at DESC');
  return rows.map((r) => ({
    id: r.id,
    matchType: r.match_type,
    pattern: r.pattern,
    accountId: r.account_id,
    setKind: r.set_kind,
    setCategoryId: r.set_category_id,
    priority: r.priority,
  }));
}
