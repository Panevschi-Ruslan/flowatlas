import { Module } from '@nestjs/common';

import { legacyControllers } from './controllers';

/** A module whose controller list is a spread, and therefore unread. */
@Module({
  controllers: [...legacyControllers],
})
export class LegacyModule {}
