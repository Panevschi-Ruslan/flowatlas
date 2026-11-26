import { Injectable } from '@nestjs/common';

@Injectable()
export class PushSender {
  async send(scopeId: string, line: string): Promise<void> {
    void scopeId;
    void line;
  }
}
