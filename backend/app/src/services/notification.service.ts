import webpush from 'web-push';
import { prisma } from '../lib/prisma';
import { env } from '../config/env.config';

// Initialize web-push with VAPID keys
// These should be in your .env file
const publicKey = env.VAPID_PUBLIC_KEY || '';
const privateKey = env.VAPID_PRIVATE_KEY || '';

if (publicKey && privateKey) {
  webpush.setVapidDetails(
    'mailto:support@fittrack.pro',
    publicKey,
    privateKey
  );
} else {
  console.warn('VAPID keys not set. Push notifications will not work.');
}

/**
 * Save or update a push subscription for a user
 */
export async function saveSubscription(userId: string, subscription: any) {
  const { endpoint, keys } = subscription;
  
  try {
    return await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        userId,
        p256dh: keys.p256dh,
        auth: keys.auth
      },
      create: {
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth
      }
    });
  } catch (error) {
    console.error('Error saving push subscription to database:', error);
    throw error;
  }
}

/**
 * Delete a push subscription
 */
export async function deleteSubscription(endpoint: string) {
  return await prisma.pushSubscription.deleteMany({
    where: { endpoint }
  });
}

/**
 * Send a notification to all subscriptions of a user
 */
export async function sendNotificationToUser(userId: string, payload: { title: string, body: string, url?: string }) {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId }
  });

  const notifications = subscriptions.map(sub => {
    const pushConfig = {
      endpoint: sub.endpoint,
      keys: {
        p256dh: sub.p256dh,
        auth: sub.auth
      }
    };

    return webpush.sendNotification(pushConfig, JSON.stringify(payload))
      .catch(async (err) => {
        if (err.statusCode === 404 || err.statusCode === 410) {
          // Subscription expired or gone, remove it
          console.log('Removing expired subscription:', sub.endpoint);
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
        } else {
          console.error('Error sending notification:', err);
        }
      });
  });

  return Promise.all(notifications);
}

export const notificationService = {
  saveSubscription,
  deleteSubscription,
  sendNotificationToUser
};
