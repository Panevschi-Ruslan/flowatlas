import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

import { forward } from './forward';

export interface Note {
  id: string;
  text: string;
}

/** The notes of an order, asked of the orders service through one helper. */
@Injectable()
export class NotesClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  list() {
    return forward<Note[]>(this.http, 'GET', `${this.config.get('ORDERS_URL')}/notes`);
  }

  remove(id: string) {
    return forward<Note>(this.http, 'DELETE', `${this.config.get('ORDERS_URL')}/notes/${id}`);
  }

  // The route answers POST: the helper's first branch is a GET, which this caller does not take.
  export(id: string) {
    return forward<Note>(this.http, 'POST', `${this.config.get('ORDERS_URL')}/notes/${id}/export`);
  }

  // A route the orders service does not serve at all: still a missing route, through the helper.
  archive(id: string) {
    return forward<Note>(this.http, 'POST', `${this.config.get('ORDERS_URL')}/notes/${id}/archive`);
  }

  // The verb is handed in by whoever calls this: not known here, so the request joins nothing.
  send(verb: string, id: string) {
    return forward<Note>(this.http, verb, `${this.config.get('ORDERS_URL')}/notes/${id}/flag`);
  }
}
