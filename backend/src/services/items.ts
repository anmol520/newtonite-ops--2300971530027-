import { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { UserContext } from '../middleware/auth';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../middleware/error';
import { can, getAllowedActions } from './permissions';
import { isValidTransition, requiresReason, getTransitionOutboxJobType } from './workflow';
import { logActivityEvent } from './activity';
import { enqueueOutboxJob } from './outbox';

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  type: 'incident' | 'customer_issue' | 'payment' | 'compliance' | 'task';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'awaiting_approval' | 'resolved' | 'closed';
  team_id: string;
  team_name?: string;
  assignee_id: string | null;
  assignee_name?: string | null;
  created_by: string;
  created_by_name?: string;
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  allowedActions?: ReturnType<typeof getAllowedActions>;
}

export interface CreateItemInput {
  title: string;
  description?: string;
  type: WorkItem['type'];
  priority: WorkItem['priority'];
  teamId: string;
  dueDate?: string | null;
}

export interface UpdateItemInput {
  version: number;
  title?: string;
  description?: string;
  priority?: WorkItem['priority'];
  dueDate?: string | null;
}

export interface CursorPayload {
  createdAt: string;
  id: string;
}

/**
 * Encodes keyset cursor (created_at DESC, id DESC) to base64 string.
 */
export function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64');
}

/**
 * Decodes base64 string keyset cursor.
 */
export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const raw = Buffer.from(cursor, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed.createdAt && parsed.id) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Formats a raw database row into a WorkItem and attaches allowedActions computed by permissions.can()
 */
export function formatItemWithActions(row: any, user: UserContext): WorkItem {
  const item: WorkItem = {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    priority: row.priority,
    status: row.status,
    team_id: row.team_id,
    team_name: row.team_name,
    assignee_id: row.assignee_id,
    assignee_name: row.assignee_name,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    due_date: row.due_date ? new Date(row.due_date).toISOString() : null,
    version: row.version,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
  };

  item.allowedActions = getAllowedActions(user, item);
  return item;
}

/**
 * Fetches an item by ID within a client or global pool.
 */
export async function getItemById(
  id: string,
  user: UserContext,
  client?: PoolClient
): Promise<WorkItem> {
  const runner = client || pool;
  const query = `
    SELECT 
      wi.*,
      t.name AS team_name,
      au.name AS assignee_name,
      cu.name AS created_by_name
    FROM work_items wi
    JOIN teams t ON wi.team_id = t.id
    LEFT JOIN users au ON wi.assignee_id = au.id
    LEFT JOIN users cu ON wi.created_by = cu.id
    WHERE wi.id = $1;
  `;
  const result = await runner.query(query, [id]);
  if (result.rows.length === 0) {
    throw notFound('Work item not found');
  }

  const row = result.rows[0];

  // Authorization check: Prevents horizontal privilege escalation.
  // A user outside the item's team gets 403 on every read and write.
  if (!can(user, 'read', row)) {
    throw forbidden('You do not have access to this team item');
  }

  return formatItemWithActions(row, user);
}

/**
 * Creates a new work item inside a single database transaction.
 * Concurrency / Auth note: Validates team membership permissions via can() before inserting.
 * Atomically inserts the item and its initial CREATED activity_event.
 */
export async function createItem(
  client: PoolClient,
  user: UserContext,
  input: CreateItemInput
): Promise<WorkItem> {
  // Authorization check: Verify user is allowed to create in target team
  if (!can(user, 'create', { team_id: input.teamId })) {
    throw forbidden('You do not have permission to create items in this team');
  }

  const dueDate = input.dueDate ? new Date(input.dueDate).toISOString() : null;

  const insertQuery = `
    INSERT INTO work_items (
      title, 
      description, 
      type, 
      priority, 
      status, 
      team_id, 
      created_by, 
      due_date, 
      version
    )
    VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, 1)
    RETURNING *;
  `;

  const itemRes = await client.query(insertQuery, [
    input.title,
    input.description || '',
    input.type,
    input.priority,
    input.teamId,
    user.id,
    dueDate,
  ]);

  const row = itemRes.rows[0];

  // Atomicity: State changes must insert activity_events in the same transaction
  await logActivityEvent(client, row.id, user.id, 'CREATED', {
    title: row.title,
    type: row.type,
    priority: row.priority,
    team_id: row.team_id,
  });

  return getItemById(row.id, user, client);
}

/**
 * Updates mutable fields of an item using optimistic concurrency control.
 * Concurrency note: UPDATE ... WHERE id=$1 AND version=$2 SET version=version+1
 * prevents lost updates when two clients edit concurrently.
 */
