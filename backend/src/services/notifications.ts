import { PoolClient } from 'pg';
import { pool } from '../db/pool';

export interface NotificationRecord {
  id: string;
  user_id: string;
  item_id: string;
  job_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

/**
 * Inserts a notification record idempotently.
 * Idempotency note: ON CONFLICT (job_id, user_id) DO NOTHING guarantees that
 * re-processing a job will never generate duplicate notifications for a user.
 */
export async function createNotification(
  client: PoolClient,
  userId: string,
  itemId: string,
  jobId: string,
  message: string
): Promise<void> {
  await client.query(
    `
    INSERT INTO notifications (user_id, item_id, job_id, message)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (job_id, user_id) DO NOTHING;
    `,
    [userId, itemId, jobId, message]
  );
}

/**
 * Retrieves the latest 50 notifications for the specified user and the unread count.
 */
export async function getNotifications(
  userId: string
): Promise<{ notifications: NotificationRecord[]; unreadCount: number }> {
  const notificationsRes = await pool.query(
    `
    SELECT id, user_id, item_id, job_id, message, read_at, created_at
    FROM notifications
    WHERE user_id = $1
    ORDER BY id DESC
    LIMIT 50;
    `,
    [userId]
  );

  const countRes = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM notifications
    WHERE user_id = $1 AND read_at IS NULL;
    `,
    [userId]
  );

  return {
    notifications: notificationsRes.rows,
    unreadCount: countRes.rows[0].count,
  };
}

/**
 * Marks all unread notifications as read for the user.
 */
export async function markAllAsRead(userId: string): Promise<void> {
  await pool.query(
    `
    UPDATE notifications
    SET read_at = now()
    WHERE user_id = $1 AND read_at IS NULL;
    `,
    [userId]
  );
}
