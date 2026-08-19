import { buildApiUrl } from './config';
import { handleApiError } from './error.handler';
import { apiClient } from './client';

/**
 * Register a push subscription with the backend
 */
export async function subscribeToNotifications(subscription: PushSubscription): Promise<void> {
  const url = buildApiUrl('/notifications/subscribe');
  
  // Extract keys for the backend format
  const subJson = subscription.toJSON();
  const payload = {
    endpoint: subJson.endpoint,
    keys: {
      p256dh: subJson.keys?.p256dh,
      auth: subJson.keys?.auth
    }
  };

  try {
    const response = await apiClient(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw handleApiError({}, response.status);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Unregister a push subscription from the backend
 */
export async function unsubscribeFromNotifications(endpoint: string): Promise<void> {
  const url = buildApiUrl('/notifications/unsubscribe');
  try {
    const response = await apiClient(url, {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    });
    if (!response.ok) throw handleApiError({}, response.status);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Send a test notification to the current user
 */
export async function sendTestNotification(): Promise<void> {
  const url = buildApiUrl('/notifications/test');
  try {
    const response = await apiClient(url, { method: 'POST' });
    if (!response.ok) throw handleApiError({}, response.status);
  } catch (error) {
    throw handleApiError(error);
  }
}

/**
 * Helper to convert VAPID public key to Uint8Array
 */
export function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const notificationService = {
  subscribeToNotifications,
  unsubscribeFromNotifications,
  sendTestNotification,
  urlBase64ToUint8Array
};
