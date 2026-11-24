import { Injectable } from '@nestjs/common';

@Injectable()
export class Mails {
  /** Reached only from another repository, across the shop's channel: its card says from where. */
  cancelled(orderId: string, reason: string): string {
    return this.subjectOf(orderId, reason);
  }

  audit(line: { orderId: string; action: string }): void {
    void line;
  }

  /** Called only from this service, and still reached from another repository through `cancelled`: it gets a card. */
  subjectOf(orderId: string, reason: string): string {
    return `Order ${orderId} cancelled: ${reason}`;
  }
}
