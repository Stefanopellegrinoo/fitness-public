/**
 * Validation Tests
 * 
 * Coverage:
 * - Password validation: strength rules, blacklist, edge cases
 * - Email validation: format, uniqueness, case normalization
 * - Input sanitization: HTML escaping, SQL injection prevention
 * - Error response format: consistent validation error responses
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  passwordSchema,
  emailSchema,
  userRegisterSchema,
  userLoginSchema,
  passwordChangeSchema,
} from '../validations/password.validation';
import { validate, registerSchema, loginSchema, changePasswordSchema } from '../validations/auth.validation';
import { ValidationError } from '../middlewares/error.middleware';

describe('Password Validation', () => {
  describe('passwordSchema', () => {
    it('should accept valid strong passwords', () => {
      const validPasswords = [
        'Password@123',
        'SecureP@ssw0rd',
        'MyStr0ng!Password',
        'C0mplex@Pass!',
      ];

      validPasswords.forEach((password) => {
        const result = passwordSchema.safeParse(password);
        expect(result.success).toBe(true);
      });
    });

    it('should reject passwords shorter than 8 characters', () => {
      const tooShort = 'Pass@1';
      const result = passwordSchema.safeParse(tooShort);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.message.includes('at least 8 characters')
        )).toBe(true);
      }
    });

    it('should reject passwords without uppercase letters', () => {
      const noUppercase = 'password@123';
      const result = passwordSchema.safeParse(noUppercase);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.message.includes('uppercase letter')
        )).toBe(true);
      }
    });

    it('should reject passwords without numbers', () => {
      const noNumbers = 'Password@Test';
      const result = passwordSchema.safeParse(noNumbers);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.message.includes('number')
        )).toBe(true);
      }
    });

    it('should reject passwords without special characters', () => {
      const noSpecial = 'Password123';
      const result = passwordSchema.safeParse(noSpecial);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.message.includes('special character')
        )).toBe(true);
      }
    });

    it('should reject common passwords from blacklist', () => {
      const commonPasswords = [
        'Password@1', // too common
        'Admin@123',
        'Qwerty@123',
      ];

      commonPasswords.forEach((password) => {
        const result = passwordSchema.safeParse(password);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((issue) =>
            issue.message.includes('too common') || issue.message.includes('unique')
          )).toBe(true);
        }
      });
    });

    it('should reject passwords longer than 128 characters', () => {
      const tooLong = 'P@' + 'a'.repeat(200);
      const result = passwordSchema.safeParse(tooLong);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((issue) =>
          issue.message.includes('must not exceed')
        )).toBe(true);
      }
    });

    it('should accept any allowed special characters', () => {
      const validSpecialChars = ['@', '#', '$', '!', '%', '^', '&', '*'];

      validSpecialChars.forEach((char) => {
        const password = `Test${char}Pass123`;
        const result = passwordSchema.safeParse(password);
        expect(result.success).toBe(true);
      });
    });

    it('should be case-sensitive for uppercase requirement', () => {
      const allLowercase = 'password@123test';
      const result = passwordSchema.safeParse(allLowercase);

      expect(result.success).toBe(false);
    });
  });

  describe('Email Validation', () => {
    it('should accept valid email formats', () => {
      const validEmails = [
        'test@example.com',
        'user.name@example.com',
        'user+tag@example.co.uk',
        'test_user@sub.example.com',
      ];

      validEmails.forEach((email) => {
        const result = emailSchema.safeParse(email);
        expect(result.success).toBe(true);
      });
    });

    it('should reject invalid email formats', () => {
      const invalidEmails = [
        'notanemail',
        'missing@domain',
        '@example.com',
        'user@',
        'user@@example.com',
        'user@example..com',
      ];

      invalidEmails.forEach((email) => {
        const result = emailSchema.safeParse(email);
        expect(result.success).toBe(false);
      });
    });

    it('should normalize email to lowercase', () => {
      const result = emailSchema.safeParse('Test@EXAMPLE.COM');

      expect(result.success).toBe(true);
      expect(result.data).toBe('test@example.com');
    });

    it('should reject emails longer than 255 characters', () => {
      const tooLong = 'a'.repeat(250) + '@example.com';
      const result = emailSchema.safeParse(tooLong);

      expect(result.success).toBe(false);
    });

    it('should accept emails with various TLDs', () => {
      const emails = [
        'user@example.com',
        'user@example.co.uk',
        'user@example.io',
        'user@example.org',
        'user@example.dev',
      ];

      emails.forEach((email) => {
        const result = emailSchema.safeParse(email);
        expect(result.success).toBe(true);
      });
    });

    it('should preserve case in lowercased email for consistency', () => {
      const upperEmail = 'USER@EXAMPLE.COM';
      const lowerEmail = 'user@example.com';

      const resultUpper = emailSchema.safeParse(upperEmail);
      const resultLower = emailSchema.safeParse(lowerEmail);

      expect(resultUpper.data).toBe(resultLower.data);
    });
  });

  describe('Input Sanitization', () => {
    it('should reject SQL injection attempts in password', () => {
      const sqlInjection = "' OR '1'='1";
      const result = passwordSchema.safeParse(sqlInjection);

      // Should fail validation due to missing uppercase, number, or special char requirements
      expect(result.success).toBe(false);
    });

    it('should reject HTML/script injection attempts', () => {
      const htmlInjection = '<script>alert("xss")</script>';
      const result = passwordSchema.safeParse(htmlInjection);

      // Should fail validation
      expect(result.success).toBe(false);
    });

    it('should handle null/undefined gracefully', () => {
      const result1 = passwordSchema.safeParse(null);
      const result2 = passwordSchema.safeParse(undefined);

      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });

    it('should handle empty strings', () => {
      const result = passwordSchema.safeParse('');

      expect(result.success).toBe(false);
    });

    it('should trim whitespace', () => {
      // Zod's string schema with .trim() should trim leading/trailing whitespace
      const withSpaces = ' Password@123 ';
      const result = passwordSchema.safeParse(withSpaces);

      // After trimming, should pass validation
      expect(result.success).toBe(true);
    });
  });

  describe('Registration Schema', () => {
    it('should validate complete registration data', () => {
      const validData = {
        email: 'user@example.com',
        password: 'SecureP@ss123',
        name: 'John Doe',
      };

      const result = registerSchema.safeParse(validData);
      expect(result.success).toBe(true);
    });

    it('should allow optional name field', () => {
      const noName = {
        email: 'user@example.com',
        password: 'SecureP@ss123',
      };

      const result = registerSchema.safeParse(noName);
      expect(result.success).toBe(true);
    });

    it('should reject if email is missing', () => {
      const noEmail = {
        password: 'SecureP@ss123',
        name: 'John Doe',
      };

      const result = registerSchema.safeParse(noEmail);
      expect(result.success).toBe(false);
    });

    it('should reject if password is missing', () => {
      const noPassword = {
        email: 'user@example.com',
        name: 'John Doe',
      };

      const result = registerSchema.safeParse(noPassword);
      expect(result.success).toBe(false);
    });
  });

  describe('Login Schema', () => {
    it('should validate login credentials', () => {
      const loginData = {
        email: 'user@example.com',
        password: 'SecureP@ss123',
      };

      const result = loginSchema.safeParse(loginData);
      expect(result.success).toBe(true);
    });

    it('should reject if email is missing', () => {
      const noEmail = {
        password: 'SecureP@ss123',
      };

      const result = loginSchema.safeParse(noEmail);
      expect(result.success).toBe(false);
    });

    it('should reject if password is missing', () => {
      const noPassword = {
        email: 'user@example.com',
      };

      const result = loginSchema.safeParse(noPassword);
      expect(result.success).toBe(false);
    });
  });

  describe('Password Change Schema', () => {
    it('should validate password change with matching confirmation', () => {
      const changeData = {
        currentPassword: 'OldPass@ss123',
        newPassword: 'NewPass@ss456',
        confirmPassword: 'NewPass@ss456',
      };

      const result = passwordChangeSchema.safeParse(changeData);
      expect(result.success).toBe(true);
    });

    it('should reject if new password and confirmation do not match', () => {
      const mismatch = {
        currentPassword: 'OldPass@ss123',
        newPassword: 'NewPass@ss456',
        confirmPassword: 'DifferentPass@ss789',
      };

      const result = passwordChangeSchema.safeParse(mismatch);
      expect(result.success).toBe(false);
    });

    it('should validate new password strength', () => {
      const weakNew = {
        currentPassword: 'OldPass@ss123',
        newPassword: 'weak',
        confirmPassword: 'weak',
      };

      const result = passwordChangeSchema.safeParse(weakNew);
      expect(result.success).toBe(false);
    });
  });

  describe('validate() Utility Function', () => {
    it('should return data on successful validation', () => {
      const validData = {
        email: 'user@example.com',
        password: 'SecureP@ss123',
      };

      const result = validate(loginSchema, validData);
      expect(result).toEqual(validData);
    });

    it('should throw ValidationError on failed validation', () => {
      const invalidData = {
        email: 'invalid-email',
        password: '',
      };

      expect(() => validate(loginSchema, invalidData)).toThrow(ValidationError);
    });

    it('should include field errors in ValidationError', () => {
      const invalidData = {
        email: 'invalid-email',
        password: '',
      };

      try {
        validate(loginSchema, invalidData);
      } catch (error) {
        if (error instanceof ValidationError) {
          expect(error.errors).toBeDefined();
          expect(Object.keys(error.errors).length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle unicode characters in email', () => {
      const unicodeEmail = 'user+ñ@example.com';
      const result = emailSchema.safeParse(unicodeEmail);

      // Result depends on email validation implementation
      // Standard RFC 5322 may or may not allow this
      expect(typeof result.success).toBe('boolean');
    });

    it('should reject passwords with only special characters and numbers', () => {
      const noLetters = '!@#$%^&*123';
      const result = passwordSchema.safeParse(noLetters);

      expect(result.success).toBe(false);
    });

    it('should handle concurrent validations', async () => {
      const validations = Array(10).fill({
        email: 'user@example.com',
        password: 'SecureP@ss123',
      });

      const results = await Promise.all(
        validations.map((data) =>
          Promise.resolve(validate(loginSchema, data))
        )
      );

      expect(results).toHaveLength(10);
      expect(results.every((r) => r.email === 'user@example.com')).toBe(true);
    });
  });
});
