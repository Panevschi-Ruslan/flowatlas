import type { APIGatewayProxyResult } from 'aws-lambda';

/** GET /health: the REST API answers. */
export const handler = async (): Promise<APIGatewayProxyResult> => ({ statusCode: 200, body: 'ok' });

/** GET /status: the HTTP API answers. */
export const status = async (): Promise<APIGatewayProxyResult> => ({ statusCode: 200, body: JSON.stringify({ up: true }) });
