import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { config } from '../src/config';

export const testDbUrl = 'postgresql://ops:ops@localhost:5433/ops_test';

export const testPool = new Pool({
  connectionString: testDbUrl,
  max: 20,
});

export async function truncateDb(): Promise<void> {
  await testPool.query(`
    TRUNCATE TABLE 
      notifications,
      outbox_jobs,
      comments,
      activity_events,
      idempotency_keys,
      work_items,
      memberships,
      teams,
      users
    RESTART IDENTITY CASCADE;
  `);
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  token: string;
  teamId: string;
  role: 'viewer' | 'member' | 'lead' | 'admin';
}

export interface TestEnvironment {
  teamPaymentsId: string;
  teamSupportId: string;
  admin: TestUser;
  paymentsLead: TestUser;
  paymentsMember1: TestUser;
  paymentsMember2: TestUser;
  paymentsViewer: TestUser;
  supportLead: TestUser;
  supportMember: TestUser;
}

export async function seedTestEnv(): Promise<TestEnvironment> {
  await truncateDb();

  const passwordHash = await bcrypt.hash('Demo@12345', 1);

  // Create teams
  const paymentsRes = await testPool.query(
    "INSERT INTO teams (name) VALUES ('Payments Ops') RETURNING id"
  );
  const teamPaymentsId = paymentsRes.rows[0].id;

  const supportRes = await testPool.query(
    "INSERT INTO teams (name) VALUES ('Customer Support') RETURNING id"
  );
  const teamSupportId = supportRes.rows[0].id;

  async function createUser(
    email: string,
    name: string,
    memberships: { teamId: string; role: 'viewer' | 'member' | 'lead' | 'admin' }[]
  ): Promise<TestUser> {
    const uRes = await testPool.query(
      'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [email, name, passwordHash]
    );
    const id = uRes.rows[0].id;

    for (const m of memberships) {
      await testPool.query(
        'INSERT INTO memberships (user_id, team_id, role) VALUES ($1, $2, $3)',
        [id, m.teamId, m.role]
      );
    }

    const token = jwt.sign({ userId: id }, config.jwtSecret, { expiresIn: '8h' });
    return {
      id,
      email,
      name,
      token,
      teamId: memberships[0].teamId,
      role: memberships[0].role,
    };
  }

  const admin = await createUser('admin@demo.dev', 'Alice Admin', [
    { teamId: teamPaymentsId, role: 'admin' },
    { teamId: teamSupportId, role: 'admin' },
  ]);

  const paymentsLead = await createUser('lead.payments@demo.dev', 'Liam Payments', [
    { teamId: teamPaymentsId, role: 'lead' },
  ]);

  const paymentsMember1 = await createUser('member.payments@demo.dev', 'Mason Payments', [
    { teamId: teamPaymentsId, role: 'member' },
  ]);

  const paymentsMember2 = await createUser('member2.payments@demo.dev', 'Marcus Payments', [
    { teamId: teamPaymentsId, role: 'member' },
  ]);

  const paymentsViewer = await createUser('viewer@demo.dev', 'Victor Viewer', [
    { teamId: teamPaymentsId, role: 'viewer' },
  ]);

  const supportLead = await createUser('lead.support@demo.dev', 'Sophia Support', [
    { teamId: teamSupportId, role: 'lead' },
  ]);

  const supportMember = await createUser('member.support@demo.dev', 'Mia Support', [
    { teamId: teamSupportId, role: 'member' },
  ]);

  return {
    teamPaymentsId,
    teamSupportId,
    admin,
    paymentsLead,
    paymentsMember1,
    paymentsMember2,
    paymentsViewer,
    supportLead,
    supportMember,
  };
}
