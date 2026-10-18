import { Pool } from 'pg';
import { pool } from '../db/pool';
import { config } from '../config';
import {
  claimOutboxBatch,
  completeOutboxJob,
  failOrRetryOutboxJob,
} from '../services/outbox';
import { defaultHandlers, JobHandler } from './handlers';

/**
 * Processes a single batch of claimed outbox jobs.
 * Exported so that integration tests can invoke it synchronously.
 */
export async function processBatch(
  handlers: Record<string, JobHandler> = defaultHandlers,
  customPool?: Pool
): Promise<number> {
  const p = customPool || pool;
  const client = await p.connect();

  try {
    // 1. Atomically claim up to 10 pending or stale jobs
    const jobs = await claimOutboxBatch(client, 10);
    if (jobs.length === 0) {
      return 0;
    }

    // 2. Execute each claimed job in its own transaction
    for (const job of jobs) {
      const jobClient = await p.connect();
      try {
        await jobClient.query('BEGIN');

        const handler = handlers[job.type];
        if (handler) {
          await handler(job, jobClient);
        }

        await completeOutboxJob(jobClient, job.id);
        await jobClient.query('COMMIT');
      } catch (err: any) {
        await jobClient.query('ROLLBACK');

        // Record failure or reschedule retry with exponential backoff
        await failOrRetryOutboxJob(
          client,
          job.id,
          err.message || 'Unknown handler error',
          job.attempts,
          job.max_attempts
        );
      } finally {
        jobClient.release();
      }
    }

    return jobs.length;
  } finally {
    client.release();
  }
}

/**
 * Worker polling loop: continuously checks for pending outbox jobs every WORKER_POLL_MS.
 */
export async function startWorker(
  intervalMs = config.workerPollMs,
  handlers = defaultHandlers
): Promise<void> {
  console.log(`Starting Outbox Worker (polling every ${intervalMs}ms)...`);
  let isRunning = true;

  const stop = () => {
    console.log('Stopping Outbox Worker...');
    isRunning = false;
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (isRunning) {
    try {
      const count = await processBatch(handlers);
      if (count > 0) {
        console.log(`Processed ${count} outbox jobs`);
      }
    } catch (err) {
      console.error('Error processing outbox batch:', err);
    }

    if (isRunning) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

if (require.main === module) {
  startWorker().catch((err) => {
    console.error('Fatal worker error:', err);
    process.exit(1);
  });
}
