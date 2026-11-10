import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

const targets = new Map<string, string>();

/** An order to the function registered for its channel. */
export const handler = async (event: { channel: string; order: { id: string } }) => {
  await lambda.send(new InvokeCommand({ FunctionName: targets.get(event.channel), Payload: Buffer.from(JSON.stringify(event.order)) }));
};

export const register = (channel: string, fn: string): void => {
  targets.set(channel, fn);
};
