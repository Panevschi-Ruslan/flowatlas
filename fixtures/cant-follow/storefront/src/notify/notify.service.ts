import { Injectable } from '@nestjs/common';
import { MailClient, type Receipt } from '@shopkit/mailer';
import { AuditTrail } from '@storefront/audit';

import { TemplateBook } from '../legacy/templates';

@Injectable()
export class NotifyService {
  /** Made here from a package nobody installed, so its type is nothing. */
  private readonly mail = new MailClient({ from: 'shop@example.test' });

  private readonly audit = new AuditTrail();

  private readonly templates = new TemplateBook();

  async confirm(sku: string, total: number): Promise<Receipt> {
    const body = this.templates.render('confirm', { sku, total });
    this.audit.record('confirm', sku);
    this.mail.attach('invoice.pdf');
    return this.mail.deliver({ to: sku, body });
  }
}
