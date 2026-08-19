import cors from 'cors';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import { rateLimiter } from './middlewares/rate-limit.middleware';
import { env } from './config/env.config';
import { authMiddleware } from './middlewares/auth.middleware';
import { errorHandler, notFoundMiddleware } from './middlewares/error.middleware';

// Routes
import authRoutes from './routes/auth.routes';
import nutritionRoutes from './routes/nutrition.routes';
import progressRoutes from './routes/progress.routes';
import workoutsRoutes from './routes/workouts.routes';
import bodyMetricsRoutes from './routes/body-metrics.routes';
import exercisesRoutes from './routes/exercises.routes';
import foodsRoutes from './routes/foods.routes';
import recipesRoutes from './routes/recipes.routes';
import routinesRoutes from './routes/routines.routes';
import userRoutes from './routes/user.routes';
import agentRoutes from './routes/agent.routes';
import dashboardRoutes from './routes/dashboard.routes';
import healthRoutes from './routes/health.routes';
import notificationsRoutes from './routes/notifications.routes';
import statsRoutes from './routes/stats.routes';

const app = express();

// CORS Configuration - Hardcoded for reliability during debugging
const allowedOrigins = ['http://localhost:3003', 'http://localhost:3001', 'http://localhost:4000'];
const envOrigins = (env.CORS_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
const finalOrigins = [...new Set([...allowedOrigins, ...envOrigins])];

app.use(cors({
    origin: finalOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"],
    optionsSuccessStatus: 200
}));

// Security Middlewares
app.use(helmet());
app.use(hpp());
app.use(express.json());

// IMPORTANT: Parse cookies (must be before auth middleware)
app.use(cookieParser());

// Health check (no rate limit)
app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
});

// Health routes (Redis monitoring, etc - no rate limit)
app.use('/api/health', healthRoutes);

// Global Rate Limiting (applied after health routes)
app.use(rateLimiter);

// Auth routes
app.use('/api/auth', authRoutes);

// Public API routes
app.use('/api/exercises', exercisesRoutes);

// Protected Identity route
app.get('/api/me', authMiddleware, (req: Request, res: Response) => {
    res.json({
        data: {
            user: req.user
        }
    });
});

// Protected API routes
app.use('/api/foods', authMiddleware, foodsRoutes);
app.use('/api/recipes', authMiddleware, recipesRoutes);
app.use('/api/nutrition', nutritionRoutes);
app.use('/api/progress', progressRoutes);
app.use('/api/body-metrics', bodyMetricsRoutes);
app.use('/api/workouts', workoutsRoutes);
app.use('/api/routines', routinesRoutes);
app.use('/api/user', userRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/stats', statsRoutes);

// 404 handler
app.use(notFoundMiddleware);

// Error handler
app.use(errorHandler);

export { app };
