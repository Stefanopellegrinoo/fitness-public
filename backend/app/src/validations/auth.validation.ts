import { z } from 'zod';
import { ValidationError } from '../middlewares/error.middleware';
import { Request, Response, NextFunction } from 'express';
import { passwordSchema, emailSchema } from './password.validation';

// Schema para registro de usuario (usa passwordSchema centralizado)
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(2, 'El nombre debe tener al menos 2 caracteres').optional(),
});

// Schema para login
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'La contraseña es requerida'),
});

// Schema para cambio de contraseña (usa passwordSchema centralizado)
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'La contraseña actual es requerida'),
  newPassword: passwordSchema,
});

// Tipo inferido para TypeScript
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Validates authentication input data
 */
export function validate<T extends z.ZodType<any, any>>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);

  if (!result.success) {
    const errors = result.error.issues.reduce((acc, err) => {
      const path = err.path.join('.');
      if (!acc[path]) {
        acc[path] = [];
      }
      acc[path].push(err.message);
      return acc;
    }, {} as Record<string, string[]>);

    throw new ValidationError('Validation failed', errors);
  }

  return result.data;
}

/**
 * Middleware factory for validating auth endpoints
 * Usage: validateAuthInput('register'), validateAuthInput('login')
 */
export function validateAuthInput(type: 'register' | 'login' | 'changePassword') {
  const schema =
    type === 'register'
      ? registerSchema
      : type === 'login'
        ? loginSchema
        : changePasswordSchema;

  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = validate(schema, req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}
