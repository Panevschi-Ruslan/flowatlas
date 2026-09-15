import { Injectable } from '@nestjs/common';

const CHAT_API = 'https://chat.example.test';

/**
 * Two ways a request is made that do not say `fetch(url)` at the call.
 *
 * A transport a test can swap, falling back to the platform's; and a request
 * built as an object first and handed over whole. Both are requests, and both
 * reach the third party named here.
 */
@Injectable()
export class NotifierService {
  /** Swapped for a stub in a test; the platform's fetch otherwise. */
  http: typeof fetch | undefined = undefined;

  async send(token: string, text: string): Promise<boolean> {
    const send = this.http ?? fetch;
    const res = await send(`${CHAT_API}/bot${token}/sendMessage`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return res.ok;
  }

  async ping(): Promise<boolean> {
    const res = await fetch(new Request(`${CHAT_API}/health`, { method: 'HEAD' }));
    return res.ok;
  }

  /** The host kept behind a getter, which answers the same thing every time. */
  private get statusHost(): string {
    return 'https://status.example.test';
  }

  async status(): Promise<boolean> {
    const res = await fetch(`${this.statusHost}/v1/summary`);
    return res.ok;
  }
}
