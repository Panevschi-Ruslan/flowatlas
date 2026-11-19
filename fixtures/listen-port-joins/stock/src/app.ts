import fastify from 'fastify';

/**
 * Stock, started on the port `PORT` says, or 3002 where nothing sets it: a
 * request to 3002 joins as a guess, since a deployment may move it.
 */
export const app = fastify();

app.get('/stock/:sku', async () => ({ available: 3 }));

app.get('/health', async () => ({ status: 'ok' }));

const port = Number(process.env.PORT) || 3002;

void app.listen({ port, host: '0.0.0.0' });
