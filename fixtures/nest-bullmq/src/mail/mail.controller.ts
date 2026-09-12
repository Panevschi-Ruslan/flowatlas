import { Body, Controller, Post } from '@nestjs/common';

import type { SendEmailJob } from './jobs';
import { MailService } from './mail.service';

/** An http entry so the queue producers are reachable from a P01 entry node. */
@Controller('mail')
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Post('welcome')
  async welcome(@Body() body: SendEmailJob): Promise<{ queued: true }> {
    await this.mail.sendWelcome(body);
    return { queued: true };
  }
}
