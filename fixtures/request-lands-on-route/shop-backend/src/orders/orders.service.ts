import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersService {
  modify(storeId: string, orderId: string, lines: string[]): number {
    return `${storeId}${orderId}`.length + lines.length;
  }
}