export async function updateItem(
  client: PoolClient,
  user: UserContext,
  itemId: string,
  input: UpdateItemInput
): Promise<WorkItem> {
  // Fetch latest row for permission and conflict comparisons
  const current = await getItemById(itemId, user, client);

  // Authorization check: Prevents unauthorized edits and modifications to closed items
  if (!can(user, 'edit', current)) {
    throw forbidden('You do not have permission to edit this work item');
  }

  const newTitle = input.title ?? current.title;
  const newDescription = input.description ?? current.description;
  const newPriority = input.priority ?? current.priority;
  const newDueDate = input.dueDate !== undefined ? input.dueDate : current.due_date;

  const updateQuery = `
    UPDATE work_items
    SET title = $1,
        description = $2,
        priority = $3,
        due_date = $4,
        version = version + 1,
        updated_at = now()
    WHERE id = $5 AND version = $6
    RETURNING *;
  `;

  const result = await client.query(updateQuery, [
    newTitle,
    newDescription,
    newPriority,
    newDueDate,
    itemId,
    input.version,
  ]);

  if (result.rows.length === 0) {
    // Concurrency conflict: Version mismatch. Return 409 VERSION_CONFLICT with latest current state.
    // Nothing is written and no event is logged.
    const latest = await getItemById(itemId, user, client);
    throw conflict('Item version conflict', 'VERSION_CONFLICT', latest);
  }

  // Atomicity: Log one activity event per changed field
  if (input.title !== undefined && input.title !== current.title) {
    await logActivityEvent(client, itemId, user.id, 'TITLE_CHANGED', {
      from: current.title,
      to: input.title,
    });
  }
  if (input.description !== undefined && input.description !== current.description) {
    await logActivityEvent(client, itemId, user.id, 'DESCRIPTION_CHANGED', {
      from: current.description,
      to: input.description,
    });
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    await logActivityEvent(client, itemId, user.id, 'PRIORITY_CHANGED', {
      from: current.priority,
      to: input.priority,
    });
  }
  if (input.dueDate !== undefined && input.dueDate !== current.due_date) {
    await logActivityEvent(client, itemId, user.id, 'DUE_DATE_CHANGED', {
      from: current.due_date,
      to: input.dueDate,
    });
  }

  return getItemById(itemId, user, client);
}

/**
 * Claims an unassigned work item atomically.
 * Concurrency guarantee:
 * Conditional UPDATE ... WHERE id=$1 AND assignee_id IS NULL AND status IN ('open','in_progress')
 * ensures that under high concurrency, exactly one worker succeeds in claiming the item.
 * All competing concurrent requests update 0 rows and receive 409 ALREADY_CLAIMED.
 */
export async function claimItem(
  client: PoolClient,
  user: UserContext,
  itemId: string
): Promise<WorkItem> {
  const current = await getItemById(itemId, user, client);

  // Authorization check: Verify caller has role permission (member/lead/admin) to claim in this team.
  // Viewers or users outside the team receive 403 FORBIDDEN.
  if (!can(user, 'claim', { team_id: current.team_id, status: 'open', assignee_id: null })) {
    throw forbidden('You are not authorized to claim items in this team');
  }

  // Atomic conditional UPDATE prevents race conditions. Under parallel claims, exactly one
  // transaction modifies the row; all others match 0 rows and return 409 ALREADY_CLAIMED.
  const claimQuery = `
    UPDATE work_items
    SET assignee_id = $1,
        status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END,
        version = version + 1,
        updated_at = now()
    WHERE id = $2 
      AND assignee_id IS NULL 
      AND status IN ('open', 'in_progress')
    RETURNING *;
  `;

  const result = await client.query(claimQuery, [user.id, itemId]);

  if (result.rows.length === 0) {
    // Concurrency race: Another member claimed or updated the item first.
    const latest = await getItemById(itemId, user, client);
    throw conflict('Item has already been claimed or is no longer open', 'ALREADY_CLAIMED', latest);
  }

  // Atomicity: Record CLAIMED activity event in the exact same transaction
  await logActivityEvent(client, itemId, user.id, 'CLAIMED', {
    assignee_id: user.id,
    previous_status: current.status,
    new_status: result.rows[0].status,
  });

  return getItemById(itemId, user, client);
}

/**
 * Assigns or unassigns an item to a team member (lead/admin only).
 * Concurrency / Auth note: Uses optimistic version check and verifies target assignee eligibility.
 * Enqueues NOTIFY_ASSIGNEE outbox job when a new assignee is set.
 */
