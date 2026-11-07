import type { APIGatewayProxyResult } from 'aws-lambda';

/** GET /orders, on the HTTP API. */
export const handler = async (): Promise<APIGatewayProxyResult> => ({ statusCode: 200, body: '[]' });
