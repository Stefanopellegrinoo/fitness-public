import { z } from 'zod';
import { ValidationError } from '../middlewares/error.middleware';

// Schema para email (validación formato, longitud)
export const emailSchema = z.string()
  .email('Email inválido')
  .min(5, 'El email debe tener al menos 5 caracteres')
  .max(100, 'El email no puede exceder 100 caracteres');

// Schema para password (mínimo 8 chars, requisitos seguridad)
export const passwordSchema = z.string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .regex(/[A-Z]/, 'La contraseña debe contener al menos una letra mayúscula')
  .regex(/[a-z]/, 'La contraseña debe contener al menos una letra minúscula')
  .regex(/[0-9]/, 'La contraseña debe contener al menos un número')
  .regex(/[^A-Za-z0-9]/, 'La contraseña debe contener al menos un carácter especial')
  .max(100, 'La contraseña no puede exceder 100 caracteres');

// Schema para nombre opcional
export const optionalNameSchema = z.string()
  .min(2, 'El nombre debe tener al menos 2 caracteres')
  .max(50, 'El nombre no puede exceder 50 caracteres')
  .optional();

// Schema para creación usuario (email, password, nombre opcional)
export const createUserSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: optionalNameSchema,
});

// Schema para actualización usuario (campos opcionales)
export const updateUserSchema = z.object({
  email: emailSchema.optional(),
  password: passwordSchema.optional(),
  name: optionalNameSchema,
}).refine(data => Object.keys(data).length > 0, {
  message: 'Al menos un campo debe ser proporcionado para actualizar',
});

// Tipos inferidos para TypeScript
export type EmailSchema = z.infer<typeof emailSchema>;
export type PasswordSchema = z.infer<typeof passwordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// Función helper para validar (consistente con validaciones existentes)
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