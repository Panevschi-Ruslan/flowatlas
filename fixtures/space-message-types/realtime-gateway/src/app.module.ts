import { Module } from '@nestjs/common';

import { SpaceBus } from './bus/space-bus.service';
import { Clients, StreamRelay } from './stream/stream-relay.service';

@Module({
  providers: [SpaceBus, Clients, StreamRelay],
})
export class AppModule {}
