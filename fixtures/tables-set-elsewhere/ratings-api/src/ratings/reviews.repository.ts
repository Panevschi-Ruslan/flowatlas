/** Provided under a token, typed by an interface: the call through it is not drawn. */
export const REVIEWS = 'REVIEWS';

export interface ReviewsRepositoryPort {
  recent(): Promise<unknown[]>;
}

export class ReviewsRepository implements ReviewsRepositoryPort {
  recent(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
}
