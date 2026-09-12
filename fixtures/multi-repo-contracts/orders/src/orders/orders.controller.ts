import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { MoneyDto } from '@fx/wire';

import { AddressDto, CreateOrderDto, OrderDto } from './dto';
import { OrdersService } from './orders.service';

/** The far end of every call the gateway makes. */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** The four kinds of finding at once, all on one body. */
  @Post()
  create(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }

  /** `total` is a number here and text on the caller: `type_mismatch`. */
  @Get(':id')
  findOne(@Param('id') id: string): Promise<OrderDto> {
    return this.orders.findOne(id);
  }

  /**
   * Both ends import `MoneyDto` from the shared package, so neither owns the
   * declaration and drift is impossible: `shared`, and no field is walked.
   */
  @Post('prices')
  price(@Body() body: MoneyDto): Promise<MoneyDto> {
    return this.orders.price(body);
  }

  /**
   * Two declarations, one shape. The hashes agree, so `identical`, and again no
   * field is walked — which is what keeps a project with honest copies cheap.
   */
  @Post('addresses')
  address(@Body() body: AddressDto): Promise<AddressDto> {
    return this.orders.address(body);
  }

  /** The caller annotates its side with `@ContractIgnore`, so this drift is excused. */
  @Post('legacy')
  legacy(@Body() body: CreateOrderDto): Promise<OrderDto> {
    return this.orders.create(body);
  }
}
