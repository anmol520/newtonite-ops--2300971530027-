import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { seedTestEnv, testPool, truncateDb } from './helpers';

describe('4. Workflow State Machine & Permissions', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateDb();
  });

  it('open -> closed invalid transition returns 422 INVALID_TRANSITION', async () => {
    const env = await seedTestEnv();

    const createRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'wf-test-open-closed-1')
      .send({
        title: 'Item testing invalid direct jump',
        type: 'incident',
        priority: 'high',
        teamId: env.teamPaymentsId,
      });

    expect(createRes.status).toBe(201);
    const itemId = createRes.body.id;

    // Attempt illegal transition: open -> closed
    const jumpRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        to: 'closed',
        version: 1,
      });

    expect(jumpRes.status).toBe(422);
    expect(jumpRes.body.error).toBeDefined();
    expect(jumpRes.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('Approval permissions: member approving returns 403, lead approving succeeds, lead cannot approve own assigned item', async () => {
    const env = await seedTestEnv();

    // 1. Create an item and assign it to member1
    const createRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'wf-approval-item-1')
      .send({
        title: 'Approval permissions item assigned to member',
        type: 'task',
        priority: 'medium',
        teamId: env.teamPaymentsId,
      });
    const itemId = createRes.body.id;

    // Assign to member1
    const assignRes = await request(app)
      .post(`/api/items/${itemId}/assign`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        assigneeId: env.paymentsMember1.id,
        version: 1,
      });
    expect(assignRes.status).toBe(200);

    // Transition to in_progress by assignee
    const inProgRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsMember1.token}`)
      .send({
        to: 'in_progress',
        version: 2,
      });
    expect(inProgRes.status).toBe(200);

    // Transition to awaiting_approval by assignee
    const awaitingRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsMember1.token}`)
      .send({
        to: 'awaiting_approval',
        version: 3,
      });
    expect(awaitingRes.status).toBe(200);

    // Case A: A member attempting to approve returns 403
    const memberApproveRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsMember1.token}`)
      .send({
        to: 'resolved',
        version: 4,
      });
    expect(memberApproveRes.status).toBe(403);

    // Case B: A lead approving succeeds
    const leadApproveRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        to: 'resolved',
        version: 4,
      });
    expect(leadApproveRes.status).toBe(200);
    expect(leadApproveRes.body.status).toBe('resolved');

    // Case C: A lead CANNOT approve an item assigned to themselves
    const ownItemRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'wf-own-item-1')
      .send({
        title: 'Lead self-assigned item',
        type: 'task',
        priority: 'high',
        teamId: env.teamPaymentsId,
      });
    const ownItemId = ownItemRes.body.id;

    // Assign to lead
    await request(app)
      .post(`/api/items/${ownItemId}/assign`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        assigneeId: env.paymentsLead.id,
        version: 1,
      });

    // Move to in_progress
    await request(app)
      .post(`/api/items/${ownItemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        to: 'in_progress',
        version: 2,
      });

    // Move to awaiting_approval
    await request(app)
      .post(`/api/items/${ownItemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        to: 'awaiting_approval',
        version: 3,
      });

    // Lead tries to approve their own item -> MUST return 403
    const selfApproveRes = await request(app)
      .post(`/api/items/${ownItemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        to: 'resolved',
        version: 4,
      });
    expect(selfApproveRes.status).toBe(403);

    // But Admin CAN approve it
    const adminApproveRes = await request(app)
      .post(`/api/items/${ownItemId}/transition`)
      .set('Authorization', `Bearer ${env.admin.token}`)
      .send({
        to: 'resolved',
        version: 4,
      });
    expect(adminApproveRes.status).toBe(200);
    expect(adminApproveRes.body.status).toBe('resolved');
  });

  it('Rejection without a reason returns 400 or 422', async () => {
    const env = await seedTestEnv();

    const createRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'wf-rejection-test-1')
      .send({
        title: 'Item testing rejection reason requirement',
        type: 'compliance',
        priority: 'medium',
        teamId: env.teamPaymentsId,
      });
    const itemId = createRes.body.id;

    // Assign to member, move to in_progress, then awaiting_approval
    await request(app)
      .post(`/api/items/${itemId}/assign`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({ assigneeId: env.paymentsMember1.id, version: 1 });

    await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsMember1.token}`)
      .send({ to: 'in_progress', version: 2 });

    await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsMember1.token}`)
      .send({ to: 'awaiting_approval', version: 3 });

    // Attempt rejection without reason: awaiting_approval -> in_progress
    const rejectNoReasonRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        to: 'in_progress',
        version: 4,
        // reason is missing
      });

    expect([400, 422]).toContain(rejectNoReasonRes.status);

    // With reason, rejection succeeds
    const rejectWithReasonRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        to: 'in_progress',
        version: 4,
        reason: 'Compliance documentation incomplete. Please attach vendor audit.',
      });

    expect(rejectWithReasonRes.status).toBe(200);
    expect(rejectWithReasonRes.body.status).toBe('in_progress');
  });

  it('Full happy path open -> in_progress -> awaiting_approval -> resolved -> closed works and produces the right events', async () => {
    const env = await seedTestEnv();

    // 1. Create (open)
    const createRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'wf-full-happy-path-1')
      .send({
        title: 'Full workflow lifecycle test item',
        type: 'payment',
        priority: 'high',
        teamId: env.teamPaymentsId,
      });
    expect(createRes.status).toBe(201);
    const itemId = createRes.body.id;
    expect(createRes.body.status).toBe('open');
    expect(createRes.body.version).toBe(1);

    // 2. Assign to member1
    const assignRes = await request(app)
      .post(`/api/items/${itemId}/assign`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({ assigneeId: env.paymentsMember1.id, version: 1 });
    expect(assignRes.status).toBe(200);
    expect(assignRes.body.version).toBe(2);

    // 3. open -> in_progress
    const inProgRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsMember1.token}`)
      .send({ to: 'in_progress', version: 2 });
    expect(inProgRes.status).toBe(200);
    expect(inProgRes.body.status).toBe('in_progress');
    expect(inProgRes.body.version).toBe(3);

    // 4. in_progress -> awaiting_approval
    const awaitingRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsMember1.token}`)
      .send({ to: 'awaiting_approval', version: 3 });
    expect(awaitingRes.status).toBe(200);
    expect(awaitingRes.body.status).toBe('awaiting_approval');
    expect(awaitingRes.body.version).toBe(4);

    // 5. awaiting_approval -> resolved (approved by lead)
    const resolvedRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({ to: 'resolved', version: 4 });
    expect(resolvedRes.status).toBe(200);
    expect(resolvedRes.body.status).toBe('resolved');
    expect(resolvedRes.body.version).toBe(5);

    // 6. resolved -> closed
    const closedRes = await request(app)
      .post(`/api/items/${itemId}/transition`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({ to: 'closed', version: 5 });
    expect(closedRes.status).toBe(200);
    expect(closedRes.body.status).toBe('closed');
    expect(closedRes.body.version).toBe(6);

    // Verify full activity event history
    const eventsRes = await testPool.query(
      'SELECT event_type, payload FROM activity_events WHERE item_id = $1 ORDER BY id ASC',
      [itemId]
    );

    const eventTypes = eventsRes.rows.map((r) => r.event_type);
    expect(eventTypes).toEqual([
      'CREATED',
      'ASSIGNED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
      'STATUS_CHANGED',
    ]);

    expect(eventsRes.rows[2].payload).toEqual({ from: 'open', to: 'in_progress', reason: null });
    expect(eventsRes.rows[3].payload).toEqual({ from: 'in_progress', to: 'awaiting_approval', reason: null });
    expect(eventsRes.rows[4].payload).toEqual({ from: 'awaiting_approval', to: 'resolved', reason: null });
    expect(eventsRes.rows[5].payload).toEqual({ from: 'resolved', to: 'closed', reason: null });
  });
});
