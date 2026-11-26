import { Component, type OnInit } from '@angular/core';

import { BooksClient } from './books.client';

/** `/book/:bookId`: shows one book and places a hold on it. */
@Component({
  standalone: true,
  selector: 'app-book-page',
  template: `<h1>{{ title }}</h1><button (click)="hold()">Hold</button>`,
})
export class BookPageComponent implements OnInit {
  title = '';
  bookId = 'first';

  constructor(private readonly books: BooksClient) {}

  ngOnInit(): void {
    this.books.get(this.bookId).subscribe((title) => (this.title = title));
  }

  hold(): void {
    this.books.hold(this.bookId).subscribe();
  }
}
