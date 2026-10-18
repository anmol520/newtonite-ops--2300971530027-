import { Client, Pool } from 'pg';
import { runMigrations } from '../src/db/migrate';

export default async function globalSetup() {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL || 'postgresql://ops:ops@localhost:5434/ops_test';

  // 1. Ensure ops_test database exists
  const adminClient = new Client({
    connectionString:
      process.env.DATABASE_ADMIN_URL || 'postgresql://ops:ops@localhost:5434/postgres',
  });

  try {
    await adminClient.connect();
    const dbCheck = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = 'ops_test'"
    );
    if (dbCheck.rows.length === 0) {
      console.log("Creating test database 'ops_test'...");
      await adminClient.query('CREATE DATABASE ops_test');
    }
  } catch (err) {
    console.warn('Could not check or create ops_test database:', err);
  } finally {
    await adminClient.end();
  }

  // 2. Run migrations on ops_test
  const testPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await runMigrations(testPool);
  } finally {
    await testPool.end();
  }
}
