import { describe, it, expect } from 'vitest';
import {
  parsePaginationParams,
  buildPaginationMeta,
  PaginationParams,
  PaginationMeta,
} from '../adapters/pagination.adapter';

describe('Pagination Adapter', () => {
  describe('parsePaginationParams', () => {
    it('should return default pagination params when no params provided', () => {
      const result = parsePaginationParams(undefined, undefined);
      
      expect(result).toEqual({
        offset: 0,
        limit: 20,
      });
    });

    it('should parse offset and limit from string params', () => {
      const result = parsePaginationParams('10', '50');
      
      expect(result).toEqual({
        offset: 10,
        limit: 50,
      });
    });

    it('should enforce minimum offset of 0', () => {
      expect(() => parsePaginationParams('-5', '20')).toThrow('offset must be >= 0');
    });

    it('should enforce minimum limit of 1', () => {
      expect(() => parsePaginationParams('0', '0')).toThrow('limit must be between 1 and 100');
    });

    it('should enforce maximum limit of 100', () => {
      expect(() => parsePaginationParams('0', '101')).toThrow('limit must be between 1 and 100');
    });

    it('should accept valid boundary values', () => {
      const result1 = parsePaginationParams('0', '1');
      expect(result1).toEqual({ offset: 0, limit: 1 });

      const result2 = parsePaginationParams('1000', '100');
      expect(result2).toEqual({ offset: 1000, limit: 100 });
    });

    it('should coerce string params to numbers', () => {
      const result = parsePaginationParams('42', '35');
      
      expect(result.offset).toBe(42);
      expect(result.limit).toBe(35);
      expect(typeof result.offset).toBe('number');
      expect(typeof result.limit).toBe('number');
    });
  });

  describe('buildPaginationMeta', () => {
    it('should calculate pagination metadata correctly', () => {
      const result = buildPaginationMeta(0, 20, 47);
      
      expect(result).toEqual({
        offset: 0,
        limit: 20,
        total: 47,
        hasMore: true,
        pageCount: 3,
      });
    });

    it('should indicate hasMore=false when offset+limit >= total', () => {
      const result = buildPaginationMeta(40, 10, 50);
      
      expect(result).toEqual({
        offset: 40,
        limit: 10,
        total: 50,
        hasMore: false,
        pageCount: 5,
      });
    });

    it('should handle empty result set', () => {
      const result = buildPaginationMeta(0, 20, 0);
      
      expect(result).toEqual({
        offset: 0,
        limit: 20,
        total: 0,
        hasMore: false,
        pageCount: 0,
      });
    });

    it('should calculate pageCount correctly with rounding', () => {
      // 47 items, 20 per page = 3 pages (ceil(47/20))
      const result = buildPaginationMeta(0, 20, 47);
      expect(result.pageCount).toBe(3);

      // 55 items, 10 per page = 6 pages (ceil(55/10))
      const result2 = buildPaginationMeta(0, 10, 55);
      expect(result2.pageCount).toBe(6);

      // Exactly divisible
      const result3 = buildPaginationMeta(0, 20, 60);
      expect(result3.pageCount).toBe(3);
    });

    it('should handle offset beyond total', () => {
      const result = buildPaginationMeta(9999, 10, 50);
      
      expect(result).toEqual({
        offset: 9999,
        limit: 10,
        total: 50,
        hasMore: false,
        pageCount: 5,
      });
    });

    it('should correctly handle single page of results', () => {
      const result = buildPaginationMeta(0, 50, 25);
      
      expect(result.hasMore).toBe(false);
      expect(result.pageCount).toBe(1);
    });

    it('should correctly handle multi-page results', () => {
      const result = buildPaginationMeta(0, 20, 100);
      
      expect(result.hasMore).toBe(true);
      expect(result.pageCount).toBe(5);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete pagination flow: parse params, validate, build meta', () => {
      // User requests page 2 with 10 items per page
      const params = parsePaginationParams('10', '10');
      
      // Total of 47 items in database
      const meta = buildPaginationMeta(params.offset, params.limit, 47);
      
      // Should return correct metadata
      expect(meta.offset).toBe(10);
      expect(meta.limit).toBe(10);
      expect(meta.total).toBe(47);
      expect(meta.hasMore).toBe(true); // 10 + 10 < 47
      expect(meta.pageCount).toBe(5); // ceil(47/10)
    });

    it('should maintain consistency across different total counts', () => {
      const params = parsePaginationParams('20', '10');
      
      // Small dataset
      const meta1 = buildPaginationMeta(params.offset, params.limit, 22);
      expect(meta1.pageCount).toBe(3);
      expect(meta1.hasMore).toBe(false);
      
      // Large dataset
      const meta2 = buildPaginationMeta(params.offset, params.limit, 1000);
      expect(meta2.pageCount).toBe(100);
      expect(meta2.hasMore).toBe(true);
    });
  });
});
