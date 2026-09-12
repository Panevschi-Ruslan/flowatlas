import { Injectable } from '@nestjs/common';
import type { Message } from './message.js';
import { TemplatesService } from './templates.service.js';

/**
 * Keeps what it has already sent for the lifetime of the process, which is a
 * map and not a data layer. Nothing in this repository outlives a restart.
 */
@Injectable()
export class NotificationsService {
  private readonly sent = new Map<string, Message>();

  constructor(private readonly templates: TemplatesService) {}

  greet(name: string): Message {
    const message = { to: name, text: this.templates.greeting(name) };
    this.sent.set(name, message);
    return message;
  }

  dismiss(name: string): Message {
    const message = { to: name, text: this.templates.farewell(name) };
    this.sent.delete(name);
    return message;
  }
}
