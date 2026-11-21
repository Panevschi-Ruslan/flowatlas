import { Injectable } from '@nestjs/common';
import { OrdersService } from './orders.service';

/** Called only from `LegacyExport.run`: something calls it, but no way in reaches it and no unread call could. */
@Injectable()
export class ArchiveHelper {
  constructor(private readonly orders: OrdersService) {}

  async copyStatus(orderId: string): Promise<void> {
    await this.orders.updateStatus(orderId, 'archived');
  }
}
