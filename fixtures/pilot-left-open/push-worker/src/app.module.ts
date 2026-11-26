import { Module } from '@nestjs/common';

import { ChatBot } from './bot/chat-bot.service';
import { TenantBus } from './bus/tenant-bus.service';
import { LiveFeed } from './live/live-feed.service';
import { PushSender } from './push/push-sender.service';
import { PushService } from './push/push.service';
import { RoomDirectory } from './push/room-directory.service';
import { SessionAudit } from './session/session-audit.service';
import { ResyncService } from './sync/resync.service';

@Module({
  providers: [TenantBus, PushService, PushSender, RoomDirectory, LiveFeed, ResyncService, ChatBot, SessionAudit],
})
export class AppModule {}
