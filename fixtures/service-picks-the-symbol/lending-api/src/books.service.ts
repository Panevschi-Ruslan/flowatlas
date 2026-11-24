import { Injectable } from '@nestjs/common';

/** `findOne` is what the reader screen, the gateway and, through it, the desk bot all reach. */
@Injectable()
export class BooksService {
  private readonly titles = new Map<string, string>();

  list(): string[] {
    return [...this.titles.values()];
  }

  findOne(bookId: string): string {
    return this.titles.get(bookId) ?? '';
  }
}
