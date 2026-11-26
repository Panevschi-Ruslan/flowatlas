import { Controller, Param, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';
import { RelayService } from './relay.service';

/**
 * The routes the portal holds open.
 *
 * `events` subscribes in its own body; `packing` through the helper, which is
 * handed the channel here; `audit` streams frames from somewhere no
 * subscription says, and is a row rather than a guess.
 */
@Controller('workspaces/:workspaceId')
export class LiveController {
  constructor(private readonly relay: RelayService) {}

  @Sse('events')
  events(@Param('workspaceId') workspaceId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const listener: RedisClientType = createClient();
      void listener.subscribe(`workspace:${workspaceId}:events`, (message) => {
        subscriber.next({ data: message } as MessageEvent);
      });
      return () => void listener.unsubscribe();
    });
  }

  @Sse('warehouses/:warehouseId/packing')
  packing(@Param('warehouseId') warehouseId: string): Observable<MessageEvent> {
    return this.relay.frames(`warehouse:${warehouseId}:parcels`);
  }

  @Sse('audit')
  audit(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => subscriber.complete());
  }
}
