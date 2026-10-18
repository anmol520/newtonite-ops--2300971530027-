import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import { errorHandler } from './middleware/error';
import { requireAuth } from './middleware/auth';
import { authRouter } from './routes/auth';
import { teamsRouter } from './routes/teams';
import { itemsRouter } from './routes/items';
import { dashboardRouter } from './routes/dashboard';
import { notificationsRouter } from './routes/notifications';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(express.json());

  // Mount API route groups
  app.use('/api/auth', authRouter);

  // GET /api/me returns current user and their memberships
  app.get('/api/me', requireAuth, (req: Request, res: Response) => {
    const user = req.user!;
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      memberships: user.memberships,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        memberships: user.memberships,
      },
    });
  });

  app.use('/api/teams', teamsRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/notifications', notificationsRouter);

  // Global error handling middleware
  app.use(errorHandler);

  return app;
}
