import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** The kiosk places a hold through the holds API, mapped at `holds` on the same domain. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const response = await fetch(`${process.env.LIBRARY_API_URL}/holds/requests`, { method: 'POST', body: event.body ?? '{}' });
  return { statusCode: response.status, body: await response.text() };
};
