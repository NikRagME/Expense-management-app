import { stmt, uuid } from './db';

/** Statement recording who changed what (powers "Edited by Dad · 2 days ago"). */
export function auditStmt(
  db: D1Database,
  userId: string,
  entity: string,
  entityId: string,
  action: string,
  before?: unknown,
  after?: unknown,
): D1PreparedStatement {
  return stmt(
    db,
    'INSERT INTO audit_log (id, user_id, entity, entity_id, action, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    uuid(),
    userId,
    entity,
    entityId,
    action,
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
  );
}
