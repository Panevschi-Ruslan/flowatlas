import { Component, type OnInit } from '@angular/core';

import { BooksClient } from './books.client';

/** `/shelf`: lists the books and renews one. */
@Component({
  standalone: true,
  selector: 'app-shelf-page',
  template: `<ul>@for (title of titles; track title) {<li>{{ title }}</li>}</ul><button (click)="renew('first')">Renew</button>`,
})
export class ShelfPageComponent implements OnInit {
  titles: string[] = [];

  constructor(private readonly books: BooksClient) {}

  ngOnInit(): void {
    this.books.list().subscribe((titles) => (this.titles = titles));
  }

  renew(bookId: string): void {
    this.books.renew(bookId).subscribe();
  }
}
