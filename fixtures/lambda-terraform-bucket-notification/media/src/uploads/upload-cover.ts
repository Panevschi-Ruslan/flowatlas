import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../lib/s3';

/** POST /covers/{isbn}: writes the cover to the uploads bucket, under `incoming/`. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const isbn = event.pathParameters?.['isbn'] ?? '';
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.UPLOADS_BUCKET,
      Key: `incoming/${isbn}.png`,
      Body: event.body ?? '',
    }),
  );
  return { statusCode: 202, body: JSON.stringify({ isbn }) };
};
