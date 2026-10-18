import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { seedTestEnv, testPool, truncateDb } from './helpers';

describe('3. Idempotency Service', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateDb();
  });

  it('Missing Idempotency-Key header on POST /api/items returns 400', async () => {
    const env = await seedTestEnv();

    const res = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      // Missing Idempotency-Key header
      .send({
        title: 'Missing header test item',
        type: 'incident',
        priority: 'high',
        teamId: env.teamPaymentsId,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('MISSING_IDEMPOTENCY_KEY');
  });

  it('Same key twice sequentially creates ONE item with an identical response', async () => {
    const env = await seedTestEnv();
    const idempotencyKey = 'seq-test-key-12345';
    const payload = {
      title: 'Sequential idempotency test item',
      description: 'Testing sequential duplicate protection',
      type: 'incident',
      priority: 'high',
      teamId: env.teamPaymentsId,
    };

    // First request
    const firstRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.id).toBeDefined();

    // Second request with exact same key and payload
    const secondRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.id).toBe(firstRes.body.id);
    expect(secondRes.body.title).toBe(firstRes.body.title);

    // Verify DB count: exactly ONE item created
    const countRes = await testPool.query(
      'SELECT COUNT(*)::int AS count FROM work_items WHERE title = $1',
      [payload.title]
    );
    expect(countRes.rows[0].count).toBe(1);
  });

  it('Same key sent 5 times in parallel creates ONE item', async () => {
    const env = await seedTestEnv();
    const idempotencyKey = 'parallel-test-key-999';
    const payload = {
      title: 'Parallel idempotency test item',
      description: 'Testing 5 parallel concurrent requests with same key',
      type: 'customer_issue',
      priority: 'medium',
      teamId: env.teamPaymentsId,
    };

    const requests = Array.from({ length: 5 }, () =>
      request(app)
        .post('/api/items')
        .set('Authorization', `Bearer ${env.paymentsLead.token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
    );

    const responses = await Promise.all(requests);

    // All 5 should succeed (status 201)
    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.id).toBe(responses[0].body.id);
    }

    // Verify DB state: exactly ONE item created
    const countRes = await testPool.query(
      'SELECT COUNT(*)::int AS count FROM work_items WHERE title = $1',
      [payload.title]
    );
    expect(countRes.rows[0].count).toBe(1);
  });

  it('Same key with a different body returns 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const env = await seedTestEnv();
    const idempotencyKey = 'reused-key-diff-body';

    const payload1 = {
      title: 'Original payload title',
      type: 'incident',
      priority: 'low',
      teamId: env.teamPaymentsId,
    };

    const firstRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload1);

    expect(firstRes.status).toBe(201);

    // Second request with same key but different priority
    const payload2 = {
      title: 'Original payload title',
      type: 'incident',
      priority: 'urgent', // Changed field
      teamId: env.teamPaymentsId,
    };

    const secondRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload2);

    expect(secondRes.status).toBe(422);
    expect(secondRes.body.error).toBeDefined();
    expect(secondRes.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});
