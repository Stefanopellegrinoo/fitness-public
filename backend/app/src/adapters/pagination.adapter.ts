/**
 * Pagination Adapter
 * 
 * Handles parsing and validation of pagination parameters,
 * and building consistent pagination metadata for API responses.
 */

// Validation constants
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 20;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

export interface PaginationParams {
  offset: number;
  limit: number;
}

export interface PaginationMeta {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  pageCount: number;
}

/**
 * Parses and validates pagination query parameters
 * 
 * @param offset - Offset parameter (string or undefined)
 * @param limit - Limit parameter (string or undefined)
 * @returns Validated pagination params with defaults applied
 * @throws Error if validation fails
 */
export function parsePaginationParams(
  offset: string | undefined,
  limit: string | undefined
): PaginationParams {
  const parsedOffset = offset === undefined ? DEFAULT_OFFSET : parseInt(offset, 10);
  const parsedLimit = limit === undefined ? DEFAULT_LIMIT : parseInt(limit, 10);

  validateOffset(parsedOffset);
  validateLimit(parsedLimit);

  return {
    offset: parsedOffset,
    limit: parsedLimit,
  };
}

/**
 * Validates offset parameter
 * @throws Error if offset is invalid
 */
function validateOffset(offset: number): void {
  if (Number.isNaN(offset) || offset < 0) {
    throw new Error('offset must be >= 0');
  }
}

/**
 * Validates limit parameter
 * @throws Error if limit is invalid
 */
function validateLimit(limit: number): void {
  if (Number.isNaN(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
    throw new Error(`limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}`);
  }
}

/**
 * Builds pagination metadata for API responses
 * 
 * @param offset - Current offset
 * @param limit - Current limit
 * @param total - Total count of items
 * @returns Pagination metadata including computed fields
 */
export function buildPaginationMeta(
  offset: number,
  limit: number,
  total: number
): PaginationMeta {
  const pageCount = calculatePageCount(total, limit);
  const hasMore = offset + limit < total;

  return {
    offset,
    limit,
    total,
    hasMore,
    pageCount,
  };
}

/**
 * Calculates total page count
 */
function calculatePageCount(total: number, limit: number): number {
  if (total === 0) return 0;
  return Math.ceil(total / limit);
}
