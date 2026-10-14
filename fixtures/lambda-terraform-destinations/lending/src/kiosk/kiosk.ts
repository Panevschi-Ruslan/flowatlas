import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** Checks a member's card at a kiosk, through the card lookup's function URL. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const card = await fetch(process.env.CARD_LOOKUP_URL + '/cards');
  const extra = event.queryStringParameters?.['extra'] ?? '';
  const history = await fetch(`${process.env.CARD_LOOKUP_URL}${extra}`);
  return { statusCode: 200, body: JSON.stringify({ card: card.status, history: history.status }) };
};
