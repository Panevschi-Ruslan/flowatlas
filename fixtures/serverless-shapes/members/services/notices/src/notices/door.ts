/** Behind the club's load balancer: says whether the door is open. */
export const handler = async (): Promise<{ statusCode: number; body: string }> => ({ statusCode: 200, body: 'open' });
