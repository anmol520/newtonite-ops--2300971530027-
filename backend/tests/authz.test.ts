import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { seedTestEnv, truncateDb } from './helpers';

describe('5. Authorization & Multi-tenant Isolation', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateDb();
  });

  it('A user from another team gets 403 on read, edit, claim, comment, activity, and transition', async () => {
    const env = await seedTestEnv();

    // Create an item in Payments Ops team
    const createRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'authz-test-item-1')
      .send({
        title: 'Payments team confidential operation',
        type: 'payment',
        priority: 'high',
        teamId: env.teamPaymentsId,
      });

    expect(createRes.status).toBe(201);
    const paymentsItemId = createRes.body.id;

    // supportMember belongs only to Customer Support team
    const outsiderToken = env.supportMember.token;

    // 1. Read
    const readRes = await request(app)
      .get(`/api/items/${paymentsItemId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(readRes.status).toBe(403);

    // 2. Edit (PATCH)
    const editRes = await request(app)
      .patch(`/api/items/${paymentsItemId}`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ title: 'Tampered title', version: 1 });
    expect(editRes.status).toBe(403);

    // 3. Claim
    const claimRes = await request(app)
      .post(`/api/items/${paymentsItemId}/claim`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(claimRes.status).toBe(403);

    // 4. Comment
    const commentRes = await request(app)
      .post(`/api/items/${paymentsItemId}/comments`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ body: 'Outsider comment' });
    expect(commentRes.status).toBe(403);

    // 5. Activity
    const activityRes = await request(app)
      .get(`/api/items/${paymentsItemId}/activity`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(activityRes.status).toBe(403);

    // 6. Transition
    const transRes = await request(app)
      .post(`/api/items/${paymentsItemId}/transition`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({ to: 'in_progress', version: 1 });
    expect(transRes.status).toBe(403);
  });

  it('A viewer cannot create, claim or comment', async () => {
    const env = await seedTestEnv();
    const viewerToken = env.paymentsViewer.token;

    // 1. Viewer cannot create
    const createRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${viewerToken}`)
      .set('Idempotency-Key', 'viewer-create-test')
      .send({
        title: 'Viewer unauthorized creation',
        type: 'task',
        priority: 'low',
        teamId: env.teamPaymentsId,
      });
    expect(createRes.status).toBe(403);

    // Create an item legitimately via lead
    const legitRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'viewer-target-item')
      .send({
        title: 'Legitimate item for viewer tests',
        type: 'task',
        priority: 'low',
        teamId: env.teamPaymentsId,
      });
    const itemId = legitRes.body.id;

    // 2. Viewer cannot claim
    const claimRes = await request(app)
      .post(`/api/items/${itemId}/claim`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(claimRes.status).toBe(403);

    // 3. Viewer cannot comment
    const commentRes = await request(app)
      .post(`/api/items/${itemId}/comments`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ body: 'Viewer illegal comment' });
    expect(commentRes.status).toBe(403);
  });

  it("The list endpoint never returns another team's items", async () => {
    const env = await seedTestEnv();

    // Create item in Payments Ops
    await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'list-payments-item-1')
      .send({
        title: 'Payments exclusive item',
        type: 'payment',
        priority: 'high',
        teamId: env.teamPaymentsId,
      });

    // Create item in Customer Support
    await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.supportLead.token}`)
      .set('Idempotency-Key', 'list-support-item-1')
      .send({
        title: 'Support exclusive item',
        type: 'customer_issue',
        priority: 'medium',
        teamId: env.teamSupportId,
      });

    // Support member lists items
    const listRes = await request(app)
      .get('/api/items')
      .set('Authorization', `Bearer ${env.supportMember.token}`);

    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toBeDefined();

    // All returned items must belong exclusively to Customer Support
    for (const item of listRes.body.items) {
      expect(item.team_id).toBe(env.teamSupportId);
      expect(item.team_id).not.toBe(env.teamPaymentsId);
    }

    // Explicit filter for Payments team by Support member must return 403
    const foreignTeamFilterRes = await request(app)
      .get(`/api/items?teamId=${env.teamPaymentsId}`)
      .set('Authorization', `Bearer ${env.supportMember.token}`);

    expect(foreignTeamFilterRes.status).toBe(403);
  });
});
