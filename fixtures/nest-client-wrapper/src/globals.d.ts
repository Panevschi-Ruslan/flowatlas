// Ambient declarations so the fixture needs no installed type packages. A real
// repository would get these from its platform types.

declare const process: { env: Record<string, string | undefined> };

interface Response {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

interface RequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

declare class Request {
  constructor(input: string, init?: RequestInit);
}

declare function fetch(input: string | Request, init?: RequestInit): Promise<Response>;
