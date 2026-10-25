import type { ALBEvent, ALBResult } from 'aws-lambda';

/** Checks a book out at a kiosk. */
export const handler = async (event: ALBEvent): Promise<ALBResult> => ({
  statusCode: 200,
  body: JSON.stringify({ path: event.path }),
});
