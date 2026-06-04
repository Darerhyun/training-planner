import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AppEnv } from '@training-planner/shared';
import { healthRoutes } from './routes/health.js';
import { meRoutes } from './routes/me.js';

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
