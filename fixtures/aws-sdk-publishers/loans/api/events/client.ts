import { EventBridgeClient } from '@aws-sdk/client-eventbridge';

/** One client for the whole service, the way the SDK's own examples keep it. */
export const events = new EventBridgeClient({ region: 'eu-west-1' });

/** The library's own bus, addressed by its ARN rather than its name. */
export const LIBRARY_BUS_ARN = 'arn:aws:events:eu-west-1:111122223333:event-bus/library-events';
