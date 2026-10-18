import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { pool, withTransaction } from './pool';
import { config } from '../config';

interface TeamSeed {
  id: string;
  name: string;
}

interface UserSeed {
  id: string;
  email: string;
  name: string;
  memberships: { teamName: string; role: 'viewer' | 'member' | 'lead' | 'admin' }[];
}

export async function seedDatabase(customPool?: Pool, itemCount = config.seedItems): Promise<void> {
  const p = customPool || pool;
  const client = await p.connect();

  try {
    console.log(`Starting database seed (wiping and generating ${itemCount} items)...`);

    // 1. Wipe existing data in correct dependency order
    await client.query(`
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

    // 2. Hash password once for all users
    const passwordHash = await bcrypt.hash('Demo@12345', 10);

    // 3. Insert Teams
    const teamDefs = [
      'Payments Ops',
      'Customer Support',
      'Platform Engineering',
      'Compliance',
    ];

    const teamMap = new Map<string, string>();
    for (const name of teamDefs) {
      const res = await client.query(
        'INSERT INTO teams (name) VALUES ($1) RETURNING id, name',
        [name]
      );
      teamMap.set(res.rows[0].name, res.rows[0].id);
    }

    // 4. Insert Users and Memberships
    const userDefs: UserSeed[] = [
      {
        id: '',
        email: 'admin@demo.dev',
        name: 'Alice Admin',
        memberships: [
          { teamName: 'Payments Ops', role: 'admin' },
          { teamName: 'Customer Support', role: 'admin' },
          { teamName: 'Platform Engineering', role: 'admin' },
          { teamName: 'Compliance', role: 'admin' },
        ],
      },
      {
        id: '',
        email: 'lead.payments@demo.dev',
        name: 'Liam Payments',
        memberships: [{ teamName: 'Payments Ops', role: 'lead' }],
      },
      {
        id: '',
        email: 'lead.support@demo.dev',
        name: 'Sophia Support',
        memberships: [{ teamName: 'Customer Support', role: 'lead' }],
      },
      {
        id: '',
        email: 'lead.platform@demo.dev',
        name: 'Lucas Platform',
        memberships: [{ teamName: 'Platform Engineering', role: 'lead' }],
      },
      {
        id: '',
        email: 'lead.compliance@demo.dev',
        name: 'Clara Compliance',
        memberships: [{ teamName: 'Compliance', role: 'lead' }],
      },
      {
        id: '',
        email: 'member.payments@demo.dev',
        name: 'Mason Payments',
        memberships: [{ teamName: 'Payments Ops', role: 'member' }],
      },
      {
        id: '',
        email: 'member.support@demo.dev',
        name: 'Mia Support',
        memberships: [{ teamName: 'Customer Support', role: 'member' }],
      },
      {
        id: '',
        email: 'member.platform@demo.dev',
        name: 'Noah Platform',
        memberships: [{ teamName: 'Platform Engineering', role: 'member' }],
      },
      {
        id: '',
        email: 'member.compliance@demo.dev',
        name: 'Chloe Compliance',
        memberships: [{ teamName: 'Compliance', role: 'member' }],
      },
      {
        id: '',
        email: 'member2.payments@demo.dev',
        name: 'Marcus Payments',
        memberships: [{ teamName: 'Payments Ops', role: 'member' }],
      },
      {
        id: '',
        email: 'member2.support@demo.dev',
        name: 'Maya Support',
        memberships: [{ teamName: 'Customer Support', role: 'member' }],
      },
      {
        id: '',
        email: 'viewer@demo.dev',
        name: 'Victor Viewer',
        memberships: [
          { teamName: 'Payments Ops', role: 'viewer' },
          { teamName: 'Customer Support', role: 'viewer' },
        ],
      },
      {
        id: '',
        email: 'multi@demo.dev',
        name: 'Morgan Multi',
        memberships: [
          { teamName: 'Payments Ops', role: 'lead' },
          { teamName: 'Compliance', role: 'member' },
          { teamName: 'Platform Engineering', role: 'viewer' },
        ],
      },
    ];

    const teamMembers: Record<string, string[]> = {};
    for (const teamName of teamDefs) {
      teamMembers[teamMap.get(teamName)!] = [];
    }

    const allUserIds: string[] = [];

    for (const u of userDefs) {
      const uRes = await client.query(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
        [u.email, u.name, passwordHash]
      );
      const userId = uRes.rows[0].id;
      u.id = userId;
      allUserIds.push(userId);

      for (const m of u.memberships) {
        const teamId = teamMap.get(m.teamName)!;
        await client.query(
          'INSERT INTO memberships (user_id, team_id, role) VALUES ($1, $2, $3)',
          [userId, teamId, m.role]
        );
        // Only eligible assignees (members, leads, admins)
        if (m.role !== 'viewer') {
          teamMembers[teamId].push(userId);
        }
      }
    }

    // 5. Seed Work Items & Activity History in Batches
    const types: ('incident' | 'customer_issue' | 'payment' | 'compliance' | 'task')[] = [
      'incident',
      'customer_issue',
      'payment',
      'compliance',
      'task',
    ];
    const priorities: ('low' | 'medium' | 'high' | 'urgent')[] = [
      'low',
      'medium',
      'high',
      'urgent',
    ];
    const statuses: ('open' | 'in_progress' | 'awaiting_approval' | 'resolved' | 'closed')[] = [
      'open',
      'in_progress',
      'awaiting_approval',
      'resolved',
      'closed',
    ];

    const teamIds = Array.from(teamMap.values());
    const batchSize = 500;

    console.log(`Inserting ${itemCount} work items and accountable history...`);

    for (let offset = 0; offset < itemCount; offset += batchSize) {
      const currentBatchCount = Math.min(batchSize, itemCount - offset);

      const itemValues: unknown[] = [];
      const itemPlaceholders: string[] = [];

      interface StagedItem {
        idx: number;
        status: string;
        assigneeId: string | null;
        creatorId: string;
        title: string;
        type: string;
        priority: string;
      }

      const staged: StagedItem[] = [];

      for (let i = 0; i < currentBatchCount; i++) {
        const globalIdx = offset + i;
        const teamId = teamIds[globalIdx % teamIds.length];
        const type = types[globalIdx % types.length];
        const status = statuses[globalIdx % statuses.length];
        const eligibleAssignees = teamMembers[teamId];
        const creatorId = eligibleAssignees[globalIdx % eligibleAssignees.length];

        // Ensure variety: urgent unassigned, overdue items, assigned items
        let priority = priorities[globalIdx % priorities.length];
        let assigneeId: string | null = null;

        if (status === 'open') {
          // Some open are unassigned urgent
          if (globalIdx % 5 === 0) {
            priority = 'urgent';
            assigneeId = null;
          } else if (globalIdx % 2 === 0) {
            assigneeId = eligibleAssignees[(globalIdx + 1) % eligibleAssignees.length];
          }
        } else {
          // in_progress, awaiting_approval, resolved, closed must have an assignee
          assigneeId = eligibleAssignees[(globalIdx + 1) % eligibleAssignees.length];
        }

        // Some items overdue (due date in the past)
        let dueDate: Date | null = null;
        if (globalIdx % 4 === 0) {
          dueDate = new Date(Date.now() - (globalIdx % 10 + 1) * 86400000);
        } else if (globalIdx % 3 === 0) {
          dueDate = new Date(Date.now() + (globalIdx % 10 + 1) * 86400000);
        }

        const title = `Operational ${type.replace('_', ' ')} #${globalIdx + 1}: ${priority.toUpperCase()} priority item`;
        const description = `Detailed investigation requirements and SLA tracking for operation item #${globalIdx + 1}. Team coordination required.`;

        const pIdx = i * 8;
        itemPlaceholders.push(
          `($${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7}, $${pIdx + 8})`
        );
        itemValues.push(
          title,
          description,
          type,
          priority,
          status,
          teamId,
          assigneeId,
          creatorId
        );

        staged.push({
          idx: i,
          status,
          assigneeId,
          creatorId,
          title,
          type,
          priority,
        });
      }

      // Bulk insert work items
      const insertQuery = `
        INSERT INTO work_items (
          title, description, type, priority, status, team_id, assignee_id, created_by
        )
        VALUES ${itemPlaceholders.join(', ')}
        RETURNING id;
      `;

      const insertRes = await client.query(insertQuery, itemValues);

      // Now generate consistent activity events for each inserted item
      const eventValues: unknown[] = [];
      const eventPlaceholders: string[] = [];
      let evParamIdx = 1;

      for (let i = 0; i < insertRes.rows.length; i++) {
        const itemId = insertRes.rows[i].id;
        const meta = staged[i];

        // 1. CREATED event
        eventPlaceholders.push(`($${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++})`);
        eventValues.push(
          itemId,
          meta.creatorId,
          'CREATED',
          JSON.stringify({ title: meta.title, type: meta.type, priority: meta.priority })
        );

        // 2. Progression events consistent with current status
        if (meta.assigneeId) {
          eventPlaceholders.push(`($${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++})`);
          eventValues.push(
            itemId,
            meta.assigneeId,
            'ASSIGNED',
            JSON.stringify({ from: null, to: meta.assigneeId })
          );
        }

        if (meta.status === 'in_progress' || meta.status === 'awaiting_approval' || meta.status === 'resolved' || meta.status === 'closed') {
          eventPlaceholders.push(`($${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++})`);
          eventValues.push(
            itemId,
            meta.assigneeId || meta.creatorId,
            'STATUS_CHANGED',
            JSON.stringify({ from: 'open', to: 'in_progress' })
          );
        }

        if (meta.status === 'awaiting_approval' || meta.status === 'resolved' || meta.status === 'closed') {
          eventPlaceholders.push(`($${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++})`);
          eventValues.push(
            itemId,
            meta.assigneeId || meta.creatorId,
            'STATUS_CHANGED',
            JSON.stringify({ from: 'in_progress', to: 'awaiting_approval' })
          );
        }

        if (meta.status === 'resolved' || meta.status === 'closed') {
          eventPlaceholders.push(`($${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++})`);
          eventValues.push(
            itemId,
            meta.creatorId,
            'STATUS_CHANGED',
            JSON.stringify({ from: 'awaiting_approval', to: 'resolved' })
          );
        }

        if (meta.status === 'closed') {
          eventPlaceholders.push(`($${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++}, $${evParamIdx++})`);
          eventValues.push(
            itemId,
            meta.creatorId,
            'STATUS_CHANGED',
            JSON.stringify({ from: 'resolved', to: 'closed' })
          );
        }
      }

      if (eventPlaceholders.length > 0) {
        await client.query(
          `
          INSERT INTO activity_events (item_id, actor_id, event_type, payload)
          VALUES ${eventPlaceholders.join(', ')};
          `,
          eventValues
        );
      }
    }

    console.log(`\nSuccessfully seeded ${itemCount} items!`);
    console.log('\n--- DEMO USER CREDENTIALS ---');
    console.table(
      userDefs.map((u) => ({
        Email: u.email,
        Name: u.name,
        Password: 'Demo@12345',
        Teams: u.memberships.map((m) => `${m.teamName} (${m.role})`).join(', '),
      }))
    );
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => {
      console.log('Database seed finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Database seed failed:', err);
      process.exit(1);
    });
}
