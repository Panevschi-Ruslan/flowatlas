import { Module } from '@nestjs/common';
import { JobBus } from './orders/jobs.js';
import { OrdersRepository } from './orders/orders.repository.js';
import { OrdersService } from './orders/orders.service.js';
import { VideoModel } from './orders/video.model.js';

@Module({ providers: [OrdersService, OrdersRepository, JobBus, VideoModel] })
export class AppModule {}
