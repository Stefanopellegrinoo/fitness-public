/**
 * Authentication Storage Layer
 * Abstracts localStorage access for auth data with private mode fallback
 * Handles graceful degradation when localStorage is unavailable
 */

/**
 * Storage keys for authentication data
 */
const STORAGE_KEYS = {
  TOKEN: 'auth_token',
  USER: 'auth_user',
} as const;

/**
 * In-memory fallback storage for when localStorage is unavailable (private mode, etc.)
 */
const memoryStorage: Record<string, string> = {};

/**
 * Detect if localStorage is available
 * Attempts write/read/delete to verify access
 * @returns boolean - true if localStorage is fully accessible
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__localStorage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch (error) {
    // localStorage unavailable (private mode, quota exceeded, etc.)
    return false;
  }
}

/**
 * Save authentication data (token + user) to storage
 * Falls back to memory if localStorage unavailable
 * @param token - JWT access token
 * @param user - User object (will be stringified)
 */
export function saveAuthData(token: string, user: Record<string, any>): void {
  try {
    if (isLocalStorageAvailable()) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
      localStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
    } else {
      // Fallback to memory storage
      memoryStorage[STORAGE_KEYS.TOKEN] = token;
      memoryStorage[STORAGE_KEYS.USER] = JSON.stringify(user);
    }
  } catch (error) {
    // Fail silently - log but don't throw
    console.warn('Failed to save auth data to storage:', error);
    // Attempt memory fallback
    memoryStorage[STORAGE_KEYS.TOKEN] = token;
    memoryStorage[STORAGE_KEYS.USER] = JSON.stringify(user);
  }
}

/**
 * Retrieve authentication data from storage
 * @returns Object with token and user, or null if not found/invalid
 */
export function getAuthData(): {
  token: string | null;
  user: Record<string, any> | null;
} {
  try {
    let token: string | null = null;
    let userStr: string | null = null;

    if (isLocalStorageAvailable()) {
      token = localStorage.getItem(STORAGE_KEYS.TOKEN);
      userStr = localStorage.getItem(STORAGE_KEYS.USER);
    } else {
      // Fallback to memory storage
      token = memoryStorage[STORAGE_KEYS.TOKEN] || null;
      userStr = memoryStorage[STORAGE_KEYS.USER] || null;
    }

    // Parse user if available
    let user: Record<string, any> | null = null;
    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch (parseError) {
        console.warn('Failed to parse stored user data:', parseError);
        user = null;
      }
    }

    return { token, user };
  } catch (error) {
    console.warn('Failed to retrieve auth data from storage:', error);
    return { token: null, user: null };
  }
}

/**
 * Clear all authentication data from storage
 * Falls back to memory if localStorage unavailable
 */
export function clearAuthData(): void {
  try {
    if (isLocalStorageAvailable()) {
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER);
    }
    // Always clear memory storage too
    delete memoryStorage[STORAGE_KEYS.TOKEN];
    delete memoryStorage[STORAGE_KEYS.USER];
  } catch (error) {
    // Fail silently - log but don't throw
    console.warn('Failed to clear auth data from storage:', error);
    // Ensure memory storage is cleared
    delete memoryStorage[STORAGE_KEYS.TOKEN];
    delete memoryStorage[STORAGE_KEYS.USER];
  }
}

/**
 * Check if storage contains valid authentication data
 * @returns boolean - true if both token and user exist
 */
export function hasAuthData(): boolean {
  const { token, user } = getAuthData();
  return !!token && !!user;
}

/**
 * Storage service object for dependency injection
 */
export const storageService = {
  saveAuthData,
  getAuthData,
  clearAuthData,
  hasAuthData,
  __clearMemoryStorage: () => {
    // For testing only - clears the in-memory fallback storage
    for (const key in memoryStorage) {
      delete memoryStorage[key];
    }
  },
};
