// What this project uses of @acme/queue-client, written by hand: the package
// is private and not installed here.
declare module '@acme/queue-client' {
  export class QueueClient {
    constructor(url?: string);
    connect(): Promise<void>;
    publish(topic: string, body: unknown): Promise<void>;
  }
}
