import { buildApiUrl } from './config';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  currentWeightKg?: number;
  heightCm?: number;
  birthDate?: string;
  activityLevel?: 'SEDENTARY' | 'LIGHT' | 'MODERATE' | 'ACTIVE' | 'VERY_ACTIVE';
  goal?: 'BULK' | 'CUT' | 'MAINTENANCE';
  createdAt: string;
}

/**
 * Fetch the current user profile
 */
export async function getProfile(): Promise<UserProfile> {
  const url = buildApiUrl('/user/profile');
  try {
    const response = await apiClient(url, { method: 'GET' });
    if (!response.ok) throw handleApiError({}, response.status);
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Update user profile information
 */
export async function updateProfile(data: Partial<Omit<UserProfile, 'id' | 'email' | 'createdAt'>>): Promise<UserProfile> {
  const url = buildApiUrl('/user/profile');
  try {
    const response = await apiClient(url, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
    if (!response.ok) throw handleApiError({}, response.status);
    const result = await response.json();
    return result.data;
  } catch (error) {
    throw handleApiError(error);
  }
}

export const userService = {
  getProfile,
  updateProfile,
};
