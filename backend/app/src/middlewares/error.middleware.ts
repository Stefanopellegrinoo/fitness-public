import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { env } from '../config/env.config';

// Simple logger para desarrollo
const logger = {
  error: (data: any) => {
    console.error('ERROR:', JSON.stringify(data, null, 2));
  }
};

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;

  constructor(
    statusCode: number,
    message: string,
    isOperational: boolean = true
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date();
    
    // Capturar stack trace (excluyendo el constructor)
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  public readonly errors: Record<string, string[]>;
  
  constructor(message: string, public readonly details?: Record<string, string[]>) {
    super(400, message, true);
    // Set errors property as alias to details for backward compatibility
    this.errors = details || {};
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(401, message, true);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(403, message, true);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(404, message, true);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(409, message, true);
  }
}

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Si el error no es AppError, crear uno genérico
  const error = err instanceof AppError 
    ? err 
    : new AppError(500, 'Internal Server Error', false);

  // Logging estructurado
  logger.error({
    message: error.message,
    error: {
      name: err.name,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      code: err instanceof AppError ? err.statusCode : undefined,
      operational: err instanceof AppError ? err.isOperational : false,
    },
    request: {
      method: req.method,
      url: req.url,
      ip: req.ip,
      userId: (req as any).user?.userId,
    },
    timestamp: new Date().toISOString(),
  });

  // Formato de respuesta
  const response: Record<string, any> = {
    error: error.message,
    statusCode: error.statusCode,
    timestamp: error.timestamp,
  };

  // Agregar detalles de validación si es ValidationError
  if (err instanceof ValidationError && err.details) {
    response.details = err.details;
  }

  // En desarrollo, incluir stack trace (nunca en producción)
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
  }

  res.status(error.statusCode).json(response);
};

// Helper para manejar errores de async/await en route handlers
export const asyncHandler = <T extends (...args: any[]) => Promise<any>>(fn: T) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Middleware para manejar rutas no encontradas (404)
export const notFoundMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const error = new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`);
  next(error);
};