import { LambdaClient } from '@aws-sdk/client-lambda';
import { SFNClient } from '@aws-sdk/client-sfn';

/** One client of each for the whole service, the way the SDK's own examples keep them. */
export const sfn = new SFNClient({ region: 'eu-west-1' });
export const lambda = new LambdaClient({ region: 'eu-west-1' });

/** What a function is handed, as the bytes `Payload` takes. */
export const payloadOf = (value: unknown): Uint8Array =>
  Uint8Array.from(JSON.stringify(value), (character) => character.charCodeAt(0));
