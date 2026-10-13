import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

export const events = new EventBridgeClient({ region: 'eu-west-1' });

/** The bus every circulation event is put on. */
export const LIBRARY_BUS = 'library';
