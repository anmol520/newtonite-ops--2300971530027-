import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { seedTestEnv, testPool, truncateDb } from './helpers';

describe('2. Versioning & Optimistic Concurrency Control', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateDb();
  });

  it('PATCH with stale version returns 409 with latest item, data unchanged, no event written; correct version succeeds and increments version', async () => {
    const env = await seedTestEnv();

    // 1. Create a work item (version = 1)
    const createRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .set('Idempotency-Key', 'test-create-item-version-1')
      .send({
        title: 'Initial item title for version testing',
        description: 'Original description',
        type: 'incident',
        priority: 'low',
        teamId: env.teamPaymentsId,
      });

    expect(createRes.status).toBe(201);
    const itemId = createRes.body.id;
    expect(createRes.body.version).toBe(1);

    // Initial activity count (should have 1 CREATED event)
    const initialEvents = await testPool.query(
      'SELECT COUNT(*)::int AS count FROM activity_events WHERE item_id = $1',
      [itemId]
    );
    expect(initialEvents.rows[0].count).toBe(1);

    // 2. Correct version update succeeds: change title with version 1 -> increments to 2
    const update1Res = await request(app)
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        version: 1,
        title: 'Updated title with valid version',
      });

    expect(update1Res.status).toBe(200);
    expect(update1Res.body.version).toBe(2);
    expect(update1Res.body.title).toBe('Updated title with valid version');

    // 1 TITLE_CHANGED event should be added
    const afterUpdate1Events = await testPool.query(
      'SELECT COUNT(*)::int AS count FROM activity_events WHERE item_id = $1',
      [itemId]
    );
    expect(afterUpdate1Events.rows[0].count).toBe(2);

    // 3. Stale version update: sending version 1 (current is 2) must return 409
    const staleRes = await request(app)
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        version: 1,
        title: 'Stale update that should be rejected',
        priority: 'urgent',
      });

    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error).toBeDefined();
    expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');
    expect(staleRes.body.error.current).toBeDefined();
    expect(staleRes.body.error.current.version).toBe(2);
    expect(staleRes.body.error.current.title).toBe('Updated title with valid version');

    // Verify DB state: data unchanged
    const dbItemRes = await testPool.query(
      'SELECT title, priority, version FROM work_items WHERE id = $1',
      [itemId]
    );
    expect(dbItemRes.rows[0].title).toBe('Updated title with valid version');
    expect(dbItemRes.rows[0].priority).toBe('low');
    expect(dbItemRes.rows[0].version).toBe(2);

    // Verify DB state: no activity event was written for the failed update
    const eventsAfterStale = await testPool.query(
      'SELECT COUNT(*)::int AS count FROM activity_events WHERE item_id = $1',
      [itemId]
    );
    expect(eventsAfterStale.rows[0].count).toBe(2);

    // 4. Correct version update succeeds: sending version 2 increments to 3
    const update2Res = await request(app)
      .patch(`/api/items/${itemId}`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`)
      .send({
        version: 2,
        priority: 'urgent',
      });

    expect(update2Res.status).toBe(200);
    expect(update2Res.body.version).toBe(3);
    expect(update2Res.body.priority).toBe('urgent');

    // Event PRIORITY_CHANGED is written
    const priorityEvent = await testPool.query(
      "SELECT * FROM activity_events WHERE item_id = $1 AND event_type = 'PRIORITY_CHANGED'",
      [itemId]
    );
    expect(priorityEvent.rows.length).toBe(1);
    expect(priorityEvent.rows[0].payload.from).toBe('low');
    expect(priorityEvent.rows[0].payload.to).toBe('urgent');
  });
});
