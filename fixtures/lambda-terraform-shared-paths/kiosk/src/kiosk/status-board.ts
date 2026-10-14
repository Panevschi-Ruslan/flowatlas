import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

/**
 * The kiosk's status board asks each API and load balancer of the branch how
 * it is. Two APIs answer `GET /status` and two load balancers `GET /health`;
 * the setting each base URL is read from is what says which one is meant.
 */
export const handler = async (_event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const loans = await fetch(`${process.env.LOANS_API_URL}/status`);
  const events = await fetch(`${process.env.EVENTS_API_URL}/status`);
  const staff = await fetch(`${process.env.STAFF_LB_URL}/health`);
  // A setting named after neither API: which `/status` it reaches is not known.
  const branch = await fetch(`${process.env.BRANCH_URL}/status`);
  const body = { loans: loans.status, events: events.status, staff: staff.status, branch: branch.status };
  return { statusCode: 200, body: JSON.stringify(body) };
};
