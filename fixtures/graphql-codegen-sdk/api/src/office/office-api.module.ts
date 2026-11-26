import { Module } from '@nestjs/common';

import { OfficeResolver } from './office.resolver';

@Module({ providers: [OfficeResolver] })
export class OfficeApiModule {}
