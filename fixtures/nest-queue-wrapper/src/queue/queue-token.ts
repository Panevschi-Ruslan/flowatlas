/** The token the container provides one queue's service under. */
export const queueToken = (name: string): string => `QUEUE_${name}`;

/** The token the driver every queue's service runs on is provided under. */
export const QUEUE_DRIVER = 'QUEUE_DRIVER';
