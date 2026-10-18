import { PoolClient } from 'pg';
import { pool } from '../db/pool';

export interface CommentRecord {
  id: string;
  item_id: string;
  author_id: string;
  author_name?: string;
  body: string;
  created_at: string;
}

/**
 * Inserts a new comment for a work item inside a transaction.
 */
export async function createComment(
  client: PoolClient,
  itemId: string,
  authorId: string,
  body: string
): Promise<CommentRecord> {
  const result = await client.query(
    `
    INSERT INTO comments (item_id, author_id, body)
    VALUES ($1, $2, $3)
    RETURNING id, item_id, author_id, body, created_at;
    `,
    [itemId, authorId, body]
  );
  return result.rows[0];
}

/**
 * Fetches all comments for an item ordered chronologically.
 */
export async function getItemComments(itemId: string): Promise<CommentRecord[]> {
  const result = await pool.query(
    `
    SELECT 
      c.id, 
      c.item_id, 
      c.author_id, 
      u.name AS author_name, 
      c.body, 
      c.created_at
    FROM comments c
    JOIN users u ON c.author_id = u.id
    WHERE c.item_id = $1
    ORDER BY c.created_at ASC;
    `,
    [itemId]
  );
  return result.rows;
}
