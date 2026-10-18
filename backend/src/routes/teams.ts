import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/auth';
import { forbidden } from '../middleware/error';

export const teamsRouter = Router();

teamsRouter.use(requireAuth);

/**
 * GET /api/teams
 * Returns current user's teams with their assigned roles.
 */
teamsRouter.get('/', (req: Request, res: Response) => {
  const user = req.user!;
  const teams = user.memberships.map((m) => ({
    id: m.teamId,
    name: m.teamName,
    role: m.role,
  }));
  res.json(teams);
});

/**
 * GET /api/teams/:id/members
 * Returns all members of a specific team.
 * Authorization check: Only callers who belong to that team can view its members.
 */
teamsRouter.get('/:id/members', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    const teamId = req.params.id;

    const isMember = user.memberships.some((m) => m.teamId === teamId);
    if (!isMember) {
      throw forbidden('You do not belong to this team');
    }

    const query = `
      SELECT 
        u.id, 
        u.email, 
        u.name, 
        m.role
      FROM memberships m
      JOIN users u ON m.user_id = u.id
      WHERE m.team_id = $1
      ORDER BY u.name ASC;
    `;

    const result = await pool.query(query, [teamId]);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});
