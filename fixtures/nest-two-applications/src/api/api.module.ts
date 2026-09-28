import { Module } from '@nestjs/common';

import { HealthModule } from '../health/health.module';
import { LegacyModule } from '../legacy/legacy.module';
import { StatusController } from '../shared/status.controller';

/**
 * The root of one application, reaching its health route through an import.
 *
 * Membership is transitive, which is why the import is here rather than the
 * controller: an application is a root module together with the modules it
 * imports, and a controller belongs to the application whose root reaches the
 * module that declares it.
 */
@Module({
  imports: [HealthModule, LegacyModule],
  controllers: [StatusController],
})
export class ApiModule {}
