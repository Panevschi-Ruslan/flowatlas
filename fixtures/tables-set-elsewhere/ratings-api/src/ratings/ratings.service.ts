import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository, Repository } from 'typeorm';
import { Rating } from './rating.entity.js';
import { RatingsRepository } from './ratings.repository.js';
import { REVIEWS, type ReviewsRepositoryPort } from './reviews.repository.js';

@Injectable()
export class RatingsService {
  constructor(
    private readonly ratingsRepository: RatingsRepository,
    @InjectRepository(Rating) private readonly ratings: Repository<Rating>,
    @Inject(REVIEWS) private readonly reviewsRepository: ReviewsRepositoryPort,
  ) {}

  // Drawn as a static call into RatingsRepository.topRated: no row here.
  best(): Promise<unknown> {
    return this.ratingsRepository.topRated();
  }

  // The type-argument path names the table the decorator states: `ratings`.
  all(): Promise<Rating[]> {
    return this.ratings.find();
  }

  // Through a token typed by an interface: no edge, so the row stays.
  recent(): Promise<unknown[]> {
    return this.reviewsRepository.recent();
  }
}
