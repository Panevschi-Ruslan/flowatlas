import { Injectable } from '@nestjs/common';

/** Sends a push line to a venue's devices. */
@Injectable()
export class PushSender {
  async warm(venueId: string): Promise<void> {
    void venueId;
  }

  async send(venueId: string, line: string): Promise<void> {
    void venueId;
    void line;
  }
}
