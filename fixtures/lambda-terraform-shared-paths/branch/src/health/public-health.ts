import type { ALBEvent, ALBResult } from 'aws-lambda';

/** GET /health behind the public load balancer. */
export const handler = async (_event: ALBEvent): Promise<ALBResult> => ({
  statusCode: 200,
  body: JSON.stringify({ balancer: 'public', up: true }),
});
