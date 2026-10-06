import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { dropHold } from '../lib/desk-table';
import { json } from '../lib/http';
import { span } from '../lib';

async function cancelHold(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  await dropHold(event.pathParameters?.isbn ?? '', event.pathParameters?.borrowerId ?? '');
  return json(204, {});
}

// Through a barrel that re-exports the wrapper under another name.
export const handler = span('cancelHold', cancelHold);
