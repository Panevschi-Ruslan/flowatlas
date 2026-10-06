import type { APIGatewayProxyResultV2, APIGatewayProxyWebsocketEventV2 } from 'aws-lambda';

const questions: string[] = [];

/** `askLibrarian`: a message whose `action` names this route. */
export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<APIGatewayProxyResultV2> => {
  const { question } = JSON.parse(event.body ?? '{}') as { question?: string };
  if (question !== undefined) questions.push(question);
  return { statusCode: 200 };
};
