import { Controller, Get, Param } from '@nestjs/common';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.orders.fetchOne(id);
  }

  @Get()
  settings(): unknown {
    return this.orders.settings();
  }
}

// The handlers above declare no return type on purpose. Each forwards the
// client's `Observable<AxiosResponse<T>>` unchanged, and letting the library's
// signature decide is what makes this fixture a test of its shape rather than
// of a shape somebody retyped. They used to say `{ data: unknown }`, which no
// real Nest handler can say and which hid the delivery wrapper the graph reads
// through.
//
// Do not put an annotation back. It would need two imports, and every line
// below them would move; node ids carry line numbers, and the fixture section
// of the repository README lists what that breaks.
