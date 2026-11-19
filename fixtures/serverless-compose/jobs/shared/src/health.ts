import type { APIGatewayProxyResult } from 'aws-lambda';

/** GET /health, on the API the composition shares. */
export const handler = async (): Promise<APIGatewayProxyResult> => ({ statusCode: 200, body: 'ok' });
