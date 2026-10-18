import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly current?: unknown;

  constructor(statusCode: number, code: string, message: string, current?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.current = current;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function badRequest(message: string, code = 'VALIDATION_ERROR'): AppError {
  return new AppError(400, code, message);
}

export function unauthorized(message = 'Unauthenticated', code = 'UNAUTHENTICATED'): AppError {
  return new AppError(401, code, message);
}

export function forbidden(message = 'Forbidden', code = 'FORBIDDEN'): AppError {
  return new AppError(403, code, message);
}

export function notFound(message = 'Not Found', code = 'NOT_FOUND'): AppError {
  return new AppError(404, code, message);
}

export function conflict(message: string, code: string, current?: unknown): AppError {
  return new AppError(409, code, message, current);
}

export function unprocessable(message: string, code = 'UNPROCESSABLE_ENTITY'): AppError {
  return new AppError(422, code, message);
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const errorBody: { code: string; message: string; current?: unknown } = {
      code: err.code,
      message: err.message,
    };
    if (err.current !== undefined) {
      errorBody.current = err.current;
    }
    res.status(err.statusCode).json({ error: errorBody });
    return;
  }

  console.error('Unhandled server error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}
