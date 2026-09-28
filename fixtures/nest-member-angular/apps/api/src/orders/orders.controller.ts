import { Body, Controller, Post } from '@nestjs/common';
import { MailPreview } from '@member-angular/mailer';
import { SdkClient } from '@member-angular/sdk';
import { STATUS_LABELS } from '@member-angular/widgets';

@Controller('orders')
export class OrdersController {
  /**
   * Server code through and through. It reaches three members: the widgets'
   * labels, the SDK's client and the mailer's preview. Only the first of them
   * installs Angular, and it supplies Angular to nobody but itself.
   */
  @Post()
  async place(@Body() order: { id: string; email: string }): Promise<{ id: string; label: string }> {
    const sdk = new SdkClient(undefined as never);
    const mail = new MailPreview(undefined as never);
    sdk.lookup(order.email);
    mail.preview(order.id);
    return { id: order.id, label: STATUS_LABELS.placed };
  }
}
