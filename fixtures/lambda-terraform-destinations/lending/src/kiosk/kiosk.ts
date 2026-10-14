import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

/** Checks a member's card at a kiosk and asks for a loan, each through a function URL. */
export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const card = await fetch(process.env.CARD_LOOKUP_URL + '/cards');
  const extra = event.queryStringParameters?.['extra'] ?? '';
  const history = await fetch(`${process.env.CARD_LOOKUP_URL}${extra}`);
  const loan = await fetch(process.env.LOAN_URL + '/loans', { method: 'POST', body: event.body ?? '' });
  return { statusCode: 200, body: JSON.stringify({ card: card.status, history: history.status, loan: loan.status }) };
};
