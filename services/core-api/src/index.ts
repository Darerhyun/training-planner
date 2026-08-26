import './env.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AppEnv } from '@training-planner/shared';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';
import { createPlanningRoutes } from './routes/planning.js';
import { createCoursePlanningRoutes } from './routes/course-planning.js';
import { sessionsRoutes } from './routes/sessions.js';
import { syncRoutes } from './routes/sync.js';
import { uploadsRoutes } from './routes/uploads.js';

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:5173'],
    credentials: true,
  }),
);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.route('/', healthRoutes);
app.route('/', meRoutes);
app.route('/', uploadsRoutes);
app.route('/', syncRoutes);
app.route('/', createPlanningRoutes());
app.route('/', createCoursePlanningRoutes());
app.route('/', sessionsRoutes);

// ---------------------------------------------------------------------------
// Fallbacks
// ---------------------------------------------------------------------------
app.notFound((c) => c.json({ error: 'Not found' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const port = parseInt(process.env.PORT ?? '8080', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`🚀 core-api listening on http://localhost:${info.port}`);
});
