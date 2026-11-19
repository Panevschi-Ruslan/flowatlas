import { PushClient } from 'push-sdk';

/** The push client, made in one place: callers never name the package. */
export const makePushClient = () => new PushClient({ endpoint: 'https://push.example.test' });
