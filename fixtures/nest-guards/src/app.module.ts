import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { AdminController } from './admin/admin.controller';
import { MetricsInterceptor } from './interceptors/metrics.interceptor';
import { LoggerMiddleware } from './middleware/logger.middleware';
import { requestIdMiddleware } from './middleware/request-id.middleware';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';

@Module({
  controllers: [OrdersController, AdminController],
  providers: [
    OrdersService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(LoggerMiddleware).forRoutes('orders');
    consumer
      .apply(requestIdMiddleware)
      .exclude('orders/health')
      .forRoutes({ path: 'admin/*', method: RequestMethod.ALL });
  }
}
