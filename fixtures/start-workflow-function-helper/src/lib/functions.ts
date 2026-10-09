import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({ region: 'eu-west-1' });

/** Hands an event to another function and does not wait for it. */
export async function notifyFunction(functionName: string, event: unknown): Promise<void> {
  await lambda.send(
    new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Uint8Array.from(JSON.stringify(event), (character) => character.charCodeAt(0)),
    }),
  );
}
