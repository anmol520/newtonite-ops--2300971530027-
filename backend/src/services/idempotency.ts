import crypto from 'crypto';
import { PoolClient } from 'pg';
import { unprocessable } from '../middleware/error';

export interface IdempotencyResult<T = unknown> {
  statusCode: number;
  body: T;
}

/**
 * Computes a deterministic SHA-256 hash of the request:
 * method + path + JSON body
 */
export function computeRequestHash(method: string, path: string, body: unknown): string {
  const normalizedMethod = method.toUpperCase();
  const normalizedBody = JSON.stringify(body ?? {});
  return crypto
    .createHash('sha256')
    .update(`${normalizedMethod}:${path}:${normalizedBody}`)
    .digest('hex');
}

/**
 * Executes a state-changing operation with transactional idempotency guarantees.
 *
 * Concurrency / Idempotency guarantee:
 * When two concurrent requests arrive with the same (user_id, key), PostgreSQL's unique
 * constraint on (user_id, key) forces the second transaction to wait on the row lock
 * until the first transaction commits or rolls back.
 * If the first transaction commits, the second transaction's INSERT ... ON CONFLICT DO NOTHING
 * produces 0 inserted rows. This eliminates the race condition, preventing the second transaction
 * from creating a duplicate item, and ensures it safely returns the exact cached response.
 */
export async function executeWithIdempotency<T>(
  client: PoolClient,
  userId: string,
  key: string | undefined | null,
  method: string,
  path: string,
  requestPayload: unknown,
  operation: () => Promise<IdempotencyResult<T>>
): Promise<IdempotencyResult<T>> {
  // If no idempotency key is provided (for endpoints where it is optional),
  // simply execute the operation directly within the transaction.
  if (!key) {
    return operation();
  }

  const requestHash = computeRequestHash(method, path, requestPayload);

  // 1. Attempt to insert the idempotency record.
  const insertResult = await client.query(
    `
    INSERT INTO idempotency_keys (user_id, key, request_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id, key) DO NOTHING
    RETURNING key;
    `,
    [userId, key, requestHash]
  );

  if (insertResult.rows.length > 0) {
    // We are the first transaction: execute the state-changing work.
    const result = await operation();

    // Store the response status and body in the same transaction
    await client.query(
      `
      UPDATE idempotency_keys
      SET status_code = $1, response_body = $2
      WHERE user_id = $3 AND key = $4;
      `,
      [result.statusCode, JSON.stringify(result.body), userId, key]
    );

    return result;
  }

  // 2. Nothing was inserted: concurrent duplicate or sequential replay.
  const selectResult = await client.query(
    `
    SELECT request_hash, status_code, response_body
    FROM idempotency_keys
    WHERE user_id = $1 AND key = $2;
    `,
    [userId, key]
  );

  if (selectResult.rows.length === 0) {
    // If the conflicting transaction rolled back, re-run operation
    return operation();
  }

  const stored = selectResult.rows[0];

  // If the stored request_hash differs, reject with 422 IDEMPOTENCY_KEY_REUSED
  if (stored.request_hash !== requestHash) {
    throw unprocessable(
      'Idempotency key reused with different request payload',
      'IDEMPOTENCY_KEY_REUSED'
    );
  }

  return {
    statusCode: stored.status_code || 200,
    body: stored.response_body as T,
  };
}
