import { describe, it, expect, beforeEach } from 'vitest';
import { seedTestEnv, testPool, truncateDb } from './helpers';
import { processBatch } from '../src/worker/worker';
import { defaultHandlers } from '../src/worker/handlers';

describe('7. Outbox Worker & Resilient Processing', () => {
  beforeEach(async () => {
    await truncateDb();
  });

  it('Calling processBatch twice on the same job produces ONE notification (idempotent)', async () => {
    const env = await seedTestEnv();

    // 1. Create a work item
    const itemRes = await testPool.query(
      `
      INSERT INTO work_items (title, type, priority, status, team_id, created_by, assignee_id)
      VALUES ('Outbox idempotent test item', 'task', 'medium', 'open', $1, $2, $3)
      RETURNING id;
      `,
      [env.teamPaymentsId, env.admin.id, env.paymentsMember1.id]
    );
    const itemId = itemRes.rows[0].id;

    // 2. Enqueue outbox job
    const jobRes = await testPool.query(
      `
      INSERT INTO outbox_jobs (type, payload, status)
      VALUES ('NOTIFY_ASSIGNEE', $1, 'pending')
      RETURNING id;
      `,
      [
        JSON.stringify({
          itemId,
          assigneeId: env.paymentsMember1.id,
          title: 'Outbox idempotent test item',
        }),
      ]
    );
    const jobId = jobRes.rows[0].id;

    // 3. Process first time
    const count1 = await processBatch(defaultHandlers, testPool);
    expect(count1).toBe(1);

    // Verify job is done and 1 notification exists
    const jobAfter1 = await testPool.query(
      'SELECT status FROM outbox_jobs WHERE id = $1',
      [jobId]
    );
    expect(jobAfter1.rows[0].status).toBe('done');

    const notifAfter1 = await testPool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE job_id = $1',
      [jobId]
    );
    expect(notifAfter1.rows[0].count).toBe(1);

    // 4. Force job back to pending to simulate redelivery of the same job_id
    await testPool.query("UPDATE outbox_jobs SET status = 'pending' WHERE id = $1", [
      jobId,
    ]);

    // 5. Process second time
    const count2 = await processBatch(defaultHandlers, testPool);
    expect(count2).toBe(1);

    // Idempotency check: exactly ONE notification row still exists
    const notifAfter2 = await testPool.query(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE job_id = $1',
      [jobId]
    );
    expect(notifAfter2.rows[0].count).toBe(1);
  });

  it('A handler that always throws is retried with backoff and ends as status failed at max_attempts', async () => {
    const env = await seedTestEnv();

    // 1. Insert a failing job with max_attempts = 3
    const jobRes = await testPool.query(
      `
      INSERT INTO outbox_jobs (type, payload, status, max_attempts)
      VALUES ('FAILING_JOB', '{}', 'pending', 3)
      RETURNING id;
      `,
      []
    );
    const jobId = jobRes.rows[0].id;

    const failingHandlers = {
      FAILING_JOB: async () => {
        throw new Error('Permanent failure simulation');
      },
    };

    // Attempt 1
    await processBatch(failingHandlers, testPool);
    const state1 = await testPool.query(
      'SELECT status, attempts, last_error, run_at > now() AS in_future FROM outbox_jobs WHERE id = $1',
      [jobId]
    );
    expect(state1.rows[0].attempts).toBe(1);
    expect(state1.rows[0].status).toBe('pending');
    expect(state1.rows[0].last_error).toContain('Permanent failure simulation');
    expect(state1.rows[0].in_future).toBe(true);

    // Reset run_at to now for Attempt 2
    await testPool.query('UPDATE outbox_jobs SET run_at = now() WHERE id = $1', [jobId]);
    await processBatch(failingHandlers, testPool);
    const state2 = await testPool.query(
      'SELECT status, attempts FROM outbox_jobs WHERE id = $1',
      [jobId]
    );
    expect(state2.rows[0].attempts).toBe(2);
    expect(state2.rows[0].status).toBe('pending');

    // Reset run_at to now for Attempt 3 (reaches max_attempts: 3)
    await testPool.query('UPDATE outbox_jobs SET run_at = now() WHERE id = $1', [jobId]);
    await processBatch(failingHandlers, testPool);
    const state3 = await testPool.query(
      'SELECT status, attempts, last_error FROM outbox_jobs WHERE id = $1',
      [jobId]
    );
    expect(state3.rows[0].attempts).toBe(3);
    // At max_attempts, status must be 'failed'
    expect(state3.rows[0].status).toBe('failed');
    expect(state3.rows[0].last_error).toContain('Permanent failure simulation');
  });

  it('A job stuck in processing with an old locked_at is picked up again', async () => {
    const env = await seedTestEnv();

    // Insert a job that was locked 90 seconds ago by a crashed worker
    const jobRes = await testPool.query(
      `
      INSERT INTO outbox_jobs (type, payload, status, locked_at, attempts)
      VALUES ('NOTIFY_ASSIGNEE', $1, 'processing', now() - interval '90 seconds', 1)
      RETURNING id;
      `,
      [
        JSON.stringify({
          itemId: '00000000-0000-0000-0000-000000000000',
          assigneeId: env.paymentsMember1.id,
          title: 'Crashed worker recovery job',
        }),
      ]
    );
    const jobId = jobRes.rows[0].id;

    // Process batch with custom mock handler
    let recoveredJobProcessed = false;
    const testHandlers = {
      NOTIFY_ASSIGNEE: async (job: any) => {
        if (job.id === jobId) {
          recoveredJobProcessed = true;
        }
      },
    };

    const count = await processBatch(testHandlers, testPool);
    expect(count).toBe(1);
    expect(recoveredJobProcessed).toBe(true);

    const afterRes = await testPool.query(
      'SELECT status, attempts, locked_at FROM outbox_jobs WHERE id = $1',
      [jobId]
    );
    expect(afterRes.rows[0].status).toBe('done');
    expect(afterRes.rows[0].attempts).toBe(2);
    expect(afterRes.rows[0].locked_at).toBeNull();
  });
});
