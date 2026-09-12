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

declare function fetch(input: string, init?: RequestInit): Promise<Response>;
