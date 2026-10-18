import { describe, it, expect, beforeEach } from 'vitest';
import { seedTestEnv, testPool, truncateDb } from './helpers';
import { withTransaction } from '../src/db/pool';

describe('6. Transactional Atomicity & Append-Only Guarantees', () => {
  beforeEach(async () => {
    await truncateDb();
  });

  it('activity_events table trigger rejects UPDATE and DELETE operations', async () => {
    const env = await seedTestEnv();

    // 1. Create a work item and an activity event
    const itemRes = await testPool.query(
      `
      INSERT INTO work_items (title, type, priority, status, team_id, created_by)
      VALUES ('Atomicity target item', 'task', 'low', 'open', $1, $2)
      RETURNING id;
      `,
      [env.teamPaymentsId, env.admin.id]
    );
    const itemId = itemRes.rows[0].id;

    const eventRes = await testPool.query(
      `
      INSERT INTO activity_events (item_id, actor_id, event_type, payload)
      VALUES ($1, $2, 'CREATED', '{}')
      RETURNING id;
      `,
      [itemId, env.admin.id]
    );
    const eventId = eventRes.rows[0].id;

    // 2. Attempt UPDATE on activity_events -> must be rejected by trigger
    await expect(
      testPool.query(
        "UPDATE activity_events SET event_type = 'TAMPERED' WHERE id = $1",
        [eventId]
      )
    ).rejects.toThrow(/append-only/i);

    // 3. Attempt DELETE on activity_events -> must be rejected by trigger
    await expect(
      testPool.query('DELETE FROM activity_events WHERE id = $1', [eventId])
    ).rejects.toThrow(/append-only/i);

    // Verify row still exists and is unchanged
    const verifyRes = await testPool.query(
      'SELECT event_type FROM activity_events WHERE id = $1',
      [eventId]
    );
    expect(verifyRes.rows[0].event_type).toBe('CREATED');
  });

  it('If inserting the activity event fails inside a transaction, the item update is rolled back', async () => {
    const env = await seedTestEnv();

    // Create initial work item
    const itemRes = await testPool.query(
      `
      INSERT INTO work_items (title, description, type, priority, status, team_id, created_by, version)
      VALUES ('Original Title Before Rollback', 'Desc', 'incident', 'low', 'open', $1, $2, 1)
      RETURNING id;
      `,
      [env.teamPaymentsId, env.admin.id]
    );
    const itemId = itemRes.rows[0].id;

    // Execute transaction that updates item, but injects a failure during activity event insertion
    let transactionFailed = false;
    try {
      await withTransaction(async (client) => {
        // Step 1: Update the item
        await client.query(
          `
          UPDATE work_items
          SET title = 'Should Never Be Committed',
              version = version + 1
          WHERE id = $1;
          `,
          [itemId]
        );

        // Step 2: Inject failure on activity_events insert (foreign key violation to non-existent item)
        await client.query(
          `
          INSERT INTO activity_events (item_id, actor_id, event_type)
          VALUES ('00000000-0000-0000-0000-000000000000'::uuid, $1, 'FAILED_EVENT');
          `,
          [env.admin.id]
        );
      });
    } catch (err) {
      transactionFailed = true;
    }

    expect(transactionFailed).toBe(true);

    // Verify that the item update was completely rolled back
    const verifyRes = await testPool.query(
      'SELECT title, version FROM work_items WHERE id = $1',
      [itemId]
    );
    expect(verifyRes.rows[0].title).toBe('Original Title Before Rollback');
    expect(verifyRes.rows[0].version).toBe(1);

    // Verify no new activity event was committed
    const eventCheck = await testPool.query(
      "SELECT COUNT(*)::int AS count FROM activity_events WHERE event_type = 'FAILED_EVENT'"
    );
    expect(eventCheck.rows[0].count).toBe(0);
  });
});
