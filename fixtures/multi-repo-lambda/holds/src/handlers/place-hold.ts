import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { placeHold } from '../lib/holds-table';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const { borrowerId, isbn } = JSON.parse(event.body ?? '{}') as { borrowerId: string; isbn: string };
  const hold = await placeHold({ holdId: `${borrowerId}-${isbn}`, borrowerId, isbn });
  return { statusCode: 201, body: JSON.stringify(hold) };
};
