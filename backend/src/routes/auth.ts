import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db/pool';
import { config } from '../config';
import { badRequest, unauthorized } from '../middleware/error';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Authenticates user credentials using bcrypt and issues an 8-hour JWT.
 */
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw badRequest('Invalid email or password format');
    }

    const { email, password } = parseResult.data;

    // Concurrency / Auth note: Parameterized SQL prevents SQL injection.
    const userResult = await pool.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      throw unauthorized('Invalid email or password');
    }

    const user = userResult.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      throw unauthorized('Invalid email or password');
    }

    const token = jwt.sign({ userId: user.id }, config.jwtSecret, {
      expiresIn: '8h',
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (err) {
    next(err);
  }
});