export async function assignItem(
  client: PoolClient,
  user: UserContext,
  itemId: string,
  newAssigneeId: string | null,
  version: number
): Promise<WorkItem> {
  const current = await getItemById(itemId, user, client);

  // Check lead/admin assignment authorization
  if (!can(user, 'assign', current)) {
    throw forbidden('Only leads or admins may assign work items');
  }

  if (newAssigneeId) {
    // Verify target assignee is a member, lead, or admin of the item's team
    const memberRes = await client.query(
      `
      SELECT role FROM memberships WHERE user_id = $1 AND team_id = $2;
      `,
      [newAssigneeId, current.team_id]
    );

    if (memberRes.rows.length === 0) {
      throw forbidden('Assignee is not a member of the team');
    }

    const targetRole = memberRes.rows[0].role;
    if (!can(user, 'assign', current, { targetMembershipRole: targetRole })) {
      throw forbidden('Assignee cannot be assigned (viewers are not eligible assignees)');
    }
  }

  const assignQuery = `
    UPDATE work_items
    SET assignee_id = $1,
        version = version + 1,
        updated_at = now()
    WHERE id = $2 AND version = $3
    RETURNING *;
  `;

  const result = await client.query(assignQuery, [newAssigneeId, itemId, version]);

  if (result.rows.length === 0) {
    const latest = await getItemById(itemId, user, client);
    throw conflict('Item version conflict during assignment', 'VERSION_CONFLICT', latest);
  }

  // Atomicity: Insert ASSIGNED activity event
  await logActivityEvent(client, itemId, user.id, 'ASSIGNED', {
    from: current.assignee_id,
    to: newAssigneeId,
  });

  // Outbox pattern: Enqueue NOTIFY_ASSIGNEE when a new assignee is designated
  if (newAssigneeId && newAssigneeId !== current.assignee_id) {
    await enqueueOutboxJob(client, 'NOTIFY_ASSIGNEE', {
      itemId,
      teamId: current.team_id,
      assigneeId: newAssigneeId,
      assignedBy: user.id,
      title: current.title,
    });
  }

  return getItemById(itemId, user, client);
}

/**
 * Performs a workflow state transition with strict optimistic and state machine checks.
 * Concurrency / State Machine note: Conditional on BOTH version and expected current status.
 * Prevents race conditions where two clients transition an item concurrently.
 */
export async function transitionItem(
  client: PoolClient,
  user: UserContext,
  itemId: string,
  toStatus: string,
  version: number,
  reason?: string
): Promise<WorkItem> {
  const current = await getItemById(itemId, user, client);

  // 1. Validate workflow state machine jump
  if (!isValidTransition(current.status, toStatus)) {
    throw unprocessable(
      `Invalid transition from '${current.status}' to '${toStatus}'`,
      'INVALID_TRANSITION'
    );
  }

  // 2. Reason validation for rejections and reopenings
  if (requiresReason(current.status, toStatus) && (!reason || reason.trim() === '')) {
    throw badRequest('Reason is required for this status transition', 'REASON_REQUIRED');
  }

  // 3. Authorization check via permissions.can()
  if (!can(user, 'transition', current, { to: toStatus })) {
    throw forbidden('You are not authorized to perform this transition');
  }

  // 4. Atomic conditional update on both version and current status
  const transitionQuery = `
    UPDATE work_items
    SET status = $1,
        version = version + 1,
        updated_at = now()
    WHERE id = $2 AND version = $3 AND status = $4
    RETURNING *;
  `;

  const result = await client.query(transitionQuery, [
    toStatus,
    itemId,
    version,
    current.status,
  ]);

  if (result.rows.length === 0) {
    const latest = await getItemById(itemId, user, client);
    if (latest.status !== current.status) {
      throw conflict(
        'Item status was updated concurrently by another request',
        'STATUS_CONFLICT',
        latest
      );
    }
    throw conflict('Item version conflict', 'VERSION_CONFLICT', latest);
  }

  // 5. Atomicity: Insert STATUS_CHANGED activity event
  await logActivityEvent(client, itemId, user.id, 'STATUS_CHANGED', {
    from: current.status,
    to: toStatus,
    reason: reason || null,
  });

  // 6. Enqueue corresponding outbox notification job if required
  const jobType = getTransitionOutboxJobType(current.status, toStatus);
  if (jobType === 'NOTIFY_APPROVERS') {
    await enqueueOutboxJob(client, 'NOTIFY_APPROVERS', {
      itemId,
      teamId: current.team_id,
      actorId: user.id,
      title: current.title,
    });
  } else if (jobType === 'NOTIFY_ASSIGNEE') {
    if (current.assignee_id) {
      await enqueueOutboxJob(client, 'NOTIFY_ASSIGNEE', {
        itemId,
        teamId: current.team_id,
        assigneeId: current.assignee_id,
        actorId: user.id,
        newStatus: toStatus,
        reason: reason || null,
        title: current.title,
      });
    }
  }

  return getItemById(itemId, user, client);
}

