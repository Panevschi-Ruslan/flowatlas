import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from '../guards/roles.guard';
import { ThrottleGuard } from '../guards/throttle.guard';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@UseInterceptors(LoggingInterceptor)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @UseGuards(ThrottleGuard)
  @UsePipes(ValidationPipe)
  @Roles('admin')
  findAll(): string[] {
    return this.orders.findAll();
  }

  /** Excluded from the function middleware by `.exclude('orders/health')`. */
  @Get('health')
  health(): string {
    return 'ok';
  }

  @Post()
  create(): string {
    return this.orders.create();
  }
}
