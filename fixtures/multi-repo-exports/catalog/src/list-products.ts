import type { APIGatewayProxyResult } from 'aws-lambda';

/** GET /products. */
export const handler = async (): Promise<APIGatewayProxyResult> => ({ statusCode: 200, body: '[]' });

/** An old route the transform will not hang from the shared API. */
export const legacy = async (): Promise<APIGatewayProxyResult> => ({ statusCode: 410, body: '' });
