import { Injectable } from '@nestjs/common';

/**
 * `place` runs behind a route the reader screen requests; `release` only
 * behind a route nothing requests, so it is called, and dead all the same.
 */
@Injectable()
export class HoldsService {
  private readonly held = new Set<string>();

  place(bookId: string): void {
    this.held.add(bookId);
  }

  release(bookId: string): void {
    this.held.delete(bookId);
  }

  extend(bookId: string): void {
    this.held.add(bookId);
  }
}
