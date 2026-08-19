import { buildApiUrl } from './config';
import { FoodItem, ApiResponse } from '../types/api.types';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

/**
 * Search for food items in the database
 * @param query - Search term
 * @returns Promise<FoodItem[]>
 */
export async function searchFoods(query: string): Promise<FoodItem[]> {
  const params = new URLSearchParams({ q: query });
  const url = buildApiUrl(`/foods?${params.toString()}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = (await response.json()) as ApiResponse<FoodItem[]>;
    return result.data || [];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Create a new food item in the catalog
 * @param food - Food details
 * @returns Promise<FoodItem>
 */
export async function createFood(food: Omit<FoodItem, 'id'>): Promise<FoodItem> {
  const url = buildApiUrl('/foods');

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(food),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    return (result?.data ?? result) as FoodItem;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Look up a food item by its barcode.
 * A 404 is a VALUE (not found), not an error, so it resolves to `null`.
 * @param code - Barcode / EAN string
 * @returns Promise<FoodItem | null>
 */
export async function getFoodByBarcode(code: string): Promise<FoodItem | null> {
  const url = buildApiUrl(`/foods/barcode/${encodeURIComponent(code)}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = await response.json();
    return (result?.data ?? result) as FoodItem;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch the user's recently logged foods (distinct, most recent first).
 * @param limit - Max rows (default 10)
 * @returns Promise<FoodItem[]>
 */
export async function getRecentFoods(limit = 10): Promise<FoodItem[]> {
  const params = new URLSearchParams({ limit: limit.toString() });
  const url = buildApiUrl(`/foods/recent?${params.toString()}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = (await response.json()) as ApiResponse<FoodItem[]>;
    return result.data || [];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch the user's favorite foods (newest first).
 * @returns Promise<FoodItem[]>
 */
export async function getFavorites(): Promise<FoodItem[]> {
  const url = buildApiUrl('/foods/favorites');

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = (await response.json()) as ApiResponse<FoodItem[]>;
    return result.data || [];
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Add a food item to the user's favorites (idempotent server-side).
 * @param foodItemId - Food item id
 * @returns Promise<void>
 */
export async function addFavorite(foodItemId: string): Promise<void> {
  const url = buildApiUrl('/foods/favorites');

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify({ foodItemId }),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Remove a food item from the user's favorites.
 * @param foodItemId - Food item id
 * @returns Promise<void>
 */
export async function removeFavorite(foodItemId: string): Promise<void> {
  const url = buildApiUrl(`/foods/favorites/${foodItemId}`);

  try {
    const response = await apiClient(url, { method: 'DELETE' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }
  } catch (error) {
    throw handleApiError(error);
  }
}

export const foodService = {
  searchFoods,
  createFood,
  getFoodByBarcode,
  getRecentFoods,
  getFavorites,
  addFavorite,
  removeFavorite,
};
