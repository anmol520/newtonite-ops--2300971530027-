import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/pool';
import { config } from '../config';
import { unauthorized } from './error';

export type UserRole = 'viewer' | 'member' | 'lead' | 'admin';

export interface Membership {
  teamId: string;
  teamName: string;
  role: UserRole;
}

export interface UserContext {
  id: string;
  email: string;
  name: string;
  memberships: Membership[];
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

/**
 * Middleware: requireAuth
 * Verifies JWT signature and extracts user ID.
 * Queries PostgreSQL to load the freshest user details and team memberships for the request.
 * Prevents session forgery and guarantees real-time role checks.
 */
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw unauthorized('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  let payload: { userId?: string };

  try {
    payload = jwt.verify(token, config.jwtSecret) as { userId?: string };
  } catch (err) {
    throw unauthorized('Invalid or expired token');
  }

  if (!payload.userId) {
    throw unauthorized('Invalid token payload');
  }

  // Load user profile and memberships
  const query = `
    SELECT 
      u.id, 
      u.email, 
      u.name, 
      m.team_id, 
      t.name AS team_name, 
      m.role
    FROM users u
    LEFT JOIN memberships m ON u.id = m.user_id
    LEFT JOIN teams t ON m.team_id = t.id
    WHERE u.id = $1;
  `;

  const result = await pool.query(query, [payload.userId]);
  if (result.rows.length === 0) {
    throw unauthorized('User not found');
  }

  const firstRow = result.rows[0];
  const memberships: Membership[] = [];

  for (const row of result.rows) {
    if (row.team_id) {
      memberships.push({
        teamId: row.team_id,
        teamName: row.team_name,
        role: row.role as UserRole,
      });
    }
  }

  req.user = {
    id: firstRow.id,
    email: firstRow.email,
    name: firstRow.name,
    memberships,
  };

  next();
}
