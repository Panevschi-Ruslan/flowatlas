import { Body, Controller, Post } from '@nestjs/common';
import { MailQueueService, type MailData } from './mail-queue.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly mail: MailQueueService) {}

  @Post('welcome')
  welcome(@Body() data: MailData) {
    return this.mail.send('send-welcome', data);
  }

  @Post('receipts')
  receipts(@Body() list: MailData[]) {
    return this.mail.sendMany('send-receipt', list);
  }

  // No handler of the mail queue takes this job.
  @Post('invoice')
  invoice(@Body() data: MailData) {
    return this.mail.send('send-invoice', data);
  }

  @Post('pair')
  pair(@Body() data: MailData) {
    return this.mail.sendPair(data, data);
  }

  @Post('image')
  image(@Body() body: { url: string }) {
    return this.mail.resize(body.url);
  }
}
