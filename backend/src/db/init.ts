import { runMigrations } from './migrate';
import { seedDatabase } from './seed';
import { pool } from './pool';

export async function initDatabase(): Promise<void> {
  console.log('Running migrations on startup...');
  await runMigrations();

  const res = await pool.query('SELECT count(*) FROM users');
  const count = parseInt(res.rows[0].count, 10);
  if (count === 0) {
    console.log('Users table is empty. Running database seed...');
    await seedDatabase();
    console.log('Database seed completed successfully.');
  } else {
    console.log(`Users table already contains ${count} users. Skipping seed.`);
  }
}

if (require.main === module) {
  initDatabase()
    .then(() => {
      console.log('Database initialization check completed.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Database initialization failed:', err);
      process.exit(1);
    });
}
