import { buildApiUrl } from './config';
import {
  ApiResponse,
  CreateRecipePayload,
  Recipe,
  RecipeListItem,
  UpdateRecipePayload,
} from '../types/api.types';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

/** Matches DEFAULT_LIMIT in the backend pagination adapter. */
const PAGE_SIZE = 20;

export interface RecipePage {
  items: RecipeListItem[];
  /** Server-side total, so a caller can tell a full list from a truncated page. */
  total: number;
}

/**
 * List the user's recipes, newest-updated first.
 *
 * Returns the server-side total alongside the page: the endpoint is paginated,
 * and a caller that only sees `items` cannot distinguish "these are all my
 * recipes" from "these are the first 20 of 37" — a silent incompleteness.
 *
 * @returns Promise<RecipePage>
 */
export async function getRecipes(q?: string): Promise<RecipePage> {
  const params = new URLSearchParams({ limit: PAGE_SIZE.toString() });
  // An empty q= is not the same as no q=: it would be a filter on the empty
  // string, so the plain list call must not carry the parameter at all.
  if (q) params.set('q', q);
  const url = buildApiUrl(`/recipes?${params.toString()}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = (await response.json()) as ApiResponse<RecipeListItem[]>;
    const items = result.data || [];
    return { items, total: result.pagination?.total ?? items.length };
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Fetch one recipe with its ingredients.
 *
 * The list endpoint returns a light shape without them, so this is what the
 * editor loads before it can show an existing recipe. A recipe belonging to
 * another user answers 404, same as one that does not exist.
 *
 * @returns Promise<Recipe>
 */
export async function getRecipe(id: string): Promise<Recipe> {
  const url = buildApiUrl(`/recipes/${id}`);

  try {
    const response = await apiClient(url, { method: 'GET' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = (await response.json()) as ApiResponse<Recipe>;
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Create a recipe. The backend answers 201, not 200.
 * @returns Promise<Recipe> — the full detail, macros already derived
 */
export async function createRecipe(payload: CreateRecipePayload): Promise<Recipe> {
  const url = buildApiUrl('/recipes');

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = (await response.json()) as ApiResponse<Recipe>;
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Edit a recipe. Only the fields present in `payload` are sent — a name-only
 * edit must not carry a servings value, or it would reset the recipe's yield.
 * When `ingredients` is present the backend replaces them wholesale.
 *
 * @returns Promise<Recipe>
 */
export async function updateRecipe(id: string, payload: UpdateRecipePayload): Promise<Recipe> {
  const url = buildApiUrl(`/recipes/${id}`);

  try {
    const response = await apiClient(url, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }

    const result = (await response.json()) as ApiResponse<Recipe>;
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Delete a recipe. The backend answers 204 with no body, so nothing is parsed:
 * calling .json() on it would throw on the success path.
 */
export async function deleteRecipe(id: string): Promise<void> {
  const url = buildApiUrl(`/recipes/${id}`);

  try {
    const response = await apiClient(url, { method: 'DELETE' });

    if (!response.ok) {
      throw handleApiError({}, response.status);
    }
  } catch (error) {
    throw handleApiError(error);
  }
}

export const recipeService = {
  getRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  deleteRecipe,
};