export interface ListItemsFilter {
  view?: string;
  status?: string;
  priority?: string;
  type?: string;
  teamId?: string;
  assignee?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Keyset-paginated item search and filtering scoped exclusively to the user's teams.
 * Concurrency / Scope note: Enforces that queries never leave user's authorized teams.
 */
export async function listItems(
  user: UserContext,
  filter: ListItemsFilter
): Promise<{ items: WorkItem[]; nextCursor: string | null }> {
  const userTeamIds = user.memberships.map((m) => m.teamId);

  // If user belongs to no teams, return empty immediately
  if (userTeamIds.length === 0) {
    return { items: [], nextCursor: null };
  }

  // Authorization check: A teamId outside the user's teams returns 403
  if (filter.teamId) {
    if (!userTeamIds.includes(filter.teamId)) {
      throw forbidden('You do not belong to the requested team');
    }
  }

  const scopedTeamIds = filter.teamId ? [filter.teamId] : userTeamIds;

  const conditions: string[] = ['wi.team_id = ANY($1)'];
  const values: unknown[] = [scopedTeamIds];
  let paramIdx = 2;

  // Predefined Views
  if (filter.view === 'assigned_to_me') {
    conditions.push(`wi.assignee_id = $${paramIdx++}`);
    values.push(user.id);
    conditions.push(`wi.status NOT IN ('resolved', 'closed')`);
  } else if (filter.view === 'unassigned_urgent') {
    conditions.push(`wi.assignee_id IS NULL`);
    conditions.push(`wi.priority = 'urgent'`);
    conditions.push(`wi.status NOT IN ('resolved', 'closed')`);
  } else if (filter.view === 'awaiting_my_approval') {
    // Teams where user is lead or admin
    const leadOrAdminTeams = user.memberships
      .filter((m) => m.role === 'lead' || m.role === 'admin')
      .map((m) => m.teamId)
      .filter((tid) => scopedTeamIds.includes(tid));

    const adminTeams = user.memberships
      .filter((m) => m.role === 'admin')
      .map((m) => m.teamId)
      .filter((tid) => scopedTeamIds.includes(tid));

    const leadTeams = user.memberships
      .filter((m) => m.role === 'lead')
      .map((m) => m.teamId)
      .filter((tid) => scopedTeamIds.includes(tid));

    if (leadOrAdminTeams.length === 0) {
      return { items: [], nextCursor: null };
    }

    conditions.push(`wi.status = 'awaiting_approval'`);

    // Admin can approve all items in their team; lead cannot approve items assigned to themselves
    const clauses: string[] = [];
    if (adminTeams.length > 0) {
      clauses.push(`wi.team_id = ANY($${paramIdx++})`);
      values.push(adminTeams);
    }
    if (leadTeams.length > 0) {
      clauses.push(`(wi.team_id = ANY($${paramIdx++}) AND (wi.assignee_id IS NULL OR wi.assignee_id != $${paramIdx++}))`);
      values.push(leadTeams);
      values.push(user.id);
    }
    conditions.push(`(${clauses.join(' OR ')})`);
  }

  // Explicit filters
  if (filter.status) {
    conditions.push(`wi.status = $${paramIdx++}`);
    values.push(filter.status);
  }
  if (filter.priority) {
    conditions.push(`wi.priority = $${paramIdx++}`);
    values.push(filter.priority);
  }
  if (filter.type) {
    conditions.push(`wi.type = $${paramIdx++}`);
    values.push(filter.type);
  }

  if (filter.assignee) {
    if (filter.assignee === 'me') {
      conditions.push(`wi.assignee_id = $${paramIdx++}`);
      values.push(user.id);
    } else if (filter.assignee === 'unassigned') {
      conditions.push(`wi.assignee_id IS NULL`);
    } else {
      conditions.push(`wi.assignee_id = $${paramIdx++}`);
      values.push(filter.assignee);
    }
  }

  // Full-text search with websearch_to_tsquery
  if (filter.q && filter.q.trim()) {
    conditions.push(`wi.search_vector @@ websearch_to_tsquery('english', $${paramIdx++})`);
    values.push(filter.q.trim());
  }

  // Keyset cursor pagination (created_at DESC, id DESC)
  if (filter.cursor) {
    const decoded = decodeCursor(filter.cursor);
    if (decoded) {
      conditions.push(`(wi.created_at < $${paramIdx++} OR (wi.created_at = $${paramIdx++} AND wi.id < $${paramIdx++}))`);
      values.push(decoded.createdAt);
      values.push(decoded.createdAt);
      values.push(decoded.id);
    }
  }

  const limit = Math.min(Math.max(1, filter.limit || 25), 100);
  values.push(limit + 1);
  const limitParam = `$${paramIdx++}`;

  const query = `
    SELECT 
      wi.*,
      t.name AS team_name,
      au.name AS assignee_name,
      cu.name AS created_by_name
    FROM work_items wi
    JOIN teams t ON wi.team_id = t.id
    LEFT JOIN users au ON wi.assignee_id = au.id
    LEFT JOIN users cu ON wi.created_by = cu.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY wi.created_at DESC, wi.id DESC
    LIMIT ${limitParam};
  `;

  const result = await pool.query(query, values);
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

  let nextCursor: string | null = null;
  if (hasMore && rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    nextCursor = encodeCursor(
      new Date(lastRow.created_at).toISOString(),
      lastRow.id
    );
  }

  const items = rows.map((r: any) => formatItemWithActions(r, user));

  return {
    items,
    nextCursor,
  };
}

/**
 * Returns dashboard counts for the 3 system views:
 * 1. assigned_to_me
 * 2. unassigned_urgent
 * 3. awaiting_my_approval
 */
export async function getDashboardCounts(user: UserContext): Promise<{
  assignedToMe: number;
  unassignedUrgent: number;
  awaitingMyApproval: number;
  assigned_to_me: number;
  unassigned_urgent: number;
  awaiting_my_approval: number;
}> {
  const userTeamIds = user.memberships.map((m) => m.teamId);
  if (userTeamIds.length === 0) {
    return {
      assignedToMe: 0,
      unassignedUrgent: 0,
      awaitingMyApproval: 0,
      assigned_to_me: 0,
      unassigned_urgent: 0,
      awaiting_my_approval: 0,
    };
  }

  // 1. assigned_to_me
  const assignedRes = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM work_items
    WHERE team_id = ANY($1)
      AND assignee_id = $2
      AND status NOT IN ('resolved', 'closed');
    `,
    [userTeamIds, user.id]
  );

  // 2. unassigned_urgent
  const urgentRes = await pool.query(
    `
    SELECT COUNT(*)::int AS count
    FROM work_items
    WHERE team_id = ANY($1)
      AND assignee_id IS NULL
      AND priority = 'urgent'
      AND status NOT IN ('resolved', 'closed');
    `,
    [userTeamIds]
  );

  // 3. awaiting_my_approval
  const adminTeams = user.memberships.filter((m) => m.role === 'admin').map((m) => m.teamId);
  const leadTeams = user.memberships.filter((m) => m.role === 'lead').map((m) => m.teamId);

  let awaitingCount = 0;
  if (adminTeams.length > 0 || leadTeams.length > 0) {
    const awaitingClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (adminTeams.length > 0) {
      awaitingClauses.push(`team_id = ANY($${idx++})`);
      values.push(adminTeams);
    }
    if (leadTeams.length > 0) {
      awaitingClauses.push(`(team_id = ANY($${idx++}) AND (assignee_id IS NULL OR assignee_id != $${idx++}))`);
      values.push(leadTeams);
      values.push(user.id);
    }

    const awaitingRes = await pool.query(
      `
      SELECT COUNT(*)::int AS count
      FROM work_items
      WHERE status = 'awaiting_approval'
        AND (${awaitingClauses.join(' OR ')});
      `,
      values
    );
    awaitingCount = awaitingRes.rows[0].count;
  }

  const assignedToMe = assignedRes.rows[0].count;
  const unassignedUrgent = urgentRes.rows[0].count;
  const awaitingMyApproval = awaitingCount;

  return {
    assignedToMe,
    unassignedUrgent,
    awaitingMyApproval,
    assigned_to_me: assignedToMe,
    unassigned_urgent: unassignedUrgent,
    awaiting_my_approval: awaitingMyApproval,
  };
}
