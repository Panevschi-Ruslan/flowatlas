import type { ALBEvent, ALBResult } from 'aws-lambda';

/** GET /health on the staff load balancer's plain-HTTP listener, which only says where to go. */
export const handler = async (_event: ALBEvent): Promise<ALBResult> => ({
  statusCode: 200,
  body: JSON.stringify({ balancer: 'staff', listener: 'http', upgrade: 'https' }),
});
