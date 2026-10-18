import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { seedTestEnv, testPool, truncateDb } from './helpers';

describe('8. Keyset Pagination & Server-side Filtering', () => {
  const app = createApp();

  beforeEach(async () => {
    await truncateDb();
  });

  it('With 120 items and limit 50, three pages have no duplicates and no gaps; filters and q are applied on the server', async () => {
    const env = await seedTestEnv();

    // 1. Insert 120 items with distinct created_at timestamps
    console.log('Inserting 120 items for pagination test...');
    const now = Date.now();
    const batchValues: unknown[] = [];
    const placeholders: string[] = [];

    for (let i = 0; i < 120; i++) {
      const idx = i * 7;
      // Guarantee monotonically increasing created_at
      const createdAt = new Date(now - (120 - i) * 1000).toISOString();
      const type = i % 2 === 0 ? 'incident' : 'task';
      const priority = i % 3 === 0 ? 'urgent' : 'medium';
      const title = `Paginated test item #${i + 1}`;
      const description = i === 42 ? 'SpecialUniqueQuantumKeyword for search test' : `Standard description ${i + 1}`;

      placeholders.push(`($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, 'open', $${idx + 5}, $${idx + 6}, $${idx + 7})`);
      batchValues.push(title, description, type, priority, env.teamPaymentsId, env.admin.id, createdAt);
    }

    await testPool.query(
      `
      INSERT INTO work_items (title, description, type, priority, status, team_id, created_by, created_at)
      VALUES ${placeholders.join(', ')};
      `,
      batchValues
    );

    // 2. Keyset pagination test: limit 50 across 120 items
    // Page 1: 50 items
    const page1Res = await request(app)
      .get('/api/items?limit=50')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.items.length).toBe(50);
    expect(page1Res.body.nextCursor).toBeTruthy();

    // Page 2: 50 items
    const page2Res = await request(app)
      .get(`/api/items?limit=50&cursor=${encodeURIComponent(page1Res.body.nextCursor)}`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.items.length).toBe(50);
    expect(page2Res.body.nextCursor).toBeTruthy();

    // Page 3: remaining 20 items
    const page3Res = await request(app)
      .get(`/api/items?limit=50&cursor=${encodeURIComponent(page2Res.body.nextCursor)}`)
      .set('Authorization', `Bearer ${env.paymentsLead.token}`);

    expect(page3Res.status).toBe(200);
    expect(page3Res.body.items.length).toBe(20);
    expect(page3Res.body.nextCursor).toBeNull();

    // Verify: No duplicates, no gaps across all 120 items
    const allItems = [
      ...page1Res.body.items,
      ...page2Res.body.items,
      ...page3Res.body.items,
    ];
    expect(allItems.length).toBe(120);

    const idSet = new Set(allItems.map((it) => it.id));
    expect(idSet.size).toBe(120);

    // 3. Server-side filter: type=incident
    const incidentFilterRes = await request(app)
      .get('/api/items?type=incident&limit=100')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`);

    expect(incidentFilterRes.status).toBe(200);
    expect(incidentFilterRes.body.items.length).toBe(60);
    for (const it of incidentFilterRes.body.items) {
      expect(it.type).toBe('incident');
    }

    // 4. Server-side filter: priority=urgent
    const urgentFilterRes = await request(app)
      .get('/api/items?priority=urgent&limit=100')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`);

    expect(urgentFilterRes.status).toBe(200);
    expect(urgentFilterRes.body.items.length).toBe(40);
    for (const it of urgentFilterRes.body.items) {
      expect(it.priority).toBe('urgent');
    }

    // 5. Full text search: q=SpecialUniqueQuantumKeyword
    const searchMatchRes = await request(app)
      .get('/api/items?q=SpecialUniqueQuantumKeyword')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`);

    expect(searchMatchRes.status).toBe(200);
    expect(searchMatchRes.body.items.length).toBe(1);
    expect(searchMatchRes.body.items[0].description).toContain('SpecialUniqueQuantumKeyword');

    // Search with non-matching term
    const searchEmptyRes = await request(app)
      .get('/api/items?q=NonExistentGibberishTerm123')
      .set('Authorization', `Bearer ${env.paymentsLead.token}`);

    expect(searchEmptyRes.status).toBe(200);
    expect(searchEmptyRes.body.items.length).toBe(0);
  });
});
