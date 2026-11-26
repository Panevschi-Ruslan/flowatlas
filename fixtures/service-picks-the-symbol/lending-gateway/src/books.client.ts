import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

/** The gateway's client of the back end: `fetch` requests `GET /books/:bookId` through `LENDING_API_URL`. */
@Injectable()
export class BooksClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async fetch(bookId: string): Promise<string> {
    const response = await firstValueFrom(this.http.get<string>(`${this.config.get('LENDING_API_URL')}/books/${bookId}`));
    return response.data;
  }
}
