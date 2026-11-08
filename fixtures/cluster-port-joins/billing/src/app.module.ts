import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import appConfig from './app.config';
import { InvoicesController } from './invoices.controller';

@Module({ imports: [ConfigModule.forRoot({ load: [appConfig] })], controllers: [InvoicesController] })
export class AppModule {}
