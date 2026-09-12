import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { AnonymousProcessor } from './mail/anonymous.processor';
import { LegacyMailProcessor } from './mail/legacy-mail.processor';
import { MailController } from './mail/mail.controller';
import { MailProcessor } from './mail/mail.processor';
import { MailService } from './mail/mail.service';

@Module({
  imports: [
    BullModule.forRoot({ connection: { host: 'localhost', port: 6379 } }),
    // Registration is where the queue names are declared; the injection tokens
    // in `MailService` are what the adapter actually reads.
    BullModule.registerQueue({ name: 'mail' }, { name: 'digest' }),
  ],
  controllers: [MailController],
  providers: [MailService, MailProcessor, LegacyMailProcessor, AnonymousProcessor],
})
export class AppModule {}
