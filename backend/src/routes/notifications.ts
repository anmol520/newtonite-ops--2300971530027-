import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getNotifications, markAllAsRead } from '../services/notifications';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

/**
 * GET /api/notifications
 * Returns latest 50 notifications for the authenticated user and unread count.
 */
notificationsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const result = await getNotifications(user.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/notifications/read-all
 * Marks all pending unread notifications as read.
 */
notificationsRouter.post('/read-all', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    await markAllAsRead(user.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});
