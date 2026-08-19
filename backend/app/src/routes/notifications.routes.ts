import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { notificationService } from '../services/notification.service';
import { z } from 'zod';

const router = Router();

const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string()
  })
});

/**
 * POST /api/notifications/subscribe
 * Register a new push subscription for the current user
 */
router.post('/subscribe', authMiddleware, async (req: Request, res: Response) => {
  const parseResult = SubscriptionSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: { message: 'Invalid subscription object' } });
    return;
  }

  try {
    await notificationService.saveSubscription(req.user!.userId, parseResult.data);
    res.status(201).json({ message: 'Subscribed successfully' });
  } catch (err: any) {
    res.status(500).json({ error: { message: 'Failed to subscribe' } });
  }
});

/**
 * POST /api/notifications/test
 * Send a test notification to the current user
 */
router.post('/test', authMiddleware, async (req: Request, res: Response) => {
  try {
    await notificationService.sendNotificationToUser(req.user!.userId, {
      title: '¡Funciona! 🚀',
      body: 'FitTrack Pro está listo para enviarte notificaciones.',
      url: '/progress'
    });
    res.json({ message: 'Test notification sent' });
  } catch (err: any) {
    res.status(500).json({ error: { message: 'Failed to send test notification' } });
  }
});

/**
 * DELETE /api/notifications/unsubscribe
 * Unregister a push subscription
 */
router.delete('/unsubscribe', authMiddleware, async (req: Request, res: Response) => {
  const { endpoint } = req.body;
  
  if (!endpoint) {
    res.status(400).json({ error: { message: 'Endpoint is required' } });
    return;
  }

  try {
    await notificationService.deleteSubscription(endpoint);
    res.json({ message: 'Unsubscribed successfully' });
  } catch (err: any) {
    res.status(500).json({ error: { message: 'Failed to unsubscribe' } });
  }
});

export default router;
