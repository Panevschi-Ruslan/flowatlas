// The few platform types the worker names, as `@cloudflare/workers-types` declares them.

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectState {
  readonly id: DurableObjectId;
}
