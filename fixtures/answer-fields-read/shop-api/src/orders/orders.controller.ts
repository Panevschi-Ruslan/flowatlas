import { Controller, Get, Param } from '@nestjs/common';

/** A row of the order list: no client reads `placedAt` or `internalNote`. */
export interface OrderSummary {
  id: string;
  total: number;
  status: string;
  placedAt: string;
  internalNote: string;
}

export interface OrderLine {
  sku: string;
  qty: number;
}

export interface OrderDetail {
  id: string;
  total: number;
  lines: OrderLine[];
  customer: { name: string; email: string };
}

@Controller('orders')
export class OrdersController {
  @Get()
  list(): OrderSummary[] {
    return [];
  }

  @Get(':id')
  one(@Param('id') id: string): OrderDetail {
    return { id, total: 0, lines: [], customer: { name: '', email: '' } };
  }
}
