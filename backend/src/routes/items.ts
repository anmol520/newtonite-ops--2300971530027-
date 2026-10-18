import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { badRequest, forbidden } from '../middleware/error';
import { withTransaction } from '../db/pool';
import { executeWithIdempotency } from '../services/idempotency';
import {
  createItem,
  getItemById,
  updateItem,
  claimItem,
  assignItem,
  transitionItem,
  listItems,
} from '../services/items';
import { getItemActivity } from '../services/activity';
import { createComment, getItemComments } from '../services/comments';
import { can } from '../services/permissions';

export const itemsRouter = Router();

itemsRouter.use(requireAuth);

const createItemSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().optional(),
  type: z.enum(['incident', 'customer_issue', 'payment', 'compliance', 'task']),
  priority: z.enum(['low', 'medium', 'high', 'urgent']),
  teamId: z.string().uuid(),
  dueDate: z.string().optional().nullable(),
});

const updateItemSchema = z.object({
  version: z.number().int().min(1),
  title: z.string().min(3).max(200).optional(),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  dueDate: z.string().optional().nullable(),
});

const commentSchema = z.object({
  body: z.string().min(1).max(2000),
});

const assignSchema = z.object({
  assigneeId: z.string().uuid().nullable(),
  version: z.number().int().min(1),
});

const transitionSchema = z.object({
  to: z.string(),
  version: z.number().int().min(1),
  reason: z.string().optional(),
});

/**
 * GET /api/items
 * Keyset-paginated search and filter scoped to caller's teams.
 */
itemsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const filter = {
      view: req.query.view as string | undefined,
      status: req.query.status as string | undefined,
      priority: req.query.priority as string | undefined,
      type: req.query.type as string | undefined,
      teamId: req.query.teamId as string | undefined,
      assignee: req.query.assignee as string | undefined,
      q: req.query.q as string | undefined,
      cursor: req.query.cursor as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };

    const result = await listItems(user, filter);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/items
 * Creates a work item.
 * Requires Idempotency-Key header to prevent duplicate creations on network retries.
 */
itemsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    // Idempotency requirement: Enforces presence of idempotency key
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw badRequest('Idempotency-Key header is required', 'MISSING_IDEMPOTENCY_KEY');
    }

    const parseResult = createItemSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw badRequest(parseResult.error.errors[0].message);
    }

    const input = parseResult.data;

    // Transactional execution: Item creation, initial activity event, and idempotency key
    // are executed in a single atomic database transaction.
    const result = await withTransaction(async (client) => {
      return executeWithIdempotency(
        client,
        user.id,
        idempotencyKey,
        req.method,
        req.baseUrl + req.path,
        req.body,
        async () => {
          const item = await createItem(client, user, input);
          return { statusCode: 201, body: item };
        }
      );
    });

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/items/:id
 * Fetches a single work item by ID with allowedActions UI hints.
 */
itemsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const item = await getItemById(req.params.id, user);
    res.json(item);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/items/:id/activity
 * Keyset-paginated activity event log for a work item.
 */
itemsRouter.get('/:id/activity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const itemId = req.params.id;

    // Authorization check: User must have read permission on the parent item
    await getItemById(itemId, user);

    const cursor = req.query.cursor as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;

    const result = await getItemActivity(itemId, cursor, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/items/:id/comments
 * Adds a comment to a work item.
 * Honours Idempotency-Key header if provided.
 */
itemsRouter.post('/:id/comments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const itemId = req.params.id;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const parseResult = commentSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw badRequest(parseResult.error.errors[0].message);
    }

    const { body } = parseResult.data;

    // Concurrency / Idempotency note: Executes in single transaction with optional idempotency
    const result = await withTransaction(async (client) => {
      return executeWithIdempotency(
        client,
        user.id,
        idempotencyKey,
        req.method,
        req.baseUrl + req.path,
        req.body,
        async () => {
          const item = await getItemById(itemId, user, client);

          // Authorization check: Only members, leads, and admins may comment
          if (!can(user, 'comment', item)) {
            throw forbidden('You do not have permission to comment on this item');
          }

          const comment = await createComment(client, itemId, user.id, body);
          return { statusCode: 201, body: comment };
        }
      );
    });

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/items/:id
 * Updates mutable fields using optimistic concurrency control on version.
 */
itemsRouter.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const itemId = req.params.id;

    const parseResult = updateItemSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw badRequest(parseResult.error.errors[0].message);
    }

    // Atomic transaction: Item update + field change activity events
    const updated = await withTransaction(async (client) => {
      return updateItem(client, user, itemId, parseResult.data);
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/items/:id/claim
 * Atomically claims an unassigned work item.
 * Honours Idempotency-Key header if provided.
 */
itemsRouter.post('/:id/claim', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const itemId = req.params.id;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const result = await withTransaction(async (client) => {
      return executeWithIdempotency(
        client,
        user.id,
        idempotencyKey,
        req.method,
        req.baseUrl + req.path,
        req.body,
        async () => {
          const claimed = await claimItem(client, user, itemId);
          return { statusCode: 200, body: claimed };
        }
      );
    });

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/items/:id/assign
 * Assigns or unassigns a work item to a team member (lead/admin only).
 * Honours Idempotency-Key header if provided.
 */
itemsRouter.post('/:id/assign', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const itemId = req.params.id;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const parseResult = assignSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw badRequest(parseResult.error.errors[0].message);
    }

    const { assigneeId, version } = parseResult.data;

    const result = await withTransaction(async (client) => {
      return executeWithIdempotency(
        client,
        user.id,
        idempotencyKey,
        req.method,
        req.baseUrl + req.path,
        req.body,
        async () => {
          const assigned = await assignItem(client, user, itemId, assigneeId, version);
          return { statusCode: 200, body: assigned };
        }
      );
    });

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/items/:id/transition
 * Advances workflow state machine with version check and enqueues outbox events.
 * Honours Idempotency-Key header if provided.
 */
itemsRouter.post('/:id/transition', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const itemId = req.params.id;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

    const parseResult = transitionSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw badRequest(parseResult.error.errors[0].message);
    }

    const { to, version, reason } = parseResult.data;

    const result = await withTransaction(async (client) => {
      return executeWithIdempotency(
        client,
        user.id,
        idempotencyKey,
        req.method,
        req.baseUrl + req.path,
        req.body,
        async () => {
          const transitioned = await transitionItem(client, user, itemId, to, version, reason);
          return { statusCode: 200, body: transitioned };
        }
      );
    });

    res.status(result.statusCode).json(result.body);
  } catch (err) {
    next(err);
  }
});
