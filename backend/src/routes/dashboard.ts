import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth';
import { getDashboardCounts } from '../services/items';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * GET /api/dashboard
 * Returns count of items across the three critical views for the authenticated user.
 */
dashboardRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const counts = await getDashboardCounts(user);
    res.json(counts);
  } catch (err) {
    next(err);
  }
});
