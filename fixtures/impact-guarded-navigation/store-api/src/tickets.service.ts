import { Injectable } from '@nestjs/common';

/** The second method asked about: a route and a chat webhook call it. */
@Injectable()
export class TicketsService {
  acknowledge(ticketId: string): void {
    void ticketId.length;
  }
}
