import { Module } from '@nestjs/common';

import { SpaceBus } from './bus/space-bus.service';
import { ActivityFeed } from './handlers/activity-feed.service';
import { AuditTrail } from './handlers/audit-trail.service';
import { SpaceEventsDispatcher } from './handlers/dispatcher.service';
import { ExportWatcher } from './handlers/export-watcher.service';
import { Notices } from './handlers/notices.service';
import { RegistryDispatcher } from './handlers/registry-dispatcher.service';
import { HandlerRegistry, WelcomeHandlers } from './handlers/welcome.handlers';

// `LegacyDigest` and `MentionHandler` are left out on purpose: nothing builds them.
@Module({
  providers: [SpaceBus, Notices, SpaceEventsDispatcher, ExportWatcher, AuditTrail, ActivityFeed, HandlerRegistry, WelcomeHandlers, RegistryDispatcher],
})
export class AppModule {}
