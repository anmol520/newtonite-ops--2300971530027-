import { PoolClient } from 'pg';
import { pool } from '../db/pool';

export interface OutboxJob {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  max_attempts: number;
  run_at: string;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
}

/**
 * Enqueues an outbox job in the database.
 * Concurrency / Reliability: Must be called within the same database transaction as the
 * state-changing operation to prevent dual-write inconsistencies.
 */
export async function enqueueOutboxJob(
  client: PoolClient,
  type: string,
  payload: Record<string, unknown>
): Promise<OutboxJob> {
  const result = await client.query(
    `
    INSERT INTO outbox_jobs (type, payload)
    VALUES ($1, $2)
    RETURNING *;
    `,
    [type, JSON.stringify(payload)]
  );
  return result.rows[0];
}

/**
 * Atomically claims up to limit pending or stale jobs using FOR UPDATE SKIP LOCKED.
 * Concurrency note: SKIP LOCKED ensures multiple concurrent workers never process
 * the same job simultaneously, while recovering crashed workers whose lock expired.
 */
export async function claimOutboxBatch(
  client: PoolClient,
  batchSize = 10
): Promise<OutboxJob[]> {
  const query = `
    UPDATE outbox_jobs
    SET status = 'processing',
        locked_at = now(),
        attempts = attempts + 1
    WHERE id IN (
      SELECT id
      FROM outbox_jobs
      WHERE (status = 'pending' AND run_at <= now())
         OR (status = 'processing' AND locked_at < now() - interval '60 seconds')
      ORDER BY id
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    RETURNING *;
  `;
  const result = await client.query(query, [batchSize]);
  return result.rows;
}

/**
 * Marks an outbox job as successfully completed.
 */
export async function completeOutboxJob(client: PoolClient, jobId: string): Promise<void> {
  await client.query(
    `
    UPDATE outbox_jobs
    SET status = 'done',
        locked_at = NULL
    WHERE id = $1;
    `,
    [jobId]
  );
}

/**
 * Records failure or schedules an exponential backoff retry.
 * Backoff formula: run_at = now() + (2^attempts * 2 seconds)
 */
export async function failOrRetryOutboxJob(
  client: PoolClient,
  jobId: string,
  errorMessage: string,
  currentAttempts: number,
  maxAttempts: number
): Promise<void> {
  if (currentAttempts >= maxAttempts) {
    await client.query(
      `
      UPDATE outbox_jobs
      SET status = 'failed',
          locked_at = NULL,
          last_error = $2
      WHERE id = $1;
      `,
      [jobId, errorMessage]
    );
  } else {
    // Retry with exponential backoff: 2^attempts * 2 seconds
    await client.query(
      `
      UPDATE outbox_jobs
      SET status = 'pending',
          locked_at = NULL,
          last_error = $2,
          run_at = now() + (power(2, attempts) * interval '2 seconds')
      WHERE id = $1;
      `,
      [jobId, errorMessage]
    );
  }
}
