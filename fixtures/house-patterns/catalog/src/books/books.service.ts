import { Injectable } from '@nestjs/common';
// Two wrappers of the bookshop's own, from packages nobody here installed:
// nothing types them, so without a description every call on them is a place
// the reader cannot follow.
import { ShopBus } from '@bookshop/bus';
import { ApiClient } from '@bookshop/http';
import { topicFor, type Book, type NewBook } from './book.js';

@Injectable()
export class BooksService {
  private readonly shelf: Book[] = [];
  private readonly bus = new ShopBus();
  private readonly api = new ApiClient();

  list(): Book[] {
    return this.shelf;
  }

  async add(book: NewBook): Promise<Book> {
    await this.api.call('POST', `${process.env.STOCK_URL}/stock/reserve`, { isbn: book.isbn, copies: 1 });
    const added: Book = { ...book, addedAt: new Date().toISOString() };
    this.shelf.push(added);
    this.bus.emit({ topic: 'book.added', data: added });
    return added;
  }

  remove(isbn: string): void {
    // The topic is chosen at run time: the publish is read, its channel is not.
    this.bus.emit({ topic: topicFor('removed'), data: { isbn } });
  }
}
