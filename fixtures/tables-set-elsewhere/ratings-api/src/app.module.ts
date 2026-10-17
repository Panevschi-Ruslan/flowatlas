import { Module } from '@nestjs/common';
import { RatingsController } from './ratings/ratings.controller.js';
import { RatingsRepository } from './ratings/ratings.repository.js';
import { RatingsService } from './ratings/ratings.service.js';
import { REVIEWS, ReviewsRepository } from './ratings/reviews.repository.js';

@Module({
  controllers: [RatingsController],
  providers: [RatingsRepository, RatingsService, { provide: REVIEWS, useFactory: () => new ReviewsRepository() }],
})
export class AppModule {}
