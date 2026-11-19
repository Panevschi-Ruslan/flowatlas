import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import { ClientsModule } from './clients/clients.module';
import { IN_MEMORY, MetricsModule, NullMailModule, SmtpModule, STAGE } from './features';
import { mailConfig } from './mail.config';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { database, MemoryStorageModule } from './storage/storage.module';

/** The storage the shop is built with: the database, since IN_MEMORY is false. */
const storage = IN_MEMORY ? MemoryStorageModule : database();

@Module({
  imports: [
    ConfigModule.forRoot({ load: [appConfig] }),
    ConfigModule.forFeature(mailConfig),
    ClientsModule.forRoot(),
    storage,
    ...(STAGE === 'prod' ? [MetricsModule] : []),
    // Chosen when the shop starts, by its environment: not known from the files.
    process.env.MAIL === 'smtp' ? SmtpModule : NullMailModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class AppModule {}
