import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from '../lib/s3';

/** POST /covers/{isbn}/url: a URL the browser writes the cover with itself. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const isbn = event.pathParameters?.['isbn'] ?? '';
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.UPLOADS_BUCKET, Key: `incoming/${isbn}.png` }), {
    expiresIn: 300,
  });
  return { statusCode: 200, body: JSON.stringify({ url }) };
};
