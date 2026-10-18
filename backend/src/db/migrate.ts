import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { pool } from './pool';

export async function runMigrations(customPool?: Pool): Promise<void> {
  const p = customPool || pool;
  const client = await p.connect();

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    // Fetch already applied migrations
    const res = await client.query('SELECT name FROM schema_migrations');
    const applied = new Set(res.rows.map((r: { name: string }) => r.name));

    // Resolve migrations folder
    const migrationsDir = path.resolve(__dirname, '../../migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log(`No migrations directory found at ${migrationsDir}`);
      return;
    }

    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }

      console.log(`Applying migration: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`Successfully applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Failed to apply migration: ${file}`, err);
        throw err;
      }
    }
  } finally {
    client.release();
  }
}

// Allow direct execution
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('All migrations applied successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
