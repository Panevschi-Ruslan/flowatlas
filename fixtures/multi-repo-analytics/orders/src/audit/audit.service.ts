import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

/** Publishes `audit.log`, which nothing in the project handles. */
@Injectable()
export class AuditService {
  constructor(@Inject('EVENTS_CLIENT') private readonly events: ClientProxy) {}

  record(action: string, subject: string): void {
    this.events.emit('audit.log', { action, subject });
  }
}
