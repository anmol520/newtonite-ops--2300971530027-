import { pool } from '../src/db/pool';
import { seedDatabase } from '../src/db/seed';

async function runScaleCheck() {
  console.log('======================================================');
  console.log('PART D: SCALE CHECK (SEED_ITEMS=50000)');
  console.log('======================================================\n');

  // 1. Reseed with 50,000 items
  console.log('[Step 1] Seeding 50,000 work items...');
  const startSeed = Date.now();
  await seedDatabase(pool, 50000);
  console.log(`✓ 50,000 items seeded in ${((Date.now() - startSeed) / 1000).toFixed(2)}s\n`);

  // Analyze the tables so PostgreSQL planner statistics are fresh
  console.log('[Step 2] Running ANALYZE on work_items...');
  await pool.query('ANALYZE work_items;');
  await pool.query('ANALYZE memberships;');
  await pool.query('ANALYZE users;');

  // Fetch a sample user and team for realistic queries
  const userRes = await pool.query("SELECT id FROM users WHERE email = 'member.payments@demo.dev'");
  const userId = userRes.rows[0].id;

  const teamRes = await pool.query("SELECT id FROM teams WHERE name = 'Payments Ops'");
  const teamId = teamRes.rows[0].id;

  console.log(`Using sample user ID: ${userId}, team ID: ${teamId}\n`);

  const results: { queryName: string; scanType: string; executionTimeMs: number; rawPlan: string }[] = [];

  // Helper to run explain analyze
  async function explainQuery(name: string, sql: string, params: any[]) {
    console.log(`Running EXPLAIN (ANALYZE, BUFFERS) for: ${name}...`);
    const res = await pool.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
    const planLines = res.rows.map((r: any) => r['QUERY PLAN']);
    const fullPlan = planLines.join('\n');

    // Extract execution time
    const timeMatch = fullPlan.match(/Execution Time: ([\d.]+) ms/);
    const execTime = timeMatch ? parseFloat(timeMatch[1]) : 0;

    // Detect scan type on work_items
    let scanType = 'Unknown';
    if (fullPlan.includes('Index Scan') || fullPlan.includes('Bitmap Index Scan') || fullPlan.includes('Index Only Scan')) {
      scanType = 'Index Scan';
    } else if (fullPlan.includes('Seq Scan on work_items')) {
      scanType = 'Seq Scan (FAILURE)';
    }

    console.log(`Plan:\n${fullPlan}\n`);
    results.push({ queryName: name, scanType, executionTimeMs: execTime, rawPlan: fullPlan });
  }

  // 1. assigned_to_me
  await explainQuery(
    'Assigned To Me',
    `SELECT * FROM work_items 
     WHERE team_id = $1 AND assignee_id = $2 
     ORDER BY created_at DESC, id DESC 
     LIMIT 50`,
    [teamId, userId]
  );

  // 2. unassigned_urgent
  await explainQuery(
    'Unassigned Urgent',
    `SELECT * FROM work_items 
     WHERE team_id = $1 AND assignee_id IS NULL AND status = 'open' AND priority = 'urgent'
     ORDER BY created_at DESC, id DESC 
     LIMIT 50`,
    [teamId]
  );

  // 3. awaiting_my_approval
  await explainQuery(
    'Awaiting My Approval',
    `SELECT * FROM work_items 
     WHERE team_id = $1 AND status = 'awaiting_approval' AND (assignee_id IS NULL OR assignee_id != $2)
     ORDER BY created_at DESC, id DESC 
     LIMIT 50`,
    [teamId, userId]
  );

  // 4. text search
  await explainQuery(
    'Full-Text Search',
    `SELECT * FROM work_items 
     WHERE team_id = $1 AND search_vector @@ plainto_tsquery('english', 'timeout')
     ORDER BY created_at DESC, id DESC 
     LIMIT 50`,
    [teamId]
  );

  // 5. second page of keyset pagination
  // Fetch cursor from page 1 first
  const page1Res = await pool.query(
    `SELECT created_at, id FROM work_items 
     WHERE team_id = $1 
     ORDER BY created_at DESC, id DESC 
     LIMIT 50`,
    [teamId]
  );
  const cursorItem = page1Res.rows[page1Res.rows.length - 1];

  await explainQuery(
    'Keyset Pagination (Page 2)',
    `SELECT * FROM work_items 
     WHERE team_id = $1 AND (created_at, id) < ($2, $3)
     ORDER BY created_at DESC, id DESC 
     LIMIT 50`,
    [teamId, cursorItem.created_at, cursorItem.id]
  );

  // Summary Table
  console.log('\n======================================================');
  console.log('EXPLAIN ANALYZE SUMMARY (50,000 ROWS)');
  console.log('======================================================');
  for (const r of results) {
    console.log(`${r.queryName.padEnd(30)} | ${r.scanType.padEnd(15)} | ${r.executionTimeMs.toFixed(3)} ms`);
  }
  console.log('======================================================\n');

  // 4. Reseed back to 5,000 items as specified
  console.log('[Step 4] Reseeding database back to 5,000 items...');
  await seedDatabase(pool, 5000);
  console.log('✓ Successfully reseeded back to 5,000 items.\n');

  await pool.end();
}

runScaleCheck().catch((err) => {
  console.error('Scale check failed:', err);
  process.exit(1);
});
