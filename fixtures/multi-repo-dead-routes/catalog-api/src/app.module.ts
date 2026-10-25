import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller';
import { ItemsController } from './items/items.controller';
import { OAuthController } from './oauth/oauth.controller';
import { WebhooksController } from './webhooks/webhooks.controller';

@Module({ controllers: [ItemsController, HealthController, WebhooksController, OAuthController] })
export class AppModule {}
