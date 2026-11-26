import { Injectable } from '@nestjs/common';

/** The catalog's own bus, which `adapters.broker.custom` describes as a producer. */
@Injectable()
export class CatalogBus {
  async publish(channel: string, payload: unknown): Promise<void> {
    void channel;
    void payload;
  }
}
