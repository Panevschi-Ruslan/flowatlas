import { Injectable } from '@nestjs/common';

@Injectable()
export class OrdersService {
  findAll(): string[] {
    return ['order-1', 'order-2'];
  }

  create(): string {
    return 'order-3';
  }
}
