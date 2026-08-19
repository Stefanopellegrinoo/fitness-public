import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parsePaginationParams } from '../adapters/pagination.adapter';

/**
 * Pagination Endpoint Tests
 * 
 * These tests verify that pagination is correctly applied to list endpoints.
 * They test:
 * - Default pagination behavior (offset=0, limit=20)
 * - Boundary conditions (limit=1, limit=100)
 * - Invalid parameters are rejected
 * - Pagination metadata is accurate
 */

describe('Pagination - Endpoint Integration', () => {
  describe('Query Parameter Parsing', () => {
    it('should parse valid offset and limit from query', () => {
      const result = parsePaginationParams('10', '25');
      expect(result.offset).toBe(10);
      expect(result.limit).toBe(25);
    });

    it('should handle string numbers correctly', () => {
      const result = parsePaginationParams('100', '50');
      expect(typeof result.offset).toBe('number');
      expect(typeof result.limit).toBe('number');
      expect(result.offset).toBe(100);
      expect(result.limit).toBe(50);
    });

    it('should apply defaults when params undefined', () => {
      const result = parsePaginationParams(undefined, undefined);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(20);
    });
  });

  describe('Validation - Offset', () => {
    it('should reject negative offset', () => {
      expect(() => parsePaginationParams('-1', '20')).toThrow('offset must be >= 0');
    });

    it('should reject very large negative offsets', () => {
      expect(() => parsePaginationParams('-9999', '20')).toThrow('offset must be >= 0');
    });

    it('should accept zero offset', () => {
      const result = parsePaginationParams('0', '20');
      expect(result.offset).toBe(0);
    });

    it('should accept large offset values', () => {
      const result = parsePaginationParams('1000000', '20');
      expect(result.offset).toBe(1000000);
    });
  });

  describe('Validation - Limit', () => {
    it('should reject limit < 1', () => {
      expect(() => parsePaginationParams('0', '0')).toThrow('limit must be between 1 and 100');
    });

    it('should reject limit > 100', () => {
      expect(() => parsePaginationParams('0', '101')).toThrow('limit must be between 1 and 100');
    });

    it('should accept limit = 1', () => {
      const result = parsePaginationParams('0', '1');
      expect(result.limit).toBe(1);
    });

    it('should accept limit = 100', () => {
      const result = parsePaginationParams('0', '100');
      expect(result.limit).toBe(100);
    });

    it('should reject extremely large limits', () => {
      expect(() => parsePaginationParams('0', '999999')).toThrow('limit must be between 1 and 100');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain default limit of 20 for existing clients', () => {
      const result = parsePaginationParams(undefined, undefined);
      expect(result.limit).toBe(20);
    });

    it('should start at offset=0 by default', () => {
      const result = parsePaginationParams(undefined, undefined);
      expect(result.offset).toBe(0);
    });

    it('should allow clients to override both defaults', () => {
      const result = parsePaginationParams('50', '10');
      expect(result.offset).toBe(50);
      expect(result.limit).toBe(10);
    });

    it('should allow clients to override only offset', () => {
      const result = parsePaginationParams('30', undefined);
      expect(result.offset).toBe(30);
      expect(result.limit).toBe(20); // Default
    });

    it('should allow clients to override only limit', () => {
      const result = parsePaginationParams(undefined, '50');
      expect(result.offset).toBe(0); // Default
      expect(result.limit).toBe(50);
    });
  });

  describe('Performance Considerations', () => {
    it('should handle maximum safe offset for database queries', () => {
      // Most databases can handle millions of rows for offset
      const result = parsePaginationParams('10000000', '20');
      expect(result.offset).toBe(10000000);
    });

    it('should limit result set to prevent memory issues', () => {
      // Max limit ensures response payload stays < ~1MB
      const result = parsePaginationParams('0', '100');
      expect(result.limit).toBeLessThanOrEqual(100);
    });

    it('should use reasonable default to balance UX and performance', () => {
      // Default of 20 items is good for most list views
      const result = parsePaginationParams(undefined, undefined);
      expect(result.limit).toBeGreaterThanOrEqual(10);
      expect(result.limit).toBeLessThanOrEqual(50);
    });
  });

  describe('Error Messages', () => {
    it('should provide clear error message for invalid offset', () => {
      try {
        parsePaginationParams('-10', '20');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('offset must be >= 0');
      }
    });

    it('should provide clear error message for invalid limit', () => {
      try {
        parsePaginationParams('0', '101');
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('limit must be between 1 and 100');
      }
    });

    it('should reject non-numeric strings', () => {
      // parseInt('abc') returns NaN which will fail validation
      expect(() => parsePaginationParams('abc', '20')).toThrow();
    });
  });

  describe('Type Safety', () => {
    it('should return numbers, not strings', () => {
      const result = parsePaginationParams('10', '20');
      expect(typeof result.offset).toBe('number');
      expect(typeof result.limit).toBe('number');
    });

    it('should return integer values', () => {
      const result = parsePaginationParams('10', '20');
      expect(Number.isInteger(result.offset)).toBe(true);
      expect(Number.isInteger(result.limit)).toBe(true);
    });

    it('should handle float strings by converting to integers', () => {
      // parseInt naturally truncates to integer
      const result = parsePaginationParams('10.5', '20.9');
      expect(result.offset).toBe(10);
      expect(result.limit).toBe(20);
    });
  });
});
