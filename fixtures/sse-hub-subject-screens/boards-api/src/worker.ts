import { Hono } from 'hono';

import type { Env } from './env';
import { createStreamHandlers } from './stream/stream-handlers';

export { BoardHub } from './hub/board-hub';

const deps = { tokens: new Set<string>(['demo']) };

const sse = createStreamHandlers(async () => deps);

const app = new Hono<{ Bindings: Env }>();

// The handlers are members of the object the factory returns.
app.get('/api/boards/:boardId/events', sse.boardEvents);
app.get('/api/boards/:boardId/stream', sse.stream);
app.get('/api/boards/:boardId/crew/stream', sse.crewStream);
app.get('/api/health', sse.health);

export default app;
