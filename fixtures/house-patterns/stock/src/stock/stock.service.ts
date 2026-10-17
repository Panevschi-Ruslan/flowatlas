import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ShopBus } from '@bookshop/bus';

export interface Reservation {
  isbn: string;
  copies: number;
}

export interface ShelvedBook {
  isbn: string;
  title: string;
}

@Injectable()
export class StockService implements OnModuleInit {
  private readonly counts = new Map<string, number>();
  private readonly bus = new ShopBus();

  onModuleInit(): void {
    // The bus hands each book added in the catalog to this service.
    this.bus.on('book.added', (book: ShelvedBook) => this.shelve(book));
  }

  shelve(book: ShelvedBook): void {
    this.counts.set(book.isbn, (this.counts.get(book.isbn) ?? 0) + 1);
  }

  reserve(reservation: Reservation): { reserved: number } {
    const left = this.counts.get(reservation.isbn) ?? 0;
    const reserved = Math.min(left, reservation.copies);
    this.counts.set(reservation.isbn, left - reserved);
    return { reserved };
  }
}
