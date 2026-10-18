import { PoolClient } from 'pg';
import { pool } from '../db/pool';

export interface ActivityEvent {
  id: string;
  item_id: string;
  actor_id: string | null;
  actor_name?: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

/**
 * Inserts an activity event row inside an ongoing transaction.
 * Append-only constraint: DB trigger prevents any updates or deletes to this table.
 */
export async function logActivityEvent(
  client: PoolClient,
  itemId: string,
  actorId: string | null,
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<ActivityEvent> {
  const result = await client.query(
    `
    INSERT INTO activity_events (item_id, actor_id, event_type, payload)
    VALUES ($1, $2, $3, $4)
    RETURNING id, item_id, actor_id, event_type, payload, created_at;
    `,
    [itemId, actorId, eventType, JSON.stringify(payload)]
  );

  return result.rows[0];
}

/**
 * Keyset paginated retrieval of activity events for a work item, ordered newest first (id DESC).
 */
export async function getItemActivity(
  itemId: string,
  cursor?: string,
  limit = 25
): Promise<{ events: ActivityEvent[]; nextCursor: string | null }> {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const values: unknown[] = [itemId, safeLimit + 1];

  let whereClause = 'WHERE ae.item_id = $1';

  if (cursor) {
    try {
      const decodedId = Buffer.from(cursor, 'base64').toString('utf8');
      const cursorId = BigInt(decodedId);
      whereClause += ' AND ae.id < $3';
      values.push(cursorId.toString());
    } catch {
      // Invalid cursor ignored or treated as beginning
    }
  }

  const query = `
    SELECT 
      ae.id,
      ae.item_id,
      ae.actor_id,
      u.name AS actor_name,
      ae.event_type,
      ae.payload,
      ae.created_at
    FROM activity_events ae
    LEFT JOIN users u ON ae.actor_id = u.id
    ${whereClause}
    ORDER BY ae.id DESC
    LIMIT $2;
  `;

  const result = await pool.query(query, values);
  const hasMore = result.rows.length > safeLimit;
  const rows = hasMore ? result.rows.slice(0, safeLimit) : result.rows;

  let nextCursor: string | null = null;
  if (hasMore && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    nextCursor = Buffer.from(String(lastRow.id)).toString('base64');
  }

  return {
    events: rows,
    nextCursor,
  };
}
