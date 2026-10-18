import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { seedTestEnv, testPool, truncateDb } from './helpers';

describe('1. Concurrency: Parallel Claims', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateDb();
  });

  it('10 different members claiming the same item in parallel results in exactly one 200 and nine 409s', async () => {
    const env = await seedTestEnv();

    // 1. Create 10 different members in the payments team
    const members: { id: string; token: string }[] = [];
    const passwordHash = await bcrypt.hash('Demo@12345', 1);

    for (let i = 1; i <= 10; i++) {
      const email = `contestant${i}@demo.dev`;
      const uRes = await testPool.query(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [email, `Contestant ${i}`, passwordHash]
      );
      const userId = uRes.rows[0].id;
      await testPool.query(
        'INSERT INTO memberships (user_id, team_id, role) VALUES ($1, $2, $3)',
        [userId, env.teamPaymentsId, 'member']
      );
      const token = jwt.sign({ userId }, config.jwtSecret, { expiresIn: '8h' });
      members.push({ id: userId, token });
    }

    // 2. Create an unassigned open work item
    const itemRes = await request(app)
      .post('/api/items')
      .set('Authorization', `Bearer ${env.admin.token}`)
      .set('Idempotency-Key', 'test-create-item-concurrency-1')
      .send({
        title: 'High priority incident for parallel claim testing',
        description: 'Verifying atomic conditional update semantics',
        type: 'incident',
        priority: 'high',
        teamId: env.teamPaymentsId,
      });

    expect(itemRes.status).toBe(201);
    const itemId = itemRes.body.id;
    expect(itemRes.body.assignee_id).toBeNull();

    // 3. 10 members claim simultaneously via Promise.all
    const claimPromises = members.map((member) =>
      request(app)
        .post(`/api/items/${itemId}/claim`)
        .set('Authorization', `Bearer ${member.token}`)
        .send()
    );

    const responses = await Promise.all(claimPromises);

    const successResponses = responses.filter((r) => r.status === 200);
    const conflictResponses = responses.filter((r) => r.status === 409);

    // Exactly one winner and nine conflicts
    expect(successResponses.length).toBe(1);
    expect(conflictResponses.length).toBe(9);

    const winnerId = successResponses[0].body.assignee_id;
    expect(winnerId).toBeTruthy();

    // All conflicts should have error code ALREADY_CLAIMED and include current item
    for (const r of conflictResponses) {
      expect(r.body.error).toBeDefined();
      expect(r.body.error.code).toBe('ALREADY_CLAIMED');
      expect(r.body.error.current.assignee_id).toBe(winnerId);
    }

    // 4. Verify DB state: assignee matches winner
    const dbItemRes = await testPool.query(
      'SELECT assignee_id, status FROM work_items WHERE id = $1',
      [itemId]
    );
    expect(dbItemRes.rows[0].assignee_id).toBe(winnerId);
    expect(dbItemRes.rows[0].status).toBe('in_progress');

    // 5. Verify DB state: exactly one CLAIMED activity event exists
    const eventsRes = await testPool.query(
      "SELECT * FROM activity_events WHERE item_id = $1 AND event_type = 'CLAIMED'",
      [itemId]
    );
    expect(eventsRes.rows.length).toBe(1);
    expect(eventsRes.rows[0].actor_id).toBe(winnerId);
  });
});
