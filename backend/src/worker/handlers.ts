import { PoolClient } from 'pg';
import { OutboxJob } from '../services/outbox';
import { createNotification } from '../services/notifications';

export type JobHandler = (job: OutboxJob, client: PoolClient) => Promise<void>;

/**
 * Default handlers for outbox background jobs.
 * Guaranteed idempotent: notifications use ON CONFLICT (job_id, user_id) DO NOTHING.
 */
export const defaultHandlers: Record<string, JobHandler> = {
  NOTIFY_ASSIGNEE: async (job: OutboxJob, client: PoolClient) => {
    const payload = job.payload as {
      itemId: string;
      assigneeId: string;
      title?: string;
      newStatus?: string;
      reason?: string | null;
    };

    if (!payload.assigneeId || !payload.itemId) {
      return;
    }

    const message = payload.newStatus
      ? `Work item "${payload.title || payload.itemId}" status updated to ${payload.newStatus}${payload.reason ? `: ${payload.reason}` : ''}`
      : `You have been assigned to work item "${payload.title || payload.itemId}"`;

    await createNotification(
      client,
      payload.assigneeId,
      payload.itemId,
      job.id,
      message
    );
  },

  NOTIFY_APPROVERS: async (job: OutboxJob, client: PoolClient) => {
    const payload = job.payload as {
      itemId: string;
      teamId: string;
      title?: string;
    };

    if (!payload.itemId || !payload.teamId) {
      return;
    }

    // Find all lead and admin members of the item's team, excluding current assignee
    const approversRes = await client.query(
      `
      SELECT m.user_id
      FROM memberships m
      JOIN work_items wi ON wi.id = $1
      WHERE m.team_id = $2
        AND m.role IN ('lead', 'admin')
        AND (wi.assignee_id IS NULL OR m.user_id != wi.assignee_id);
      `,
      [payload.itemId, payload.teamId]
    );

    const message = `Work item "${payload.title || payload.itemId}" is awaiting your approval`;

    for (const row of approversRes.rows) {
      await createNotification(
        client,
        row.user_id,
        payload.itemId,
        job.id,
        message
      );
    }
  },
};
