import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend directory if present
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  databaseUrl: process.env.DATABASE_URL || 'postgresql://ops:ops@localhost:5434/ops',
  jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key-for-development-change-in-production',
  port: parseInt(process.env.PORT || '4000', 10),
  workerPollMs: parseInt(process.env.WORKER_POLL_MS || '1500', 10),
  seedItems: parseInt(process.env.SEED_ITEMS || '5000', 10),
};
