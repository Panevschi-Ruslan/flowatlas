import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/** Every file under `files/`, however deep: `{proxy+}` takes the rest of the path. */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => ({
  statusCode: 200,
  body: JSON.stringify({ path: event.pathParameters?.proxy }),
});
