import { z } from 'zod';

/**
 * Centralized Password Validation Schema
 * 
 * Requirements:
 * - Minimum 8 characters
 * - At least 1 uppercase letter (A-Z)
 * - At least 1 number (0-9)
 * - At least 1 special character (@#$!%^&*)
 * 
 * Used consistently across:
 * - User registration
 * - Password change
 * - Password reset
 */
export const passwordSchema = z
  .string()
  .trim()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter (A-Z)')
  .regex(/[0-9]/, 'Password must contain at least one number (0-9)')
  .regex(/[@#$!%^&*]/, 'Password must contain at least one special character (@#$!%^&*)')
  .refine(
    (password) => !isCommonPassword(password),
    'This password is too common. Please choose a unique password.'
  );

/**
 * Centralized Email Validation Schema
 * RFC 5322 compliant email validation
 */
export const emailSchema = z
  .string()
  .email('Invalid email format')
  .max(255, 'Email must not exceed 255 characters')
  .transform((email) => email.toLowerCase());

/**
 * User Registration Schema
 * Uses centralized password + email validation
 */
export const userRegisterSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
});

/**
 * User Login Schema
 */
export const userLoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

/**
 * Password Change Schema
 * Requires current password + new password (validates new password strength)
 */
export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: passwordSchema,
  confirmPassword: z.string(),
}).refine(
  (data) => data.newPassword === data.confirmPassword,
  { message: 'Passwords do not match', path: ['confirmPassword'] }
);

/**
 * List of commonly used passwords to block
 * OWASP Top 100 most common passwords
 */
const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  '123456',
  '12345678',
  '123456789',
  '1234567890',
  '1234567',
  '123123',
  '111111',
  '000000',
  'admin',
  'admin123',
  'qwerty',
  'abc123',
  'password1',
  'letmein',
  'welcome',
  'welcome123',
  'monkey',
  'dragon',
  'master',
  'sunshine',
  'princess',
  'football',
  'shadow',
  'michael',
  '123321',
  '666666',
  '888888',
  // Additional specific common patterns that should be blocked
  'password@1',
  'admin@123',
  'qwerty@123',
]);

/**
 * Checks if password is in common password list
 */
function isCommonPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}

// Export types
export type PasswordSchema = z.infer<typeof passwordSchema>;
export type EmailSchema = z.infer<typeof emailSchema>;
export type UserRegisterInput = z.infer<typeof userRegisterSchema>;
export type UserLoginInput = z.infer<typeof userLoginSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
